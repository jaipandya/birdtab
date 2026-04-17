import './tokens.css';
import './styles.css';
import CONFIG from './config.js';
import { getAutoPlayState, getQuietHoursText } from './quietHours.js';
import { isQuietHoursActive } from './quietHours.js';
import SettingsSidebar from './settingsSidebar.js';
import TopSites from './topSites.js';
import { localizeHtml } from './i18n.js';
import { applySearchVisibility, initializeSearch, setupSearchKeyboardShortcut } from './search.js';
import QuizMode from './quiz.js';
import { initSentry, captureException, addBreadcrumb, startTransaction } from './sentry.js';
import { log } from './logger.js';
import { IS_EDGE } from './browserInfo.js';
import { startTour, isTourCompleted, hasCompletedAnyTour, getUnseenFeatureSpotlights, showFeatureSpotlight, setOnTourEndCallback } from './featureTour.js';
import { showPermissionDialog } from './permissionDialog.js';
import { initChromeFooterNotification } from './chromeFooterNotification.js';
import { initAnalytics, trackSessionStart, trackFeature, trackReviewPromptShown, trackReviewPromptAction } from './analytics.js';
import { initClock, showClock, hideClock } from './clock.js';
import { initTimer, showTimer, hideTimer } from './timer.js';
import {
  addToHistory,
  getHistory,
  clearHistory,
  getRelativeTimeString,
  openHistoryModal,
  closeHistoryModal,
  populateHistoryList
} from './historyModal.js';
import { initializeGoogleApps } from './googleApps.js';
import { initializeChromeTab, updateChromeTabVisibility } from './chromeTab.js';
import { createOptionsMenu } from './optionsMenu.js';
import {
  showLoadingIndicator,
  hideLoadingIndicator,
  updateLoadingMessage,
  showMediaPlayIndicator,
  showMediaPauseIndicator,
  showToast
} from './loadingIndicators.js';
import {
  incrementNewTabCount,
  checkAndPrepareReviewPrompt,
  getReviewPromptHTML,
  addReviewPromptListeners,
  dismissPrompt,
  getShouldShowReviewPrompt,
  getReviewPromptData,
  showReviewPromptIfNeeded
} from './reviewPrompt.js';
// Share temporarily hidden — will return in a future version
// import { initShareMenu, setupShareButton } from './shareMenu.js';
import { setupInfoPopover } from './birdInfoPopover.js';
import { setupCreditPopovers } from './creditPopover.js';
import { escapeHtml, truncateName } from './utils/escapeHtml.js';
import { adaptSpeciesToBirdInfo } from './mediaClient.js';

// Initialize Sentry for content script
initSentry('content-script');

// Clock display mode constants
const CLOCK_DISPLAY_MODES = {
  OFF: 'off',
  CLOCK: 'clock',
  TIMER: 'timer'
};

let isMuted = false;
let volumeLevel = CONFIG.STORAGE_DEFAULTS.volumeLevel;
let lastVolumeLevel = CONFIG.STORAGE_DEFAULTS.volumeLevel;
let audio;
let fadeAudioInterval = null; // Interval for fading audio in/out
let isPlaying = false;
// shouldShowReviewPrompt and reviewPromptData are now managed by reviewPrompt.js
let birdInfo;
let quizMode;
let saveVolumeTimeout = null;

/**
 * Migrate from legacy clockEnabled to new clockDisplayMode enum
 * @returns {Promise<string>} The clock display mode ('off', 'clock', or 'timer')
 */
async function migrateClockSettings() {
  const storage = await new Promise((resolve) => {
    chrome.storage.local.get(['clockDisplayMode', 'clockEnabled'], resolve);
  });

  // If new format already exists, validate and return it
  if (storage.clockDisplayMode !== undefined) {
    // Validate mode value
    if (Object.values(CLOCK_DISPLAY_MODES).includes(storage.clockDisplayMode)) {
      return storage.clockDisplayMode;
    } else {
      // Invalid value found, reset to off
      log(`Invalid clockDisplayMode found: ${storage.clockDisplayMode}, resetting to 'off'`);
      await chrome.storage.local.set({ clockDisplayMode: CLOCK_DISPLAY_MODES.OFF });
      return CLOCK_DISPLAY_MODES.OFF;
    }
  }

  // One-time migration from old format
  // For fresh installs (neither clockDisplayMode nor clockEnabled exists),
  // default to CLOCK mode for better UX
  const mode = storage.clockEnabled !== undefined
    ? (storage.clockEnabled ? CLOCK_DISPLAY_MODES.CLOCK : CLOCK_DISPLAY_MODES.OFF)
    : CLOCK_DISPLAY_MODES.CLOCK; // Default for fresh installs

  // Set new format only - don't touch clockEnabled for backward compatibility
  await chrome.storage.local.set({ clockDisplayMode: mode });

  // TODO: Remove 'clockEnabled' key 5 versions after current (check manifest.json for current version)
  // Before removing, verify <1% of active users are on old versions via Chrome Web Store analytics
  // await chrome.storage.sync.remove(['clockEnabled']);

  log(`Migrated clock settings to mode: ${mode}`);
  return mode;
}

/**
 * Initialize clock display (clock or timer) based on mode
 * Handles migration and sets up storage listeners
 */
async function initClockDisplay() {
  // Migrate and get current mode
  const mode = await migrateClockSettings();

  // Initialize both clock and timer modules (but don't show them yet)
  await initClock();
  await initTimer();

  let effectiveMode = mode;

  switch (effectiveMode) {
    case CLOCK_DISPLAY_MODES.CLOCK:
      showClock();
      break;
    case CLOCK_DISPLAY_MODES.TIMER:
      showTimer();
      break;
    default:
      // Both hidden
      break;
  }

  // Listen for mode changes
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    if (changes.clockDisplayMode) {
      const newMode = changes.clockDisplayMode.newValue;

      // Validate mode value
      if (!Object.values(CLOCK_DISPLAY_MODES).includes(newMode)) {
        log(`Invalid clockDisplayMode: ${newMode}, defaulting to 'off'`);
        chrome.storage.local.set({ clockDisplayMode: CLOCK_DISPLAY_MODES.OFF });
        return;
      }

      // Note: When user clicks the "Switch to Clock/Timer" buttons, the click handler
      // immediately calls show/hide functions for responsive UI, then updates storage.
      // This listener will fire after and call show/hide again, which is harmless since
      // both showClock() and showTimer() are idempotent (safe to call multiple times).
      // This ensures consistency across all tabs and handles settings changes.
      switch (newMode) {
        case CLOCK_DISPLAY_MODES.CLOCK:
          hideTimer();
          showClock();
          break;
        case CLOCK_DISPLAY_MODES.TIMER:
          hideClock();
          showTimer();
          break;
        case CLOCK_DISPLAY_MODES.OFF:
          hideClock();
          hideTimer();
          break;
      }
    }
  });

  log(`Clock display initialized with mode: ${mode}, effective: ${effectiveMode}`);
}

const IMAGE_MAX_RETRIES = 3;
const IMAGE_RETRY_DELAY = 2000;

/**
 * Load bird info entirely from chrome.storage.local.
 * Reads in priority order:
 *   1. preloadedBird — random bird pre-picked by the background service worker
 *   2. media_manifest — pick a fresh random bird from the cached manifest
 * Returns null only if no manifest has ever been cached (fresh install, before first fetch).
 */
async function loadBirdFromStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['preloadedBird', 'media_manifest', 'autoPlay'], (result) => {
      const autoPlay = result.autoPlay || false;

      // 1. Use preloaded bird from background (fastest path)
      if (result.preloadedBird) {
        const bird = result.preloadedBird;
        bird.autoPlay = autoPlay;
        chrome.storage.local.remove('preloadedBird');
        log(`Using preloaded bird: ${bird.name}`);
        resolve(bird);
        return;
      }

      // 2. Pick a random bird from the cached manifest
      const manifest = result.media_manifest;
      if (manifest && manifest.species && manifest.regions) {
        const codes = manifest.regions.WLD?.speciesCodes ?? [];
        if (codes.length > 0) {
          const speciesMap = new Map(manifest.species.map(s => [s.speciesCode, s]));
          const randomCode = codes[Math.floor(Math.random() * codes.length)];
          const entry = speciesMap.get(randomCode);
          if (entry) {
            const bird = adaptSpeciesToBirdInfo(entry);
            if (bird) {
              bird.location = 'WLD';
              bird.autoPlay = autoPlay;
              log(`Using random bird from manifest: ${bird.name}`);
              resolve(bird);
              return;
            }
          }
        }
      }

      resolve(null);
    });
  });
}

/**
 * Poll chrome.storage.local until the background script finishes fetching the
 * manifest and preloading a bird. Used on fresh install / cache clear when
 * loadBirdFromStorage() initially returns null.
 */
async function waitForBirdData(maxWaitMs = 15000) {
  const POLL_INTERVAL = 500;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    const bird = await loadBirdFromStorage();
    if (bird) {
      log(`Bird data available after ${Date.now() - startTime}ms of polling`);
      return bird;
    }
  }

  log(`Bird data not available after ${maxWaitMs}ms of polling`);
  return null;
}

// Update play/pause button UI
const updatePlayPauseButton = () => {
  const playButton = document.getElementById('play-button');
  if (playButton) {
    playButton.innerHTML = isPlaying ?
      `<img src="images/svg/pause.svg" alt="${chrome.i18n.getMessage('pauseAlt')}" width="24" height="24">` :
      `<img src="images/svg/play.svg" alt="${chrome.i18n.getMessage('playAlt')}" width="16" height="16">`;
    // Don't overwrite the buffering tooltip while audio is loading
    if (!playButton.classList.contains('audio-buffering')) {
      playButton.title = isPlaying ?
        chrome.i18n.getMessage('pauseTooltip') :
        chrome.i18n.getMessage('playTooltip');
    }
  }
};

async function initializeAudio() {
  // If the user already clicked play before the image loaded, audio is
  // already active — don't interrupt it.
  if (audio && !audio.paused) {
    log('Audio already playing, skipping initializeAudio');
    return;
  }

  const isQuietHour = await isQuietHoursActive();

  if (isQuietHour) {
    showQuietHoursPill();
    showDisabledPlayButton();
  } else {
    const shouldAutoPlay = await getAutoPlayState();
    if (birdInfo && birdInfo.mediaUrl) {
      showAudioControls();
      if (!audio) {
        setPlayButtonBuffering(true);
      }
      if (shouldAutoPlay) {
        await playAudio();
      } else if (!audio) {
        loadAudioWithoutPlaying();
      }
    }
  }
}

let _bufferingReadyTimeout = null;

function setPlayButtonBuffering(buffering) {
  const btn = document.getElementById('play-button');
  if (!btn) return;

  if (_bufferingReadyTimeout) {
    clearTimeout(_bufferingReadyTimeout);
    _bufferingReadyTimeout = null;
  }

  if (buffering) {
    btn.classList.add('audio-buffering');
    btn.classList.remove('audio-buffering-ready');
    btn.title = chrome.i18n.getMessage('audioBufferingTooltip') || 'Loading bird sound…';
  } else {
    btn.classList.remove('audio-buffering');
    btn.classList.add('audio-buffering-ready');
    btn.title = isPlaying
      ? chrome.i18n.getMessage('pauseTooltip')
      : chrome.i18n.getMessage('playTooltip');
    _bufferingReadyTimeout = setTimeout(() => {
      _bufferingReadyTimeout = null;
      btn.classList.remove('audio-buffering-ready');
    }, 400);
  }
}

// Named handlers so they can be removed when the audio element is replaced.
function _onAudioWaiting() { setPlayButtonBuffering(true); }
function _onAudioReady() { setPlayButtonBuffering(false); }

function attachBufferingListeners(audioEl) {
  audioEl.addEventListener('waiting', _onAudioWaiting);
  audioEl.addEventListener('playing', _onAudioReady);
  audioEl.addEventListener('canplay', _onAudioReady);
  audioEl.addEventListener('error', _onAudioReady);
  audioEl.addEventListener('ended', _onAudioReady);
}

function detachBufferingListeners(audioEl) {
  audioEl.removeEventListener('waiting', _onAudioWaiting);
  audioEl.removeEventListener('playing', _onAudioReady);
  audioEl.removeEventListener('canplay', _onAudioReady);
  audioEl.removeEventListener('error', _onAudioReady);
  audioEl.removeEventListener('ended', _onAudioReady);
}


function hideAudioControls() {
  const playButton = document.getElementById('play-button');
  const volumeControl = document.getElementById('volume-control');
  if (playButton) playButton.style.display = 'none';
  if (volumeControl) volumeControl.style.display = 'none';
}

function showAudioControls() {
  const playButton = document.getElementById('play-button');
  const volumeControl = document.getElementById('volume-control');
  if (playButton) {
    playButton.style.display = 'inline-flex';
    playButton.disabled = false;
    playButton.classList.remove('disabled');
    if (!playButton.classList.contains('audio-buffering')) {
      playButton.title = chrome.i18n.getMessage('playTooltip');
    }
  }
  if (volumeControl) volumeControl.style.display = 'inline-flex';
}

// Show play button but disabled during quiet hours (photo mode only)
// Repositions play button after the moon icon for consistent ordering
function showDisabledPlayButton() {
  const playButton = document.getElementById('play-button');
  const volumeControl = document.getElementById('volume-control');

  if (playButton) {
    playButton.style.display = 'inline-flex';
    playButton.disabled = true;
    playButton.classList.add('disabled');
    playButton.title = chrome.i18n.getMessage('quietHoursActive') || 'Quiet hours active';

    // Re-append play button so it appears after moon icon (rightmost position)
    const controlButtons = document.querySelector('.control-buttons');
    if (controlButtons && playButton.parentNode) {
      playButton.parentNode.removeChild(playButton);
      controlButtons.appendChild(playButton);
    }
  }
  // Hide volume control during quiet hours
  if (volumeControl) volumeControl.style.display = 'none';
}

/**
 * Show quiet hours status pill indicator
 * Creates a pill-shaped indicator above control buttons that:
 * - Shows moon icon + "Quiet Hours" text
 * - Displays tooltip with time range on hover
 * - Shows close button on hover to disable quiet hours
 */
function showQuietHoursPill() {
  // Don't create if already exists
  if (document.getElementById('quiet-hours-pill')) return;

  const pill = document.createElement('div');
  pill.id = 'quiet-hours-pill';
  pill.className = 'quiet-hours-pill';

  // Get localized strings
  const quietHoursLabel = chrome.i18n.getMessage('quietHours') || 'Quiet Hours';
  const quietHoursTime = getQuietHoursText();
  const tooltipExplanation = chrome.i18n.getMessage('quietHoursTooltipExplanation') || 'Audio playback is paused during quiet hours.';
  const closeAlt = chrome.i18n.getMessage('closeAlt') || 'Close';

  pill.innerHTML = `
    <img src="images/svg/moon.svg" class="quiet-hours-pill-icon" alt="${chrome.i18n.getMessage('quietHoursAlt') || 'Quiet Hours'}" width="16" height="16">
    <span class="quiet-hours-pill-text">${quietHoursLabel}</span>
    <button class="quiet-hours-pill-close" aria-label="${closeAlt}" title="${chrome.i18n.getMessage('quietHoursDisabled') || 'Disable quiet hours'}">
      <img src="images/svg/close.svg" class="quiet-hours-pill-close-icon" alt="${closeAlt}" width="10" height="10">
    </button>
    <div class="quiet-hours-pill-tooltip">
      <div class="quiet-hours-pill-tooltip-title">${quietHoursLabel}</div>
      <div class="quiet-hours-pill-tooltip-time">${quietHoursTime}</div>
      <div class="quiet-hours-pill-tooltip-desc">${tooltipExplanation}</div>
    </div>
  `;

  // Setup close button click handler
  const closeBtn = pill.querySelector('.quiet-hours-pill-close');
  closeBtn.addEventListener('click', handleQuietHoursDisable);

  document.body.appendChild(pill);
}

/**
 * Handle disabling quiet hours from the pill close button
 */
async function handleQuietHoursDisable(event) {
  event.stopPropagation();

  // Disable quiet hours in storage
  await chrome.storage.local.set({ quietHours: false });

  // Remove the pill with animation
  const pill = document.getElementById('quiet-hours-pill');
  if (pill) {
    pill.classList.add('fade-out');
    setTimeout(() => {
      pill.remove();
    }, 200);
  }

  // Show toast notification
  const toastMessage = chrome.i18n.getMessage('quietHoursDisabled') || 'Quiet hours disabled';
  showToast(toastMessage, 'success');

  // Re-enable audio controls
  showAudioControls();

  log('Quiet hours disabled via pill');
}

// Skip duration to bypass recordist commentary at the start of bird call recordings
const AUDIO_SKIP_SECONDS = 4;

// Create a new Audio element for a bird call, with the initial commentary skipped
function createBirdAudio(url) {
  const el = new Audio(url);
  el.addEventListener('loadedmetadata', () => {
    if (el.currentTime < AUDIO_SKIP_SECONDS) {
      el.currentTime = AUDIO_SKIP_SECONDS;
    }
  }, { once: true });
  attachBufferingListeners(el);
  return el;
}

// Load audio without playing it (metadata-only preload)
function loadAudioWithoutPlaying() {
  if (fadeAudioInterval) {
    clearInterval(fadeAudioInterval);
    fadeAudioInterval = null;
  }
  if (audio) {
    detachBufferingListeners(audio);
    audio.pause();
    audio.src = '';
    audio = null;
  }
  audio = createBirdAudio(birdInfo.mediaUrl);
  audio.preload = 'metadata';
  audio.muted = isMuted;
  audio.volume = volumeLevel;
  audio.onended = () => {
    isPlaying = false;
    updatePlayPauseButton();
  };
  updatePlayPauseButton();
}

// Create a play button for media controls
function createPlayButton(onClickHandler) {
  const playButton = document.createElement('button');
  playButton.id = 'play-button';
  playButton.classList.add('icon-button', 'play-button');
  playButton.innerHTML = `<img src="images/svg/play.svg" alt="${chrome.i18n.getMessage('playAlt')}" width="16" height="16">`;
  playButton.title = chrome.i18n.getMessage('playTooltip');
  playButton.setAttribute('aria-label', chrome.i18n.getMessage('playTooltip') || 'Play');
  playButton.tabIndex = 0;
  playButton.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Don't trigger handler if button is disabled (quiet hours in photo mode)
    if (playButton.disabled) return;
    await onClickHandler();
  });
  return playButton;
}

// Create audio player UI for bird calls (image mode).
// Only builds the play button — does NOT attach an audio src or start
// any network activity. The actual audio element is wired up later by
// initializeAudio() which runs after the image has loaded.
function createAudioPlayer(mediaUrl) {
  if (!mediaUrl) {
    log('No media URL provided, skipping audio player creation');
    return null;
  }

  log('Creating audio player (UI only, no network)');
  return createPlayButton(togglePlay);
}

// Toggle play/pause
async function togglePlay() {
  if (isPlaying) {
    pauseAudio();
  } else {
    await playAudio();
  }
}

// Play audio
async function playAudio() {
  if (!birdInfo || !birdInfo.mediaUrl) {
    log('No media URL available, cannot play audio');
    return;
  }

  // Check for quiet hours - don't play during quiet hours
  const isQuietHour = await isQuietHoursActive();
  if (isQuietHour) {
    log('Audio playback blocked during quiet hours');
    return;
  }

  if (!audio) {
    audio = createBirdAudio(birdInfo.mediaUrl);
    audio.volume = volumeLevel;
    audio.muted = isMuted;
    audio.onended = () => {
      isPlaying = false;
      updatePlayPauseButton();
    };
  }
  try {
    await audio.play();
    isPlaying = true;
    updatePlayPauseButton();

    trackFeature('audio_play');

    // Fade in the audio gradually to the current volume level
    const targetVolume = isMuted ? 0 : volumeLevel;
    audio.volume = 0;
    // Clear any existing fade interval before starting a new one
    if (fadeAudioInterval) {
      clearInterval(fadeAudioInterval);
    }
    fadeAudioInterval = setInterval(function () {
      // Guard against audio being nullified during fade
      if (!audio) {
        clearInterval(fadeAudioInterval);
        fadeAudioInterval = null;
        return;
      }
      if (audio.volume < targetVolume - 0.1) {
        audio.volume += 0.1;
      } else {
        audio.volume = targetVolume;
        clearInterval(fadeAudioInterval);
        fadeAudioInterval = null;
      }
    }, 200);
  } catch (error) {
    // AbortError is expected when user opens multiple tabs quickly (background sends pauseAudio)
    // Don't log this as an error - it's normal behavior
    if (error.name === 'AbortError') {
      log('Audio playback interrupted (user opened another tab)');
      setPlayButtonBuffering(false);
      return;
    }

    if (error.name === 'NotSupportedError') {
      log('Audio unavailable (network issue)');
      setPlayButtonBuffering(false);
      return;
    }

    log(`Unexpected audio error: ${error.message}`);
    setPlayButtonBuffering(false);
    captureException(error, {
      tags: { operation: 'playAudio' },
      extra: {
        mediaUrl: birdInfo?.mediaUrl,
        currentTime: audio?.currentTime,
        volume: audio?.volume,
        muted: audio?.muted,
        errorName: error.name
      }
    });
  }
}

// Pause audio
function pauseAudio() {
  if (audio) {
    audio.pause();
    isPlaying = false;
    updatePlayPauseButton();
  }
}


// Resolves when the current bird image has loaded (or failed/timed out).
// Other modules use this to defer non-critical work until after first paint.
let _imageLoadedResolve = null;
let _imageLoaded = false;
const imageLoadedPromise = new Promise((resolve) => {
  _imageLoadedResolve = resolve;
});

function resolveImageLoaded() {
  if (_imageLoaded) return;
  _imageLoaded = true;
  _imageLoadedResolve();
}

const IMAGE_LOAD_TIMEOUT_MS = 20000;
let _imageLoadTimeoutId = null;

// Set image source and show it when loaded
// Includes retry logic for transient network failures
function setImageSource(imageUrl, retryCount = 0) {
  const img = document.querySelector('.background-image');
  if (!img) {
    log('setImageSource: .background-image element not found');
    resolveImageLoaded();
    return;
  }

  log('Setting image source');

  // Only create the fallback timeout once (on the first call).
  // Retries share the same timeout so it isn't stacked.
  if (retryCount === 0) {
    if (_imageLoadTimeoutId) clearTimeout(_imageLoadTimeoutId);
    _imageLoadTimeoutId = setTimeout(() => {
      _imageLoadTimeoutId = null;
      log('Image load timed out, unblocking deferred work');
      resolveImageLoaded();
    }, IMAGE_LOAD_TIMEOUT_MS);
  }

  img.onload = function () {
    if (_imageLoadTimeoutId) {
      clearTimeout(_imageLoadTimeoutId);
      _imageLoadTimeoutId = null;
    }
    log('Image loaded successfully');
    img.classList.remove('hidden');
    resolveImageLoaded();
  };

  img.onerror = function () {
    if (retryCount < IMAGE_MAX_RETRIES) {
      log(`Image load failed, retrying (${retryCount + 1}/${IMAGE_MAX_RETRIES})...`);
      setTimeout(() => {
        img.src = '';
        setImageSource(imageUrl, retryCount + 1);
      }, IMAGE_RETRY_DELAY);
    } else {
      if (_imageLoadTimeoutId) {
        clearTimeout(_imageLoadTimeoutId);
        _imageLoadTimeoutId = null;
      }
      log('Image failed to load after all retries');
      resolveImageLoaded();
    }
  };

  img.src = imageUrl;
}

// Main function to update the page with new bird information
async function initializePage() {
  incrementNewTabCount();
  await checkAndPrepareReviewPrompt();
  log('Initializing page');
  restoreNonEssentialUI();
  showLoadingIndicator();
  document.body.classList.add('loaded');
  const loadingInterval = setInterval(updateLoadingMessage, 2000);

  try {
    // Load bird data entirely from chrome.storage.local.
    // Priority: pendingBirdInfo (history selection) → preloadedBird → manifest → history
    let usedHistoryFallback = false;

    const pendingBird = await new Promise((resolve) => {
      chrome.storage.local.get(['pendingBirdInfo'], (result) => {
        if (result.pendingBirdInfo) {
          chrome.storage.local.remove(['pendingBirdInfo']);
          resolve(result.pendingBirdInfo);
        } else {
          resolve(null);
        }
      });
    });

    if (pendingBird) {
      birdInfo = pendingBird;
      usedHistoryFallback = true;
      log(`Using pending bird from history: ${birdInfo.name}`);
    } else {
      birdInfo = await loadBirdFromStorage();
    }

    // If no bird data yet, the background script may still be fetching the
    // manifest (fresh install, cache clear, slow network). Poll storage
    // until data appears or we time out.
    if (!birdInfo) {
      log('No bird data in storage, waiting for background to finish fetching...');
      birdInfo = await waitForBirdData(15000);
    }

    if (!birdInfo) {
      // Last resort: most recent bird from viewing history
      const history = await getHistory();
      if (history.length > 0) {
        birdInfo = history[history.length - 1];
        usedHistoryFallback = true;
        log(`Using cached bird from history: ${birdInfo.name}`);
      } else {
        throw new Error('NETWORK_ERROR_NO_CACHE');
      }
    }

    if (!usedHistoryFallback) {
      await addToHistory(birdInfo);
    }

    // Signal the background to preload the next bird, but only after the
    // current image is visible so it doesn't compete for bandwidth.
    imageLoadedPromise.then(() => {
      const schedulePreload = window.requestIdleCallback || ((cb) => setTimeout(cb, 200));
      schedulePreload(() => {
        chrome.runtime.sendMessage({ action: 'preloadNext' }, () => {
          if (chrome.runtime.lastError) {
            log(`Preload signal failed: ${chrome.runtime.lastError.message}`);
          }
        });
      });
    });

    // initShareMenu(() => birdInfo);

    // add artificial delay of about 4 seconds to simulate a slow loading experience
    // await new Promise(resolve => setTimeout(resolve, 4000));


    clearInterval(loadingInterval);
    hideLoadingIndicator();

    log(`Displaying bird: ${birdInfo.name}`);

    // Track session start with user settings and bird info
    try {
      const settings = await new Promise((resolve) => {
        chrome.storage.local.get(['autoPlay', 'quietHours', 'quickAccessEnabled', 'clockDisplayMode', 'installTime'], resolve);
      });
      trackSessionStart({
        region: 'WLD',
        videoMode: false,
        autoPlay: settings.autoPlay || false,
        quietHours: settings.quietHours || false,
        highResImages: false,
        quickAccessEnabled: settings.quickAccessEnabled || false,
        clockDisplayMode: settings.clockDisplayMode || 'off',
        speciesCode: birdInfo.speciesCode || null,
        hasAudio: !!birdInfo.mediaUrl,
        hasVideo: false,
      }, settings.installTime || null);
    } catch (analyticsError) {
      log(`Analytics error: ${analyticsError.message}`);
    }

    const contentContainer = document.getElementById('content-container');

    const imgSource = birdInfo.imageSource || '';
    const imgSourceUrl = birdInfo.imageSourceUrl || '';
    const imgLicense = birdInfo.imageLicense || '';
    const imgLicenseUrl = birdInfo.imageLicenseUrl || '';
    const imgTitle = birdInfo.imageTitle || '';
    const imgCaption = birdInfo.imageCaption || '';
    const imgLocation = birdInfo.imageLocation || '';
    const imgLat = birdInfo.imageLatitude || '';
    const imgLon = birdInfo.imageLongitude || '';
    const imgDate = birdInfo.imageDate || '';
    const imgResized = birdInfo.imageResized !== undefined ? birdInfo.imageResized : false;

    const audSource = birdInfo.audioSource || '';
    const audSourceUrl = birdInfo.audioSourceUrl || '';
    const audLicense = birdInfo.audioLicense || '';
    const audLicenseUrl = birdInfo.audioLicenseUrl || '';
    const audTitle = birdInfo.audioTitle || '';
    const audSoundType = birdInfo.audioSoundType || '';
    const audLocation = birdInfo.audioLocation || '';
    const audLat = birdInfo.audioLatitude || '';
    const audLon = birdInfo.audioLongitude || '';
    const audDate = birdInfo.audioDate || '';
    const audConvertedFormat = birdInfo.audioConvertedFormat || '';

    const creditsHtml = `
      <span class="credit-item"
        data-credit-type="photo"
        data-credit-name="${escapeHtml(birdInfo.photographer)}"
        data-credit-url="${escapeHtml(birdInfo.photographerUrl)}"
        data-credit-source="${escapeHtml(imgSource)}"
        data-credit-source-url="${escapeHtml(imgSourceUrl)}"
        data-credit-license="${escapeHtml(imgLicense)}"
        data-credit-license-url="${escapeHtml(imgLicenseUrl)}"
        data-credit-title="${escapeHtml(imgTitle)}"
        data-credit-caption="${escapeHtml(imgCaption)}"
        data-credit-location="${escapeHtml(imgLocation)}"
        data-credit-lat="${escapeHtml(imgLat)}"
        data-credit-lon="${escapeHtml(imgLon)}"
        data-credit-date="${escapeHtml(imgDate)}"
        data-credit-resized="${imgResized}">
        <img src="images/svg/camera.svg" alt="${chrome.i18n.getMessage('cameraAlt')}" width="16" height="16">
        <a href="${escapeHtml(birdInfo.photographerUrl)}" target="_blank">${escapeHtml(truncateName(birdInfo.photographer))}</a>
      </span>
      ${birdInfo.mediaUrl ? `
      <span class="credit-item"
        data-credit-type="audio"
        data-credit-name="${escapeHtml(birdInfo.recordist)}"
        data-credit-url="${escapeHtml(birdInfo.recordistUrl)}"
        data-credit-source="${escapeHtml(audSource)}"
        data-credit-source-url="${escapeHtml(audSourceUrl)}"
        data-credit-license="${escapeHtml(audLicense)}"
        data-credit-license-url="${escapeHtml(audLicenseUrl)}"
        data-credit-title="${escapeHtml(audTitle)}"
        data-credit-sound-type="${escapeHtml(audSoundType)}"
        data-credit-location="${escapeHtml(audLocation)}"
        data-credit-lat="${escapeHtml(audLat)}"
        data-credit-lon="${escapeHtml(audLon)}"
        data-credit-date="${escapeHtml(audDate)}"
        data-credit-converted-format="${escapeHtml(audConvertedFormat)}">
        <img src="images/svg/microphone.svg" alt="${chrome.i18n.getMessage('audioAlt')}" width="16" height="16">
        <a href="${escapeHtml(birdInfo.recordistUrl)}" target="_blank">${escapeHtml(truncateName(birdInfo.recordist))}</a>
      </span>
      ` : ''}
    `;

    const creditInfoData = {
      photo: {
        name: birdInfo.photographer,
        url: birdInfo.photographerUrl,
        source: imgSource,
        sourceUrl: imgSourceUrl,
        license: imgLicense,
        licenseUrl: imgLicenseUrl,
        title: imgTitle,
        caption: imgCaption,
        location: imgLocation,
        lat: imgLat,
        lon: imgLon,
        date: imgDate,
        resized: imgResized,
      },
      ...(birdInfo.mediaUrl ? {
        audio: {
          name: birdInfo.recordist,
          url: birdInfo.recordistUrl,
          source: audSource,
          sourceUrl: audSourceUrl,
          license: audLicense,
          licenseUrl: audLicenseUrl,
          title: audTitle,
          soundType: audSoundType,
          location: audLocation,
          lat: audLat,
          lon: audLon,
          date: audDate,
          convertedFormat: audConvertedFormat,
        },
      } : {}),
    };

    contentContainer.innerHTML = `
      <img src="" alt="${escapeHtml(birdInfo.name)}" class="background-image" decoding="async" fetchpriority="high">
      <div class="gradient-overlay"></div>
      <div class="info-panel">
        <div class="info-panel-header">
          <div class="bird-name-row">
            <button class="info-popover-trigger" id="bird-name" aria-expanded="false" aria-haspopup="dialog"
              data-scientific-name="${escapeHtml(birdInfo.scientificName)}"
              data-description="${escapeHtml(birdInfo.description)}"
              data-conservation="${escapeHtml(birdInfo.conservationStatus)}"
              data-species-code="${escapeHtml(birdInfo.speciesCode)}"
              data-ebird-url="${escapeHtml(birdInfo.ebirdUrl)}">
            </button>
            <button class="low-distraction-toggle" id="low-distraction-toggle"
              title="${chrome.i18n.getMessage('lowDistractionToggle') || 'Hide details'}"
              aria-label="${chrome.i18n.getMessage('lowDistractionAriaHide') || 'Hide bird information panel'}">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 6l4 4 4-4"/>
              </svg>
            </button>
          </div>
        </div>
        <p class="credits">
          <span class="credit-item credit-icon-group">
            <a href="mailto:support@birdtab.app" class="feedback-inline-link" title="${chrome.i18n.getMessage('sendFeedback') || 'Send Feedback'}">
              <img src="images/svg/message.svg" alt="${chrome.i18n.getMessage('sendFeedback') || 'Send Feedback'}" width="16" height="16">
            </a>
          </span>
          <!-- Share icon temporarily hidden — will return in a future version
          <span id="share-container" class="credit-item share-container credit-icon-group">
            <button id="share-button" class="share-inline-button" title="${chrome.i18n.getMessage('shareTooltip')}">
              <img src="images/svg/share.svg" alt="${chrome.i18n.getMessage('shareAlt')}" width="16" height="16">
            </button>
          </span>
          -->
          <span class="credit-attribution">${creditsHtml}</span>
          <span class="credit-item credit-info-trigger" id="credit-info-trigger" title="${chrome.i18n.getMessage('creditInfoTitle') || 'Media credits & licenses'}">
            <img src="images/svg/info-circle.svg" alt="${chrome.i18n.getMessage('creditInfoAlt') || 'Credits & licenses'}" width="16" height="16">
          </span>
        </p>
      </div>
      <div class="control-buttons">
        <button id="settings-button" class="icon-button" aria-label="${chrome.i18n.getMessage('openSettings')}" title="${chrome.i18n.getMessage('settingsTooltip')}">
          <img src="images/svg/settings.svg" alt="${chrome.i18n.getMessage('settingsAlt')}" width="24" height="24">
        </button>
        <button id="refresh-button" class="icon-button" title="${chrome.i18n.getMessage('refreshTooltip')}">
          <img src="images/svg/refresh.svg" alt="${chrome.i18n.getMessage('refreshAlt')}" width="24" height="24">
        </button>
        ${birdInfo.mediaUrl ? `
        <div id="volume-control" class="volume-control">
          <button id="volume-button" class="icon-button" title="${chrome.i18n.getMessage('volumeTooltip')}">
            <img src="images/svg/sound-on.svg" alt="${chrome.i18n.getMessage('volumeAlt')}" width="24" height="24">
          </button>
          <div id="volume-slider-container" class="volume-slider-container">
            <input type="range" id="volume-slider" class="volume-slider" min="0" max="100" value="80" orient="vertical">
          </div>
        </div>
        ` : ''}
      </div>
      <button class="low-distraction-expand" id="low-distraction-expand"
        title="${chrome.i18n.getMessage('lowDistractionExpand') || 'Show details'}"
        aria-label="${chrome.i18n.getMessage('lowDistractionAriaShow') || 'Show bird information panel'}">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 10l4-4 4 4"/>
        </svg>
      </button>
    `;

    setImageSource(birdInfo.imageUrl);

    if (birdInfo.mediaUrl) {
      const audioPlayer = createAudioPlayer(birdInfo.mediaUrl);
      if (audioPlayer) {
        document.querySelector('.control-buttons').appendChild(audioPlayer);
      }

      chrome.storage.local.get(['isMuted', 'volumeLevel'], (result) => {
        isMuted = result.isMuted || false;
        volumeLevel = result.volumeLevel !== undefined ? result.volumeLevel : CONFIG.STORAGE_DEFAULTS.volumeLevel;
        lastVolumeLevel = volumeLevel > 0 ? volumeLevel : CONFIG.STORAGE_DEFAULTS.volumeLevel;
        updateVolumeControl();
        if (audio) {
          audio.muted = isMuted;
          audio.volume = isMuted ? 0 : volumeLevel;
        }
      });

      setupVolumeControl();
      updateVolumeControl();
      setupMediaClickHandler();
    } else {
      log('No audio URL found in bird info');
      hideAudioControls();
    }


    const lang = chrome.i18n.getUILanguage();
    let nameToDisplay = birdInfo.name;

    if (lang && birdInfo.primaryComName_fr && lang.toLowerCase().startsWith('fr')) {
      nameToDisplay = birdInfo.primaryComName_fr;
    } else if (lang && birdInfo.primaryComName_cn && lang.toLowerCase().startsWith('zh')) {
      nameToDisplay = birdInfo.primaryComName_cn;
    }

    document.getElementById('bird-name').textContent = nameToDisplay;

    document.getElementById('refresh-button').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      trackFeature('refresh');
      window.location.reload();
    });

    // Initialize Chrome tab link
    initializeChromeTab();

    // setupShareButton();

    // After updating the page content, add the review prompt if needed
    showReviewPromptIfNeeded(document.body);

    setupInfoPopover({
      onEbirdClick: () => trackFeature('ebird_click'),
    });
    setupCreditPopovers(creditInfoData);
    initLowDistractionMode();

    // Initialize settings modal immediately after DOM elements are created
    try {
      new SettingsSidebar();
    } catch (error) {
      log(`Failed to initialize settings modal: ${error.message}`);
      captureException(error, {
        tags: { operation: 'initializeSettingsSidebar' }
      });
    }

    // Initialize control options menu (settings, history, quiz)
    try {
      const settingsButton = document.getElementById('settings-button');
      if (settingsButton) {
        createOptionsMenu({
          triggerElement: settingsButton,
          anchorElement: settingsButton,
          menuId: 'control-options-menu',
          position: 'top',
          getOptions: () => [
            {
              type: 'button',
              label: chrome.i18n.getMessage('settingsAlt') || 'Settings',
              icon: 'images/svg/settings.svg',
              onClick: () => {
                trackFeature('settings');
                SettingsSidebar.getInstance().open();
              }
            },
            {
              type: 'button',
              label: chrome.i18n.getMessage('historyAlt') || 'History',
              icon: 'images/svg/history.svg',
              onClick: () => {
                trackFeature('history');
                openHistoryModal();
              }
            },
            {
              type: 'button',
              label: chrome.i18n.getMessage('quizAlt') || 'Quiz',
              icon: 'images/svg/quiz.svg',
              onClick: () => {
                if (quizMode && !quizMode.isActive) {
                  quizMode.startQuiz();
                }
              }
            }
          ]
        });
      }
    } catch (error) {
      log(`Failed to initialize control options menu: ${error.message}`);
      captureException(error, {
        tags: { operation: 'initializeControlOptionsMenu' }
      });
    }

    // Defer audio initialization until the image is visible so audio
    // downloads don't compete with the critical first-paint resource.
    imageLoadedPromise.then(() => initializeAudio()).catch((err) => {
      log(`Audio initialization failed: ${err.message}`);
      captureException(err, { tags: { operation: 'initializeAudio' } });
    });
    log('Page ready');
  } catch (error) {
    clearInterval(loadingInterval);
    hideLoadingIndicator();
    log(`Error updating page: ${error.message}`);
    captureException(error, {
      tags: { operation: 'initializePage' }
    });
    document.body.classList.add('loaded');
    hideNonEssentialUI();
    showErrorModal(error.message);
  }
}

function showErrorModal(errorMessage) {
  // Check if this is a network error with no cached birds
  if (errorMessage === 'NETWORK_ERROR_NO_CACHE') {
    showNetworkErrorState();
    return;
  }

  const errorModal = document.getElementById('error-modal');
  const errorDetails = errorModal.querySelector('.error-details');
  errorDetails.textContent = `${chrome.i18n.getMessage('errorDetails')}: ${errorMessage}`;
  errorModal.classList.remove('hidden');

  const retryButton = document.getElementById('retry-button');
  // Remove existing event listeners to prevent multiple bindings
  retryButton.removeEventListener('click', retryHandler);
  retryButton.addEventListener('click', retryHandler);
}

const NON_ESSENTIAL_UI_SELECTORS = [
  '#chrome-tab-link',
  '.top-sites-container',
  '.clock-container',
  '.timer-container',
];

/**
 * Hide non-essential UI elements (search, chrome tab, top sites, clock)
 * so they don't overlap error states.
 * Note: #search-container is excluded because its visibility is managed by
 * applySearchVisibility() based on the quickAccessEnabled setting. Clearing
 * its inline style here would revert it to the CSS default (display: none).
 */
function hideNonEssentialUI() {
  NON_ESSENTIAL_UI_SELECTORS.forEach(selector => {
    const el = document.querySelector(selector);
    if (el) el.style.display = 'none';
  });
  applySearchVisibility(false);
}

/**
 * Restore non-essential UI elements hidden by hideNonEssentialUI().
 * Called at the start of initializePage() so a retry from error state
 * restores everything.
 */
function restoreNonEssentialUI() {
  NON_ESSENTIAL_UI_SELECTORS.forEach(selector => {
    const el = document.querySelector(selector);
    if (el) el.style.display = '';
  });
  // Re-apply search visibility from settings instead of blindly clearing
  // the inline style (which would revert to CSS display: none).
  initializeSearch();
}

// Show beautiful network error state when no cached birds are available
function showNetworkErrorState() {
  document.body.classList.add('loaded');
  hideNonEssentialUI();

  const contentContainer = document.getElementById('content-container');
  contentContainer.innerHTML = `
    <div class="network-error-container">
      <div class="network-error-content">
        <div class="network-error-icon">
          <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="40" cy="40" r="38" stroke="currentColor" stroke-width="2" stroke-dasharray="6 4" opacity="0.3"/>
            <path d="M40 20C40 20 25 28 25 40C25 52 40 60 40 60" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.6"/>
            <path d="M40 20C40 20 55 28 55 40C55 52 40 60 40 60" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.6"/>
            <circle cx="40" cy="35" r="4" fill="currentColor" opacity="0.8"/>
            <path d="M32 45C32 45 35 50 40 50C45 50 48 45 48 45" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.6"/>
          </svg>
        </div>
        <h1 class="network-error-title">${chrome.i18n.getMessage('networkErrorTitle')}</h1>
        <p class="network-error-message">${chrome.i18n.getMessage('networkErrorMessage')}</p>
        <p class="network-error-suggestion">${chrome.i18n.getMessage('networkErrorSuggestion')}</p>
        <div class="network-error-actions">
          <button id="network-retry-button" class="network-error-btn primary">
            <img src="images/svg/refresh.svg" alt="${chrome.i18n.getMessage('refreshAlt')}" width="18" height="18">
            <span>${chrome.i18n.getMessage('tryAgain')}</span>
          </button>
          <a href="mailto:support@birdtab.app?subject=BirdTab%20Network%20Issue" class="network-error-btn secondary">
            <span>${chrome.i18n.getMessage('contactSupport')}</span>
          </a>
        </div>
      </div>
    </div>
  `;

  // Add event listener for retry button
  document.getElementById('network-retry-button').addEventListener('click', () => {
    window.location.reload();
  });
}

function retryHandler() {
  const errorModal = document.getElementById('error-modal');
  errorModal.classList.add('hidden');
  initializePage();
}

// Update volume control UI
function updateVolumeControl() {
  const volumeButton = document.getElementById('volume-button');
  const volumeSlider = document.getElementById('volume-slider');

  if (volumeButton) {
    const iconSrc = (isMuted || volumeLevel === 0) ? 'sound-off.svg' : 'sound-on.svg';
    volumeButton.innerHTML = `<img src="images/svg/${iconSrc}" alt="${chrome.i18n.getMessage('volumeAlt')}" width="24" height="24">`;
    volumeButton.title = chrome.i18n.getMessage('volumeTooltip');
  }

  if (volumeSlider) {
    // Reverse the exponential calculation for slider position: slider = sqrt(volume) * 100
    const sliderValue = Math.round(Math.sqrt(volumeLevel) * 100);
    volumeSlider.value = sliderValue;
    // Update CSS custom property for visual feedback
    volumeSlider.style.setProperty('--volume-percentage', `${sliderValue}%`);
  }
}

// Setup volume control event handlers
function setupVolumeControl() {
  const volumeButton = document.getElementById('volume-button');
  const volumeSlider = document.getElementById('volume-slider');
  const volumeControl = document.getElementById('volume-control');
  const sliderContainer = document.getElementById('volume-slider-container');

  if (!volumeButton || !volumeSlider || !volumeControl || !sliderContainer) return;

  let hoverTimer;

  // Volume button click handler
  volumeButton.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleMute();
  });

  // Volume button keyboard handler (Arrow keys)
  volumeButton.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      // Increase volume
      // Calculate next step based on exponential curve to make it feel natural
      // Current slider position:
      const currentSlider = Math.sqrt(volumeLevel);
      // Move slider by 5%
      const newSlider = Math.min(1, currentSlider + 0.05);
      const newVolume = Math.pow(newSlider, 2);
      setVolume(newVolume);

      // Expand slider visually for feedback
      sliderContainer.classList.add('visible');
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => {
        sliderContainer.classList.remove('visible');
      }, 1000);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      // Decrease volume
      const currentSlider = Math.sqrt(volumeLevel);
      const newSlider = Math.max(0, currentSlider - 0.05);
      const newVolume = Math.pow(newSlider, 2);
      setVolume(newVolume);

      // Expand slider visually for feedback
      sliderContainer.classList.add('visible');
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => {
        sliderContainer.classList.remove('visible');
      }, 1000);
    }
  });

  // Volume slider change handler
  volumeSlider.addEventListener('input', (e) => {
    // strict linear volume control
    // const newVolume = parseFloat(e.target.value) / 100;

    // Non-linear volume control (exponential)
    // Helps with finer control at lower volumes
    // Volume = (slider/100)^2
    const sliderValue = parseFloat(e.target.value) / 100;
    const newVolume = Math.pow(sliderValue, 2);
    setVolume(newVolume);
  });

  // Hover behavior for showing slider
  volumeControl.addEventListener('mouseenter', () => {
    clearTimeout(hoverTimer);
    sliderContainer.classList.add('visible');
  });

  volumeControl.addEventListener('mouseleave', () => {
    hoverTimer = setTimeout(() => {
      sliderContainer.classList.remove('visible');
    }, 300);
  });

  // Keep slider visible when hovering over it
  sliderContainer.addEventListener('mouseenter', () => {
    clearTimeout(hoverTimer);
  });
}

// Toggle mute state
function toggleMute() {
  if (isMuted) {
    // Unmute: restore last volume level
    isMuted = false;
    if (lastVolumeLevel === 0) lastVolumeLevel = CONFIG.STORAGE_DEFAULTS.volumeLevel;
    setVolume(lastVolumeLevel, true); // immediate save for mute/unmute
  } else {
    // Mute: save current volume and set to 0
    if (volumeLevel > 0) lastVolumeLevel = volumeLevel;
    isMuted = true;
    setVolume(0, true); // immediate save for mute/unmute
  }
}

// Set volume level
function setVolume(newLevel, immediate = false) {
  volumeLevel = Math.max(0, Math.min(1, newLevel));

  // Auto-mute/unmute based on volume level
  if (volumeLevel === 0 && !isMuted) {
    isMuted = true;
  } else if (volumeLevel > 0 && isMuted) {
    isMuted = false;
  }

  if (audio) {
    audio.volume = volumeLevel;
    audio.muted = isMuted;
  }

  updateVolumeControl();
  saveVolumeState(immediate);
}

// Save volume state to chrome storage with debouncing
function saveVolumeState(immediate = false) {
  // Clear existing timeout
  if (saveVolumeTimeout) {
    clearTimeout(saveVolumeTimeout);
  }

  if (immediate) {
    // Save immediately (for mute/unmute actions)
    chrome.storage.local.set({ isMuted, volumeLevel }, () => {
      if (chrome.runtime.lastError) {
        log(`Failed to save volume state: ${chrome.runtime.lastError.message}`);
      } else {
        log(`Volume state saved - muted: ${isMuted}, level: ${volumeLevel}`);
      }
    });
  } else {
    // Debounce for volume slider movements
    saveVolumeTimeout = setTimeout(() => {
      chrome.storage.local.set({ isMuted, volumeLevel }, () => {
        if (chrome.runtime.lastError) {
          log(`Failed to save volume state: ${chrome.runtime.lastError.message}`);
        } else {
          log(`Volume state saved - muted: ${isMuted}, level: ${volumeLevel}`);
        }
      });
    }, 500); // Wait 500ms after last volume change
  }
}

// Track if media click handler is already set up to avoid duplicate listeners
let mediaClickHandlerSetup = false;

// Clicking anywhere on the page (except interactive elements) will toggle audio play/pause
function setupMediaClickHandler() {
  // Prevent duplicate event listeners
  if (mediaClickHandlerSetup) return;

  mediaClickHandlerSetup = true;

  document.body.addEventListener('click', async function (e) {
    // Check if any options menu is currently open
    // If so, this click is likely meant to close it, not toggle media
    const openOptionsMenu = document.querySelector('.options-menu-visible');
    if (openOptionsMenu) {
      return; // Let the options menu handler handle this click
    }

    // Check if info popover is open — click is meant to close it, not toggle media
    const openPopover = document.querySelector('.info-popover');
    if (openPopover) {
      return;
    }

    // List of interactive elements to ignore
    const interactiveSelectors = [
      'button', 'a', 'input', 'select', 'textarea', 'label',
      '.icon-button', '.control-buttons', '.volume-control',
      '.settings-sidebar', '.quiz-mode',
      '.search-container',
      '.options-menu', '.options-menu-item',
      '.info-popover',
      '.credit-popover',
      '.credit-info-trigger',
      '#clock-options-trigger',
      '.timer-controls', '.timer-digit-group', '.timer-preset-btn', '.timer-start-btn', '.timer-time',
      '.confirmation-dialog', '.confirmation-dialog-backdrop',
      '.share-container', '.share-menu'
    ];

    // Check if click target or its parents match any interactive selector
    const isInteractive = interactiveSelectors.some(selector => {
      return e.target.closest(selector) !== null;
    });

    if (isInteractive) return;

    e.preventDefault();

    if (audio) {
      const isQuietHour = await isQuietHoursActive();
      if (isQuietHour) return;

      if (isPlaying) {
        showMediaPauseIndicator();
        pauseAudio();
      } else {
        showMediaPlayIndicator();
        await playAudio();
      }
    }
  });
}

// Combined message listener to handle all background messages.
// IMPORTANT: This must NOT be async. An async listener returns a Promise,
// which Chrome does not treat as `return true`. When multiple extension pages
// (e.g. multiple new tab instances) each have an async onMessage listener,
// Chrome may close the sendMessage channel prematurely, causing the background
// script's response to be lost ("No response from background script").
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "refreshBird") {
    location.reload();
  } else if (request.action === "toggleMute") {
    toggleMute();
  } else if (request.action === "quietHoursChanged") {
    if (request.quietHoursEnabled) {
      isQuietHoursActive().then(isQuietHour => {
        if (isQuietHour && isPlaying) {
          pauseAudio();
        }
      });
    }
  } else if (request.action === "pauseAudio") {
    if (audio && !audio.paused) {
      pauseAudio();
    }
  }
});

let _lowDistractionTimer = null;
let _lowDistractionActive = false;

function setLowDistractionState(enabled, animate = true) {
  if (enabled === _lowDistractionActive && animate) return;

  const infoPanel = document.querySelector('.info-panel');
  const expandBtn = document.getElementById('low-distraction-expand');

  if (!infoPanel || !expandBtn) return;

  _lowDistractionActive = enabled;

  if (_lowDistractionTimer) {
    clearTimeout(_lowDistractionTimer);
    _lowDistractionTimer = null;
  }

  if (!animate) {
    infoPanel.style.transition = 'none';
  }

  if (enabled) {
    infoPanel.classList.add('low-distraction-hidden');
    const delay = animate ? 200 : 0;
    _lowDistractionTimer = setTimeout(() => expandBtn.classList.add('visible'), delay);
  } else {
    expandBtn.classList.remove('visible');
    const delay = animate ? 150 : 0;
    _lowDistractionTimer = setTimeout(() => {
      infoPanel.classList.remove('low-distraction-hidden');
    }, delay);
  }

  if (!animate) {
    infoPanel.offsetHeight;
    infoPanel.style.transition = '';
  }
}

function initLowDistractionMode() {
  const toggleBtn = document.getElementById('low-distraction-toggle');
  const expandBtn = document.getElementById('low-distraction-expand');

  if (!toggleBtn || !expandBtn) return;

  chrome.storage.local.get('lowDistractionMode', (result) => {
    if (result.lowDistractionMode) {
      setLowDistractionState(true, false);
    }
  });

  toggleBtn.addEventListener('click', () => {
    chrome.storage.local.set({ lowDistractionMode: true });
    setLowDistractionState(true);
    trackFeature('low_distraction_on');
  });

  expandBtn.addEventListener('click', () => {
    chrome.storage.local.set({ lowDistractionMode: false });
    setLowDistractionState(false);
    trackFeature('low_distraction_off');
  });
}


// Volume keyboard shortcuts (Up/Down arrows)
function setupVolumeKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Volume controls (Up/Down arrows) - only when not in an input field
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const newVolume = Math.min(1, Math.round((volumeLevel + CONFIG.VOLUME_STEP) * 10) / 10);
        setVolume(newVolume);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const newVolume = Math.max(0, Math.round((volumeLevel - CONFIG.VOLUME_STEP) * 10) / 10);
        setVolume(newVolume);
      }
    }
  });
}

// Check if onboarding is complete before initializing
function checkOnboardingStatus() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['onboardingComplete'], (result) => {
      if (!result.onboardingComplete) {
        // Redirect to onboarding
        window.location.href = 'onboarding.html';
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

/**
 * Check if top sites are visible in settings but permissions are missing
 * This handles the case where settings are synced from another device but permissions aren't
 * If hideTopSites is false (meaning top sites should show) but we don't have permission,
 * we set hideTopSites to true to match the permission state.
 */
async function checkSyncedQuickAccessPermissions() {
  try {
    // Get the settings from storage
    const result = await new Promise((resolve) => {
      chrome.storage.local.get(['quickAccessEnabled', 'hideTopSites'], resolve);
    });

    // If quick access is not enabled or top sites are already hidden, nothing to do
    if (!result.quickAccessEnabled || result.hideTopSites !== false) {
      return;
    }

    // hideTopSites is false (meaning top sites should be visible)
    // Check if we have the required permissions
    const hasPermissions = await chrome.permissions.contains({
      permissions: ['topSites']
    });

    // If we have permissions, nothing to do
    if (hasPermissions) {
      return;
    }

    // Settings say show top sites, but permissions are missing
    // This likely means settings synced from another device
    // Hide top sites to match permission state (user can enable via options menu)
    log('Top sites enabled but permissions missing - hiding top sites');
    addBreadcrumb('Synced top sites detected without permissions - hiding', 'info', 'info');

    await new Promise((resolve) => {
      chrome.storage.local.set({ hideTopSites: true }, resolve);
    });
  } catch (error) {
    log('Error checking synced quick access permissions: ' + error.message);
    captureException(error, {
      tags: { operation: 'checkSyncedQuickAccessPermissions' }
    });
  }
}

// Initialize page when DOM content is loaded
document.addEventListener('DOMContentLoaded', async () => {
  // Start performance monitoring transaction
  const transaction = startTransaction('page-load', 'navigation');

  // Initialize analytics (PostHog)
  await initAnalytics('newtab');

  // Localize the page immediately
  localizeHtml();

  log('DOM content loaded, checking onboarding status');
  addBreadcrumb('DOM content loaded', 'navigation', 'info');

  // Check if onboarding is complete first
  const shouldContinue = await checkOnboardingStatus();
  if (!shouldContinue) {
    log('Redirecting to onboarding');
    return;
  }

  log('Onboarding complete, initializing UI components first');

  // Check if quick access is enabled but permissions are missing (synced from another device)
  await checkSyncedQuickAccessPermissions();

  // Load volume settings initially
  chrome.storage.local.get(['isMuted', 'volumeLevel'], (result) => {
    isMuted = result.isMuted || false;
    volumeLevel = result.volumeLevel !== undefined ? result.volumeLevel : CONFIG.STORAGE_DEFAULTS.volumeLevel;
    lastVolumeLevel = volumeLevel > 0 ? volumeLevel : CONFIG.STORAGE_DEFAULTS.volumeLevel;
    updateVolumeControl();
  });

  // Setup volume control event listeners
  setupVolumeControl();

  // Initialize search box and top sites immediately for better UX
  initializeSearch();

  // Setup keyboard shortcuts (search focus and volume)
  setupSearchKeyboardShortcut();
  setupVolumeKeyboardShortcuts();

  // Initialize top sites
  try {
    window.topSitesInstance = new TopSites();
    await window.topSitesInstance.initialize();
  } catch (error) {
    captureException(error, {
      tags: { operation: 'initializeTopSites' }
    });
  }

  // Initialize clock display (handles both clock and timer)
  try {
    await initClockDisplay();
  } catch (error) {
    captureException(error, {
      tags: { operation: 'initializeClockDisplay' }
    });
  }

  // Initialize Google Apps
  if (!IS_EDGE) {
    try {
      await initializeGoogleApps();
    } catch (error) {
      captureException(error, {
        tags: { operation: 'initializeGoogleApps' }
      });
    }
  }

  // Initialize quiz mode
  try {
    quizMode = new QuizMode({ onQuizStart: pauseAudio });
    log('Quiz mode initialized');
  } catch (error) {
    captureException(error, {
      tags: { operation: 'initializeQuizMode' }
    });
  }

  // Start page update after UI elements are initialized
  await initializePage();

  // Check if feature tour should be shown (for new users after onboarding)
  // Or if feature spotlights should be shown (for existing users with new features)
  try {
    // First check if user has completed ANY version of the tour
    const completedAnyTour = await hasCompletedAnyTour();

    if (!completedAnyTour) {
      // New user - show full tour
      // Set callback to show Chrome footer notification when tour ends
      setOnTourEndCallback(() => {
        log('Tour ended, showing Chrome footer notification');
        initChromeFooterNotification(2000);
      });

      // Delay tour start to let UI fully render and user orient themselves
      log('Feature tour not completed, scheduling tour start');
      setTimeout(() => {
        startTour();
      }, 1500);
    } else {
      // Existing user - check for new feature spotlights
      // This handles users who completed an older version and need to see new features
      const unseenSpotlights = await getUnseenFeatureSpotlights();
      if (unseenSpotlights.length > 0) {
        log(`Found ${unseenSpotlights.length} unseen feature spotlights`);
        // Show the first unseen spotlight after a delay
        setTimeout(() => {
          const firstSpotlight = unseenSpotlights[0];
          showFeatureSpotlight(firstSpotlight.featureKey);
        }, 1500);
      } else {
        // No spotlights to show - initialize Chrome footer notification
        // This only shows on Chrome, after tour is complete, and if not dismissed
        initChromeFooterNotification(2500);
      }
    }
  } catch (error) {
    log('Error checking feature tour status: ' + error.message);
    captureException(error, {
      tags: { operation: 'checkFeatureTour' }
    });
  }

  // Finish performance monitoring transaction
  if (transaction) {
    transaction.setStatus('ok');
    transaction.finish();
  }
});

window.addEventListener('beforeunload', () => {
  if (_bufferingReadyTimeout) {
    clearTimeout(_bufferingReadyTimeout);
    _bufferingReadyTimeout = null;
  }
  if (_imageLoadTimeoutId) {
    clearTimeout(_imageLoadTimeoutId);
    _imageLoadTimeoutId = null;
  }
  if (fadeAudioInterval) {
    clearInterval(fadeAudioInterval);
    fadeAudioInterval = null;
  }
  if (audio) {
    detachBufferingListeners(audio);
    audio.pause();
    audio.src = '';
    audio = null;
  }
});

log('Main script loaded');

// Add storage change listener
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    // Handle quick access toggle
    if (changes.quickAccessEnabled) {
      applySearchVisibility(changes.quickAccessEnabled.newValue);
    }

    // Handle top sites and shortcuts toggle - update existing TopSites instance
    if (changes.quickAccessEnabled || changes.customShortcuts) {
      if (window.topSitesInstance) {
        try {
          window.topSitesInstance.updateVisibility();
        } catch (error) {
          log(`Failed to update top sites: ${error.message}`);
          captureException(error, {
            tags: { operation: 'updateTopSites' }
          });
        }
      }
    }

    // Handle quiet hours toggle - show/hide pill in real-time
    if (changes.quietHours) {
      const isQuietHoursEnabled = changes.quietHours.newValue;

      // Check if we're currently in quiet hours time window
      isQuietHoursActive().then(isActive => {
        const existingPill = document.getElementById('quiet-hours-pill');

        if (isActive && !existingPill) {
          showQuietHoursPill();
          showDisabledPlayButton();
        } else if (!isActive && existingPill) {
          // Quiet hours just became inactive - remove the pill
          existingPill.classList.add('fade-out');
          setTimeout(() => {
            existingPill.remove();
          }, 200);

          // Re-enable audio controls
          showAudioControls();
        }
      });
    }
  }
});

// Centralized function to restore main UI elements after quiz exit
function restoreMainUIElements() {
  // Show core UI elements and clear inline styles set by quiz
  const elementsToShow = [
    '.info-panel',
    '.control-buttons',
    '.external-links',
    '.top-sites-container',
    '.search-container'
  ];

  elementsToShow.forEach(selector => {
    const element = document.querySelector(selector);
    if (element) {
      element.style.display = '';
    }
  });

  // Re-initialize search with proper permission/settings checks
  initializeSearch();

  // Re-initialize top sites visibility
  if (window.topSitesInstance) {
    window.topSitesInstance.updateVisibility();
  }

  // Re-setup volume control after quiz exit
  setupVolumeControl();
  updateVolumeControl();

  // Re-apply low distraction state if it was active
  chrome.storage.local.get('lowDistractionMode', (result) => {
    if (result.lowDistractionMode) {
      setLowDistractionState(true);
    }
  });
}

// Export for use by quiz mode
window.restoreMainUIElements = restoreMainUIElements;
