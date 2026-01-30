import './styles.css';
import CONFIG from './config.js';
import { getAutoPlayState, getVideoAutoPlayState, getQuietHoursText } from './quietHours.js';
import { isQuietHoursActive } from './quietHours.js';
import SettingsSidebar from './settingsSidebar.js';
import TopSites from './topSites.js';
import { localizeHtml } from './i18n.js';
import QuizMode from './quiz.js';
import { initSentry, captureException, addBreadcrumb, startTransaction } from './sentry.js';
import { log } from './logger.js';
import { startTour, isTourCompleted, hasCompletedAnyTour, getUnseenFeatureSpotlights, showFeatureSpotlight, setOnTourEndCallback } from './featureTour.js';
import { showPermissionDialog } from './permissionDialog.js';
import { initChromeFooterNotification } from './chromeFooterNotification.js';
import { initAnalytics, trackSessionStart, trackFeature, trackReviewPromptShown, trackReviewPromptAction } from './analytics.js';
import { initClock, showClock, hideClock } from './clock.js';
import { initTimer, showTimer, hideTimer } from './timer.js';
import {
  VideoVisibilityManager,
  initVideoManager,
  setVideoElement,
  getVideoElement,
  getVideoVisibilityManager,
  setVideoVisibilityManager,
  createVideoVisibilityManager,
  destroyVideoVisibilityManager,
  showVideoLoadingIndicator,
  hideVideoLoadingIndicator,
  setupVideoEventListeners,
  setVideoSource,
  setupVideoControls,
  cleanupVideoControls,
  showPosterImage,
  showVideoElement
} from './videoManager.js';
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
import {
  showLoadingIndicator,
  hideLoadingIndicator,
  updateLoadingMessage,
  showAudioLoadingIndicator,
  hideAudioLoadingIndicator,
  showMediaPlayIndicator,
  showMediaPauseIndicator,
  showToast
} from './loadingIndicators.js';
import {
  initShareMenu,
  openShareMenu,
  closeShareMenu,
  handleShare,
  setupShareButton,
  getShowShareMenu,
  setShowShareMenu
} from './shareMenu.js';
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

// Initialize Sentry for content script
initSentry('content-script');

// Clock display mode constants
const CLOCK_DISPLAY_MODES = {
  OFF: 'off',
  CLOCK: 'clock',
  TIMER: 'timer'
};

let isMuted = false;
let volumeLevel = CONFIG.DEFAULT_VOLUME;
let lastVolumeLevel = CONFIG.DEFAULT_VOLUME;
let audio;
let fadeAudioInterval = null; // Interval for fading audio in/out
let video; // Video element for video mode
let isPlaying = false;
// shouldShowReviewPrompt and reviewPromptData are now managed by reviewPrompt.js
let birdInfo;
let quizMode;
let saveVolumeTimeout = null;
// showShareMenu state is now managed by shareMenu.js module

// Initialize video manager callbacks
initVideoManager({
  onPlayVideo: (showIndicator) => playVideo(showIndicator),
  onPauseVideo: () => pauseVideo(),
  onUpdatePlayPauseButton: () => updatePlayPauseButton(),
  getIsPlaying: () => isPlaying,
  setIsPlaying: (val) => { isPlaying = val; },
  getIsMuted: () => isMuted,
  getVolumeLevel: () => volumeLevel,
  getBirdInfo: () => birdInfo
});

/**
 * Migrate from legacy clockEnabled to new clockDisplayMode enum
 * @returns {Promise<string>} The clock display mode ('off', 'clock', or 'timer')
 */
async function migrateClockSettings() {
  const storage = await new Promise((resolve) => {
    chrome.storage.sync.get(['clockDisplayMode', 'clockEnabled'], resolve);
  });

  // If new format already exists, validate and return it
  if (storage.clockDisplayMode !== undefined) {
    // Validate mode value
    if (Object.values(CLOCK_DISPLAY_MODES).includes(storage.clockDisplayMode)) {
      return storage.clockDisplayMode;
    } else {
      // Invalid value found, reset to off
      log(`Invalid clockDisplayMode found: ${storage.clockDisplayMode}, resetting to 'off'`);
      await chrome.storage.sync.set({ clockDisplayMode: CLOCK_DISPLAY_MODES.OFF });
      return CLOCK_DISPLAY_MODES.OFF;
    }
  }

  // One-time migration from old format
  const mode = storage.clockEnabled ? CLOCK_DISPLAY_MODES.CLOCK : CLOCK_DISPLAY_MODES.OFF;

  // Set new format only - don't touch clockEnabled for backward compatibility
  await chrome.storage.sync.set({ clockDisplayMode: mode });

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

  // Show the appropriate display based on mode
  switch (mode) {
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
    if (areaName !== 'sync') return;

    if (changes.clockDisplayMode) {
      const newMode = changes.clockDisplayMode.newValue;

      // Validate mode value
      if (!Object.values(CLOCK_DISPLAY_MODES).includes(newMode)) {
        log(`Invalid clockDisplayMode: ${newMode}, defaulting to 'off'`);
        chrome.storage.sync.set({ clockDisplayMode: CLOCK_DISPLAY_MODES.OFF });
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

  log(`Clock display initialized with mode: ${mode}`);
}

// VideoVisibilityManager is now imported from videoManager.js

// Fetch bird information from background script
// Note: No separate transaction here - this is captured as part of the page-load transaction
// to reduce Sentry span usage (1000+ daily users × new tabs)
const MAX_RETRIES = 1; // Reduced to 1 retry to minimize API load
const IMAGE_MAX_RETRIES = 3; // More retries for image loading (transient network issues)
const IMAGE_RETRY_DELAY = 2000; // 2 seconds between image retry attempts

/**
 * Schedule a retry for getBirdInfo after a delay.
 * Used for transient MV3 service worker issues.
 * @returns {boolean} true if retry was scheduled, false if max retries exceeded
 */
function scheduleRetry(resolve, reject, retryCount, reason) {
  if (retryCount < MAX_RETRIES) {
    log(`${reason}, retrying in 1 second...`);
    setTimeout(async () => {
      try {
        const result = await getBirdInfo(retryCount + 1);
        resolve(result);
      } catch (retryError) {
        reject(retryError);
      }
    }, 1000);
    return true;
  }
  return false;
}

async function getBirdInfo(retryCount = 0) {
  log(`Requesting bird info (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      const duration = Date.now() - startTime;
      log(`Bird info request timed out after ${duration}ms`);
      addBreadcrumb('Bird info request timed out', 'http', 'error', { duration, retryCount });
      reject(new Error('Request timed out'));
    }, 30000);

    try {
      chrome.runtime.sendMessage({ action: 'getBirdInfo' }, response => {
        clearTimeout(timeout);
        const duration = Date.now() - startTime;

        // Check for message delivery failure
        if (chrome.runtime.lastError) {
          const errorMsg = chrome.runtime.lastError.message || 'Message delivery failed';
          log(`Error sending message: ${errorMsg} (duration: ${duration}ms)`);
          addBreadcrumb(`Message error: ${errorMsg}`, 'http', 'error', { duration, retryCount });

          // Retry on service worker communication errors - these are transient MV3 issues
          // "Receiving end does not exist" = service worker was terminated
          // "message channel closed" = message port closed before response
          const isServiceWorkerError = errorMsg.includes('Receiving end does not exist') ||
            errorMsg.includes('message channel closed');

          if (isServiceWorkerError && scheduleRetry(resolve, reject, retryCount, 'Service worker communication error')) {
            return;
          }

          reject(new Error(errorMsg));
          return;
        }

        // Check if response is undefined (background script unavailable or crashed)
        // This can happen when service worker is cold-starting or terminated mid-execution
        if (!response) {
          log(`No response from background script (duration: ${duration}ms)`);
          addBreadcrumb('No response from background script', 'http', 'error', { duration, retryCount });

          if (scheduleRetry(resolve, reject, retryCount, 'Service worker may have crashed')) {
            return;
          }

          // Only report to Sentry if retry also failed
          const error = new Error('No response from background script');
          captureException(error, {
            tags: { operation: 'getBirdInfo', errorType: 'undefined-response' },
            extra: { duration, retryCount }
          });
          reject(error);
          return;
        }

        // Data errors (image not found, API errors, etc.) - don't retry
        if (response.error) {
          log(`Error getting bird info: ${response.error} (duration: ${duration}ms)`);
          addBreadcrumb(`Bird info error: ${response.error}`, 'http', 'error', { duration, retryCount });
          reject(new Error(response.error));
        } else {
          log(`Bird info received successfully (duration: ${duration}ms)`);
          addBreadcrumb('Bird info received', 'http', 'info', {
            duration,
            speciesCode: response.speciesCode,
            ebirdUrl: response.ebirdUrl,
            region: response.location,
            retryCount
          });
          resolve(response);
        }
      });
    } catch (sendError) {
      clearTimeout(timeout);
      log(`Exception while sending message: ${sendError.message}`);
      captureException(sendError, {
        tags: { operation: 'getBirdInfo', phase: 'sendMessage' },
        extra: { retryCount }
      });
      reject(sendError);
    }
  });
}

// Update play/pause button UI
const updatePlayPauseButton = () => {
  const playButton = document.getElementById('play-button');
  if (playButton) {
    playButton.innerHTML = isPlaying ?
      `<img src="images/svg/pause.svg" alt="${chrome.i18n.getMessage('pauseAlt')}" width="24" height="24">` :
      `<img src="images/svg/play.svg" alt="${chrome.i18n.getMessage('playAlt')}" width="16" height="16">`;
    playButton.title = isPlaying ?
      chrome.i18n.getMessage('pauseTooltip') :
      chrome.i18n.getMessage('playTooltip');
  }
};

// Initialize audio/video based on auto-play settings
async function initializeAudio() {
  const isQuietHour = await isQuietHoursActive();

  if (isQuietHour) {
    // Video mode during quiet hours: allow play/pause, just muted, no volume control
    if (birdInfo && birdInfo.videoMode && video) {
      video.muted = true;
      hideVolumeControl();
      showQuietHoursPill();

      // Re-append play button so it appears after moon icon (rightmost position)
      const playBtn = document.getElementById('play-button');
      if (playBtn) {
        const controlButtons = document.querySelector('.control-buttons');
        if (playBtn.parentNode) {
          playBtn.parentNode.removeChild(playBtn);
        }
        controlButtons.appendChild(playBtn);
      }

      // Auto-play muted video if auto-play is enabled
      const shouldAutoPlayVideo = await getVideoAutoPlayState();
      if (shouldAutoPlayVideo) {
        await playVideo();
      }
    } else {
      // Photo/audio mode during quiet hours: show disabled play button with quiet hours tooltip
      // Add moon icon first, then reposition play button after it
      showQuietHoursPill();
      showDisabledPlayButton();
    }
  } else {
    const shouldAutoPlay = await getAutoPlayState();
    // Video mode: auto-play video if enabled
    if (birdInfo && birdInfo.videoMode && video) {
      showAudioControls();
      if (shouldAutoPlay) {
        await playVideo();
      }
    }
    // Audio mode: auto-play audio if enabled
    else if (birdInfo && birdInfo.mediaUrl) {
      showAudioControls();
      if (shouldAutoPlay) {
        await playAudio();
      } else {
        loadAudioWithoutPlaying();
      }
    }
  }
}

// Play video
// showIndicator: if true, shows a brief play indicator animation (for user-initiated plays)
async function playVideo(showIndicator = false) {
  if (!video) return;

  // Ensure video is muted during quiet hours
  const isQuietHour = await isQuietHoursActive();
  if (isQuietHour) {
    video.muted = true;
  }

  try {
    // Show brief play indicator for user-initiated plays
    const vvm = getVideoVisibilityManager();
    if (showIndicator && vvm) {
      vvm.showPlayIndicator();
    }

    await video.play();
    isPlaying = true;
    updatePlayPauseButton();
    log('Video playback started');
  } catch (error) {
    if (error.name === 'AbortError') {
      log('Video playback interrupted');
      return;
    }

    // NotSupportedError occurs when video source failed to load (network issue)
    if (error.name === 'NotSupportedError') {
      log('Video unavailable (network issue)');
      return;
    }

    console.error('Error playing video:', error);
    captureException(error, {
      tags: { operation: 'playVideo' },
      extra: {
        videoUrl: birdInfo?.videoUrl,
        currentTime: video?.currentTime,
        volume: video?.volume,
        muted: video?.muted,
        errorName: error.name
      }
    });
  }
}

function hideAudioControls() {
  const playButton = document.getElementById('play-button');
  const volumeControl = document.getElementById('volume-control');
  if (playButton) playButton.style.display = 'none';
  if (volumeControl) volumeControl.style.display = 'none';
}

// Hide only volume control (for video mode during quiet hours - play/pause still allowed)
function hideVolumeControl() {
  const volumeControl = document.getElementById('volume-control');
  if (volumeControl) volumeControl.style.display = 'none';
}

function showAudioControls() {
  const playButton = document.getElementById('play-button');
  const volumeControl = document.getElementById('volume-control');
  if (playButton) {
    playButton.style.display = 'inline-flex';
    playButton.disabled = false;
    playButton.classList.remove('disabled');
    playButton.title = chrome.i18n.getMessage('playTooltip');
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
  await chrome.storage.sync.set({ quietHours: false });

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

// Load audio without playing it
function loadAudioWithoutPlaying() {
  if (fadeAudioInterval) {
    clearInterval(fadeAudioInterval);
    fadeAudioInterval = null;
  }
  if (audio) {
    audio.pause();
    audio = null;
  }
  audio = new Audio(birdInfo.mediaUrl);
  audio.preload = 'metadata'; // Only load metadata to save bandwidth
  updatePlayPauseButton();
}

// Create a play button for media controls (shared between audio and video mode)
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

// Create audio player for bird calls (image mode)
function createAudioPlayer(mediaUrl) {
  if (!mediaUrl) {
    log('No media URL provided, skipping audio player creation');
    return null;
  }

  log(`Creating audio player with URL: ${mediaUrl}`);
  audio = new Audio(mediaUrl);
  // Skip the first 4 seconds of the audio (usually recordist commentary)
  audio.currentTime = 4;
  audio.muted = isMuted;
  audio.volume = volumeLevel;

  audio.onended = () => {
    isPlaying = false;
    updatePlayPauseButton();
  };

  return createPlayButton(togglePlay);
}

// Create video player controls (video mode)
function createVideoPlayer() {
  log('Creating video player controls');
  return createPlayButton(toggleVideoPlay);
}

// Toggle video play/pause
async function toggleVideoPlay() {
  if (!video) return;

  if (isPlaying) {
    pauseVideo();
  } else {
    await playVideo(true); // Show play indicator for user-initiated play
  }
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
    audio = new Audio(birdInfo.mediaUrl);
    audio.volume = volumeLevel;
    audio.muted = isMuted;
  }
  try {
    await audio.play();
    isPlaying = true;
    updatePlayPauseButton();

    // Track audio play (only track user-initiated plays, not auto-play)
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
      return;
    }

    // NotSupportedError occurs when audio source failed to load (network issue)
    // This is expected on slow/unreliable connections - not a bug
    if (error.name === 'NotSupportedError') {
      log('Audio unavailable (network issue)');
      return;
    }

    // Other errors are unexpected and should be reported
    console.error('Error playing audio:', error);
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

// Pause all media (audio and video) - used when starting quiz
function pauseAllMedia() {
  pauseAudio();
  pauseVideo();
}

// Set image source and show it when loaded
// Includes retry logic for transient network failures
function setImageSource(imageUrl, retryCount = 0) {
  const img = document.querySelector('.background-image');
  if (!img) return;

  img.onload = function () {
    img.classList.remove('hidden');
  };

  img.onerror = function () {
    if (retryCount < IMAGE_MAX_RETRIES) {
      log(`Image load failed, retrying (${retryCount + 1}/${IMAGE_MAX_RETRIES})...`);
      setTimeout(() => {
        img.src = '';
        setImageSource(imageUrl, retryCount + 1);
      }, IMAGE_RETRY_DELAY);
    } else {
      log('Image failed to load after all retries');
    }
  };

  img.src = imageUrl;
}

// Switch to full image mode credits (photo + audio) on video fallback
function switchToImageModeCredits() {
  const creditsContainer = document.querySelector('.credits');
  if (!creditsContainer || !birdInfo) return;

  const imageCreditsHtml = `
    <span class="credit-item media-toggle-container">
      <label class="media-toggle" title="${chrome.i18n.getMessage('toggleMediaMode') || 'Toggle video/photo'}">
        <input type="checkbox" id="media-toggle-switch" checked
               aria-label="${chrome.i18n.getMessage('toggleMediaMode') || 'Toggle video/photo'}"
               role="switch"
               aria-checked="true">
        <span class="media-toggle-slider" aria-hidden="true">
          <span class="media-toggle-icon media-toggle-photo">
            <img src="images/svg/camera.svg" alt="" width="12" height="12">
          </span>
          <span class="media-toggle-icon media-toggle-video">
            <img src="images/svg/video.svg" alt="" width="12" height="12">
          </span>
        </span>
      </label>
    </span>
    <span class="credit-item credit-icon-group">
      <a href="mailto:support@birdtab.app" class="feedback-inline-link" title="${chrome.i18n.getMessage('sendFeedback') || 'Send Feedback'}">
        <img src="images/svg/message.svg" alt="${chrome.i18n.getMessage('sendFeedback') || 'Send Feedback'}" width="16" height="16">
      </a>
    </span>
    <span id="share-container" class="credit-item share-container credit-icon-group">
      <button id="share-button" class="share-inline-button" title="${chrome.i18n.getMessage('shareTooltip') || 'Share'}">
        <img src="images/svg/share.svg" alt="${chrome.i18n.getMessage('shareAlt') || 'Share'}" width="16" height="16">
      </button>
    </span>
    <span class="credit-item">
      <img src="images/svg/camera.svg" alt="${chrome.i18n.getMessage('cameraAlt') || 'Photo'}" width="16" height="16">
      <a href="${birdInfo.photographerUrl}" target="_blank">${birdInfo.photographer}</a>
    </span>
    ${birdInfo.mediaUrl ? `
    <span class="credit-item">
      <img src="images/svg/microphone.svg" alt="${chrome.i18n.getMessage('audioAlt') || 'Audio'}" width="16" height="16">
      <a href="${birdInfo.recordistUrl}" target="_blank">${birdInfo.recordist}</a>
    </span>
    ` : ''}
    <span class="credit-item">
      ${chrome.i18n.getMessage('viaText') || 'via'} <a href="https://www.macaulaylibrary.org/" target="_blank">${chrome.i18n.getMessage('macaulayLibrary') || 'Macaulay Library'}</a>
    </span>
  `;

  creditsContainer.innerHTML = imageCreditsHtml;
  setupShareButton();
  log('Switched to image mode credits');
}

// Main function to update the page with new bird information
async function initializePage() {
  incrementNewTabCount();
  await checkAndPrepareReviewPrompt();
  log('Updating page');
  showLoadingIndicator();
  const loadingInterval = setInterval(updateLoadingMessage, 2000);

  try {
    // Check if there's a pending bird from history selection
    const pendingBird = await new Promise((resolve) => {
      chrome.storage.local.get(['pendingBirdInfo'], (result) => {
        if (result.pendingBirdInfo) {
          // Clear it immediately
          chrome.storage.local.remove(['pendingBirdInfo']);
          resolve(result.pendingBirdInfo);
        } else {
          resolve(null);
        }
      });
    });

    // Try to get fresh bird info
    let usedCachedFallback = false;
    try {
      if (pendingBird) {
        birdInfo = pendingBird;
        usedCachedFallback = true; // Don't re-add to history when loading from history
      } else {
        birdInfo = await getBirdInfo();
      }
    } catch (fetchError) {
      log(`Failed to fetch bird: ${fetchError.message}`);

      // Try to load from history as silent fallback (newest bird is at end of array)
      const history = await getHistory();
      if (history.length > 0) {
        birdInfo = history[history.length - 1];
        usedCachedFallback = true;
        log(`Using cached bird from history: ${birdInfo.name}`);
      } else {
        // No cached birds available - re-throw to show error modal
        throw fetchError;
      }
    }

    // Add bird to viewing history (skip if we loaded from history)
    if (!usedCachedFallback) {
      await addToHistory(birdInfo);
    }

    // Initialize share menu with birdInfo getter
    initShareMenu(() => birdInfo);

    // add artificial delay of about 4 seconds to simulate a slow loading experience
    // await new Promise(resolve => setTimeout(resolve, 4000));


    clearInterval(loadingInterval);
    hideLoadingIndicator();

    // add a class to the body to trigger the fade-in animation
    document.body.classList.add('loaded');

    log('Bird info received, updating page content');

    // Track session start with user settings and bird info
    try {
      const [settings, localData] = await Promise.all([
        new Promise((resolve) => {
          chrome.storage.sync.get(['region', 'videoMode', 'autoPlay', 'quietHours', 'highResImages', 'quickAccessEnabled', 'clockDisplayMode'], resolve);
        }),
        new Promise((resolve) => {
          chrome.storage.local.get(['installTime'], resolve);
        })
      ]);
      trackSessionStart({
        region: settings.region || 'US',
        videoMode: settings.videoMode || false,
        autoPlay: settings.autoPlay || false,
        quietHours: settings.quietHours || false,
        highResImages: settings.highResImages || false,
        quickAccessEnabled: settings.quickAccessEnabled || false,
        clockDisplayMode: settings.clockDisplayMode || 'off',
        speciesCode: birdInfo.speciesCode || null,
        hasAudio: !!birdInfo.mediaUrl,
        hasVideo: !!birdInfo.videoUrl,
      }, localData.installTime || null);
    } catch (analyticsError) {
      log(`Analytics error: ${analyticsError.message}`);
    }

    const contentContainer = document.getElementById('content-container');

    // Determine if we're in video mode (video mode enabled AND video available)
    const isVideoMode = birdInfo.videoMode;

    // Build credits HTML based on mode
    // In video mode, initially show photo credits (poster visible while video loads)
    // Credits will switch to video credits when video is ready (canplay event)
    let creditsHtml;
    if (isVideoMode) {
      // Video mode: show both photo and video credits
      // Photo credits for the poster/fallback image, video credits for the video
      creditsHtml = `
        <span class="credit-item">
          <img src="images/svg/camera.svg" alt="${chrome.i18n.getMessage('cameraAlt') || 'Photo'}" width="16" height="16">
          <a href="${birdInfo.photographerUrl}" target="_blank">${birdInfo.photographer}</a>
        </span>
        <span class="credit-item">
          <img src="images/svg/video.svg" alt="${chrome.i18n.getMessage('videoAlt') || 'Video'}" width="16" height="16">
          <a href="${birdInfo.videographerUrl}" target="_blank">${birdInfo.videographer}</a>
        </span>
      `;
    } else {
      // Image mode: show photographer and optionally recordist
      creditsHtml = `
        <span class="credit-item">
          <img src="images/svg/camera.svg" alt="${chrome.i18n.getMessage('cameraAlt')}" width="16" height="16">
          <a href="${birdInfo.photographerUrl}" target="_blank">${birdInfo.photographer}</a>
        </span>
        ${birdInfo.mediaUrl ? `
        <span class="credit-item">
          <img src="images/svg/microphone.svg" alt="${chrome.i18n.getMessage('audioAlt')}" width="16" height="16">
          <a href="${birdInfo.recordistUrl}" target="_blank">${birdInfo.recordist}</a>
        </span>
        ` : ''}
        ${birdInfo.videoDisabledDueToSlowConnection ? `
        <span class="credit-item info-icon" data-tooltip="${chrome.i18n.getMessage('videoUnavailableTooltip')}">
          <img src="images/svg/video-off.svg" alt="${chrome.i18n.getMessage('videoUnavailableAlt')}" width="16" height="16">
        </span>
        ` : ''}
      `;
    }

    contentContainer.innerHTML = `
      ${isVideoMode ? `
      <video class="background-video hidden" loop playsinline preload="metadata" poster="${birdInfo.imageUrl}">
        <source src="${birdInfo.videoUrl}" type="video/mp4">
      </video>
      ` : ''}
      <img src="" alt="${birdInfo.name}" class="background-image${isVideoMode ? ' video-fallback' : ''}" decoding="async">
      <div class="gradient-overlay"></div>
      <div class="info-panel">
        <div class="external-links">
          <a href="https://www.bing.com/search?q=${encodeURIComponent(birdInfo.name)}" target="_blank" class="external-link bing-link">
            <img src="images/svg/bing-default.svg" alt="${chrome.i18n.getMessage('bingSearchAlt')}" width="24" height="24">
          </a>
          <a href="${birdInfo.ebirdUrl}" target="_blank" class="external-link ebird-link">
            <img src="images/svg/ebird-default.svg" alt="${chrome.i18n.getMessage('eBirdPageAlt')}" width="24" height="24">
          </a>
        </div>
        <div class="info-panel-header">
          <a href="${birdInfo.ebirdUrl}" target="_blank" class="bird-name-link">
            <h1 id="bird-name"></h1>
          </a>
          <div class="scientific-name-row">
            <p id="scientific-name"></p>
            <span class="info-icon" data-tooltip="${birdInfo.description}&#10;&#10;Conservation Status: ${birdInfo.conservationStatus}">
              <img src="images/svg/info.svg" alt="${chrome.i18n.getMessage('infoAlt')}" width="16" height="16">
            </span>
          </div>
        </div>
        <p class="credits">
          <span class="credit-item media-toggle-container">
            <label class="media-toggle" title="${chrome.i18n.getMessage('toggleMediaMode') || 'Toggle video/photo'}">
              <input type="checkbox" id="media-toggle-switch" ${isVideoMode ? 'checked' : ''} 
                     aria-label="${chrome.i18n.getMessage('toggleMediaMode') || 'Toggle video/photo'}"
                     role="switch"
                     aria-checked="${isVideoMode ? 'true' : 'false'}">
              <span class="media-toggle-slider" aria-hidden="true">
                <span class="media-toggle-icon media-toggle-photo">
                  <img src="images/svg/camera.svg" alt="" width="12" height="12">
                </span>
                <span class="media-toggle-icon media-toggle-video">
                  <img src="images/svg/video.svg" alt="" width="12" height="12">
                </span>
              </span>
            </label>
          </span>
          <span class="credit-item credit-icon-group">
            <a href="mailto:support@birdtab.app" class="feedback-inline-link" title="${chrome.i18n.getMessage('sendFeedback') || 'Send Feedback'}">
              <img src="images/svg/message.svg" alt="${chrome.i18n.getMessage('sendFeedback') || 'Send Feedback'}" width="16" height="16">
            </a>
          </span>
          <span id="share-container" class="credit-item share-container credit-icon-group">
            <button id="share-button" class="share-inline-button" title="${chrome.i18n.getMessage('shareTooltip')}">
              <img src="images/svg/share.svg" alt="${chrome.i18n.getMessage('shareAlt')}" width="16" height="16">
            </button>
          </span>
          ${creditsHtml}
          <span class="credit-item">
            ${chrome.i18n.getMessage('viaText') || 'via'} <a href="https://www.macaulaylibrary.org/" target="_blank">${chrome.i18n.getMessage('macaulayLibrary') || 'Macaulay Library'}</a>
          </span>
        </p>
      </div>
      <div class="control-buttons">
        <button id="settings-button" class="icon-button" aria-label="${chrome.i18n.getMessage('openSettings')}" title="${chrome.i18n.getMessage('settingsTooltip')}">
          <img src="images/svg/settings.svg" alt="${chrome.i18n.getMessage('settingsAlt')}" width="24" height="24">
        </button>
        <button id="history-button" class="icon-button" aria-label="${chrome.i18n.getMessage('openHistory') || 'Open history'}" title="${chrome.i18n.getMessage('historyTooltip') || 'View your bird watching history'}">
          <img src="images/svg/history.svg" alt="${chrome.i18n.getMessage('historyAlt') || 'History'}" width="24" height="24">
        </button>
        <button id="quiz-button" class="icon-button" aria-label="${chrome.i18n.getMessage('startQuiz')}" title="${chrome.i18n.getMessage('quizTooltip')}">
          <img src="images/svg/quiz.svg" alt="${chrome.i18n.getMessage('quizAlt')}" width="24" height="24">
        </button>
        <button id="refresh-button" class="icon-button" title="${chrome.i18n.getMessage('refreshTooltip')}">
          <img src="images/svg/refresh.svg" alt="${chrome.i18n.getMessage('refreshAlt')}" width="24" height="24">
        </button>
        ${(isVideoMode || birdInfo.mediaUrl) ? `
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
    `;

    // Set up video or image source
    if (isVideoMode) {
      // Video mode: set up video with sound, image as fallback
      setVideoSource();
      setImageSource(birdInfo.imageUrl);

      // Get reference to video element
      video = document.querySelector('.background-video');
      setVideoElement(video);

      // Initialize VideoVisibilityManager for tab visibility handling
      destroyVideoVisibilityManager();
      createVideoVisibilityManager(video, birdInfo);

      // Load volume settings for video
      chrome.storage.sync.get(['isMuted', 'volumeLevel'], (result) => {
        isMuted = result.isMuted || false;
        volumeLevel = result.volumeLevel !== undefined ? result.volumeLevel : 0.8;
        lastVolumeLevel = volumeLevel > 0 ? volumeLevel : 0.8;
        updateVolumeControl();
        if (video) {
          video.muted = isMuted;
          video.volume = isMuted ? 0 : volumeLevel;
        }
      });

      // Create play button for video
      const playButton = createVideoPlayer();
      if (playButton) {
        document.querySelector('.control-buttons').appendChild(playButton);
      }

      setupVolumeControl();
      updateVolumeControl();

      // Add click-to-pause on empty areas of the page
      setupMediaClickHandler();

      // Set up media toggle button (video/photo switch)
      setupMediaToggle(false); // false = video mode
    } else {
      // Image mode: just load the image
      setImageSource(birdInfo.imageUrl);

      if (birdInfo.mediaUrl) {
        log(`Audio URL found: ${birdInfo.mediaUrl}`);
        const audioPlayer = createAudioPlayer(birdInfo.mediaUrl);
        if (audioPlayer) {
          document.querySelector('.control-buttons').appendChild(audioPlayer);
        }

        chrome.storage.sync.get(['isMuted', 'volumeLevel'], (result) => {
          isMuted = result.isMuted || false;
          volumeLevel = result.volumeLevel !== undefined ? result.volumeLevel : 0.8;
          lastVolumeLevel = volumeLevel > 0 ? volumeLevel : 0.8;
          updateVolumeControl();
          if (audio) {
            audio.muted = isMuted;
            audio.volume = isMuted ? 0 : volumeLevel;
          }
        });

        setupVolumeControl();
        updateVolumeControl();

        // Add click-to-play/pause on empty areas of the page for audio
        setupMediaClickHandler();
      } else {
        log('No audio URL found in bird info');
        hideAudioControls();
      }

      // Set up media toggle in image mode (for on-demand video fetch)
      setupMediaToggle(true); // true = image mode
    }


    const lang = chrome.i18n.getUILanguage();
    let nameToDisplay = birdInfo.name;

    if (lang && birdInfo.primaryComName_fr && lang.toLowerCase().startsWith('fr')) {
      nameToDisplay = birdInfo.primaryComName_fr;
    } else if (lang && birdInfo.primaryComName_cn && lang.toLowerCase().startsWith('zh')) {
      nameToDisplay = birdInfo.primaryComName_cn;
    }

    document.getElementById('bird-name').textContent = nameToDisplay;
    document.getElementById('scientific-name').textContent = birdInfo.scientificName;

    document.getElementById('refresh-button').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      trackFeature('refresh');
      window.location.reload();
    });

    document.getElementById('history-button').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openHistoryModal();
    });

    document.getElementById('quiz-button').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (quizMode && !quizMode.isActive) {
        quizMode.startQuiz();
      }
    });

    // Initialize Chrome tab link
    initializeChromeTab();

    // Setup share functionality
    setupShareButton();

    // After updating the page content, add the review prompt if needed
    showReviewPromptIfNeeded(document.body);

    setupExternalLinks();

    // Initialize settings modal immediately after DOM elements are created
    // (before initializeAudio which may take time for video to load)
    try {
      new SettingsSidebar();
    } catch (error) {
      console.error('Failed to initialize settings modal:', error);
      captureException(error, {
        tags: { operation: 'initializeSettingsSidebar' }
      });
    }

    await initializeAudio();

    log('Page updated successfully');
  } catch (error) {
    clearInterval(loadingInterval);
    hideLoadingIndicator();
    console.error('Error updating page:', error);
    log(`Error updating page: ${error.message}`);
    captureException(error, {
      tags: { operation: 'initializePage' }
    });
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

// Show beautiful network error state when no cached birds are available
function showNetworkErrorState() {
  document.body.classList.add('loaded');

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
    if (lastVolumeLevel === 0) lastVolumeLevel = CONFIG.DEFAULT_VOLUME;
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

  // Update audio or video volume
  if (audio) {
    audio.volume = volumeLevel;
    audio.muted = isMuted;
  }
  if (video) {
    video.volume = volumeLevel;
    video.muted = isMuted;
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
    chrome.storage.sync.set({ isMuted, volumeLevel }, () => {
      if (chrome.runtime.lastError) {
        console.warn('Failed to save volume state:', chrome.runtime.lastError);
      } else {
        log(`Volume state saved - muted: ${isMuted}, level: ${volumeLevel}`);
      }
    });
  } else {
    // Debounce for volume slider movements
    saveVolumeTimeout = setTimeout(() => {
      chrome.storage.sync.set({ isMuted, volumeLevel }, () => {
        if (chrome.runtime.lastError) {
          console.warn('Failed to save volume state:', chrome.runtime.lastError);
        } else {
          log(`Volume state saved - muted: ${isMuted}, level: ${volumeLevel}`);
        }
      });
    }, 500); // Wait 500ms after last volume change
  }
}

// Pause video if playing
function pauseVideo() {
  if (video && !video.paused) {
    video.pause();
    isPlaying = false;
    updatePlayPauseButton();
    showPosterImage();
  }
}

// Track if media click handler is already set up to avoid duplicate listeners
let mediaClickHandlerSetup = false;

// Set up click-to-play/pause functionality for both video and audio modes
// Clicking anywhere on the page (except interactive elements) will toggle media play/pause
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

    // List of interactive elements to ignore
    const interactiveSelectors = [
      'button', 'a', 'input', 'select', 'textarea', 'label',
      '.icon-button', '.control-buttons', '.volume-control',
      '.video-play-overlay', '.video-play-btn', '.share-container', '.share-menu',
      '.settings-sidebar', '.quiz-mode',
      '.media-toggle', '.media-toggle-container',
      '.search-container',
      '.options-menu', '.options-menu-item',
      '#clock-options-trigger',
      '.timer-controls', '.timer-digit-group', '.timer-preset-btn', '.timer-start-btn', '.timer-time',
      '.confirmation-dialog', '.confirmation-dialog-backdrop'
    ];

    // Check if click target or its parents match any interactive selector
    const isInteractive = interactiveSelectors.some(selector => {
      return e.target.closest(selector) !== null;
    });

    if (isInteractive) return;

    e.preventDefault();

    if (isShowingVideo && video) {
      // Video mode: toggle video play/pause
      // If video is unloaded, the play overlay handles reload - don't interfere
      const vvm = getVideoVisibilityManager();
      if (vvm && vvm.isUnloaded) return;

      if (video.paused) {
        await playVideo(true); // Show play indicator for user-initiated play
      } else {
        pauseVideo();
      }
    } else if (!isShowingVideo && audio) {
      // Photo/audio mode: toggle audio play/pause with indicators
      // Skip if quiet hours are active (audio is blocked)
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

// Set up media toggle switch (video/photo)
// Allows quick switching between video and image mode for the current bird
let isShowingVideo = true; // Track current display mode

function setupMediaToggle(isImageMode = false) {
  const toggleSwitch = document.getElementById('media-toggle-switch');
  if (!toggleSwitch) return;

  // Set initial state
  isShowingVideo = !isImageMode;

  toggleSwitch.addEventListener('change', async function () {
    // Update aria-checked for accessibility
    this.setAttribute('aria-checked', this.checked ? 'true' : 'false');

    // Track video mode toggle
    trackFeature('video_toggle', { enabled: this.checked });

    if (this.checked) {
      // User wants to switch to video mode
      if (isImageMode && !video) {
        // Need to fetch video first
        await fetchAndSwitchToVideo();
      } else {
        await switchToVideoMode();
      }
    } else {
      // Switch to photo mode (may need to fetch audio on-demand)
      await switchToPhotoMode();
    }
  });
}

// Fetch video for current bird and switch to video mode
async function fetchAndSwitchToVideo() {
  const toggleSwitch = document.getElementById('media-toggle-switch');

  if (!birdInfo || !birdInfo.speciesCode) {
    log('No bird info available for video fetch');
    if (toggleSwitch) {
      toggleSwitch.checked = false;
      toggleSwitch.setAttribute('aria-checked', 'false');
    }
    return;
  }

  // Show loading state
  showVideoLoadingIndicator(false);

  try {
    // Request video for current bird from background script
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'getVideoForBird',
        speciesCode: birdInfo.speciesCode
      }, (result) => {
        if (chrome.runtime.lastError) {
          log(`Error fetching video: ${chrome.runtime.lastError.message}`);
          resolve(null);
        } else {
          resolve(result);
        }
      });
    });

    if (response && response.videoUrl) {
      // Check if user switched back to photo mode while we were fetching
      if (!toggleSwitch || !toggleSwitch.checked) {
        log('User switched back to photo mode during video fetch, aborting');
        return;
      }

      // Store video info in birdInfo
      birdInfo.videoUrl = response.videoUrl;
      birdInfo.videographer = response.videographer;
      birdInfo.videographerUrl = response.videographerUrl;

      // Create video element
      await createVideoElement(response.videoUrl);

      // Check again if user switched back during video element creation
      if (!toggleSwitch || !toggleSwitch.checked) {
        log('User switched back to photo mode during video creation, aborting');
        // Stop the video that was just created
        if (video && !video.paused) {
          video.pause();
        }
        return;
      }

      // Update credits to show video credits
      updateCreditsForVideoMode();

      // Switch to video mode
      await switchToVideoMode();

      log('Successfully fetched and switched to video mode');
    } else {
      // No video available
      log('No video available for this bird');
      if (toggleSwitch) {
        toggleSwitch.checked = false;
        toggleSwitch.setAttribute('aria-checked', 'false');
      }
      // Show toast notification to inform user
      showToast(chrome.i18n.getMessage('videoNotAvailableForBird'), 'info');
    }
  } catch (error) {
    log(`Error fetching video: ${error.message}`);
    if (toggleSwitch) {
      toggleSwitch.checked = false;
      toggleSwitch.setAttribute('aria-checked', 'false');
    }
    // Show toast notification for error
    showToast(chrome.i18n.getMessage('videoNotAvailableForBird'), 'info');
  } finally {
    hideVideoLoadingIndicator();
  }
}

// Create video element dynamically
async function createVideoElement(videoUrl) {
  const contentContainer = document.getElementById('content-container');
  const existingVideo = document.querySelector('.background-video');

  if (existingVideo) {
    existingVideo.remove();
  }

  // Check quiet hours - mute video during quiet hours (not a persisted setting)
  const isQuietHour = await isQuietHoursActive();
  const shouldMute = isMuted || isQuietHour;

  // Create video element
  const videoEl = document.createElement('video');
  videoEl.className = 'background-video hidden';
  videoEl.loop = true;
  videoEl.playsInline = true;
  videoEl.preload = 'metadata';
  videoEl.poster = birdInfo.imageUrl;
  videoEl.muted = shouldMute;
  videoEl.volume = shouldMute ? 0 : volumeLevel;

  const source = document.createElement('source');
  source.src = videoUrl;
  source.type = 'video/mp4';
  videoEl.appendChild(source);

  // Insert at the beginning of content container
  const firstChild = contentContainer.firstChild;
  contentContainer.insertBefore(videoEl, firstChild);

  // Store reference
  video = videoEl;

  // Set up video event listeners
  setupVideoEventListeners(videoEl, () => {
    // Fallback to image if video fails
    showPosterImage();

    // Revert toggle switch to image mode
    const toggleSwitch = document.getElementById('media-toggle-switch');
    if (toggleSwitch) {
      toggleSwitch.checked = false;
      toggleSwitch.setAttribute('aria-checked', 'false');
    }
    isShowingVideo = false;

    // Show toast notification
    showToast(chrome.i18n.getMessage('videoNotAvailableForBird'), 'info');
  });

  // Initialize VideoVisibilityManager
  destroyVideoVisibilityManager();
  createVideoVisibilityManager(video, birdInfo);

  // Wait for video to be ready
  return new Promise((resolve) => {
    videoEl.addEventListener('canplay', () => {
      // Setup video controls (progress bar) once video is ready
      setupVideoControls();
      resolve();
    }, { once: true });
    videoEl.load();
  });
}

// Update credits display for video mode
function updateCreditsForVideoMode() {
  const credits = document.querySelector('.credits');
  if (!credits || !birdInfo.videographer) return;

  // Check if video credit already exists
  if (credits.querySelector('.credit-item-video')) return;

  // Find the "via Macaulay Library" credit and insert before it
  const macaulayCredit = Array.from(credits.querySelectorAll('.credit-item')).find(
    item => item.textContent.includes('Macaulay Library')
  );

  const videoCredit = document.createElement('span');
  videoCredit.className = 'credit-item credit-item-video credit-item-slide-in';
  videoCredit.innerHTML = `
    <img src="images/svg/video.svg" alt="${chrome.i18n.getMessage('videoAlt') || 'Video'}" width="16" height="16">
    <a href="${birdInfo.videographerUrl}" target="_blank">${birdInfo.videographer}</a>
  `;

  if (macaulayCredit) {
    credits.insertBefore(videoCredit, macaulayCredit);
  }

  // Remove animation class after animation completes
  setTimeout(() => {
    videoCredit.classList.remove('credit-item-slide-in');
  }, 300);
}

// Update credits display for photo mode (add audio credit if available)
function updateCreditsForPhotoMode() {
  const credits = document.querySelector('.credits');
  if (!credits || !birdInfo.recordist) return;

  // Check if audio credit already exists (with specific class)
  if (credits.querySelector('.credit-item-audio')) return;

  // Also check if recordist credit already exists (without specific class, from initial render)
  const existingCredits = Array.from(credits.querySelectorAll('.credit-item a'));
  const recordistExists = existingCredits.some(link => link.textContent === birdInfo.recordist);
  if (recordistExists) return;

  // Find the camera credit (photo credit) and insert after it
  const cameraCredit = Array.from(credits.querySelectorAll('.credit-item')).find(item => {
    const link = item.querySelector('a');
    return link && link.getAttribute('href') === birdInfo.photographerUrl;
  });
  if (!cameraCredit) return;

  const audioCredit = document.createElement('span');
  audioCredit.className = 'credit-item credit-item-audio credit-item-slide-in';
  audioCredit.innerHTML = `
    <img src="images/svg/microphone.svg" alt="${chrome.i18n.getMessage('audioAlt') || 'Audio'}" width="16" height="16">
    <a href="${birdInfo.recordistUrl}" target="_blank">${birdInfo.recordist}</a>
  `;

  // Insert after the camera credit
  if (cameraCredit.nextSibling) {
    credits.insertBefore(audioCredit, cameraCredit.nextSibling);
  } else {
    credits.appendChild(audioCredit);
  }

  // Remove animation class after animation completes
  setTimeout(() => {
    audioCredit.classList.remove('credit-item-slide-in');
  }, 300);
}

async function switchToPhotoMode() {
  isShowingVideo = false;

  // Pause video if playing
  if (video && !video.paused) {
    video.pause();
    isPlaying = false;
  }

  // Show image, hide video
  showPosterImage();

  // Clean up video-related UI
  cleanupVideoControls();

  // Remove play overlay completely
  const playOverlay = document.querySelector('.video-play-overlay');
  if (playOverlay) {
    playOverlay.remove();
  }

  // Disable VideoVisibilityManager so it doesn't show overlay
  destroyVideoVisibilityManager();

  // Initialize audio - fetch on-demand if not available (e.g., when coming from video mode)
  if (birdInfo && !birdInfo.mediaUrl && birdInfo.speciesCode) {
    log('Audio not available, fetching on-demand for photo mode');

    // Show loading indicator for audio fetch
    showAudioLoadingIndicator();

    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'getAudioForBird',
          speciesCode: birdInfo.speciesCode
        }, (result) => {
          if (chrome.runtime.lastError) {
            log(`Error fetching audio: ${chrome.runtime.lastError.message}`);
            resolve(null);
          } else {
            resolve(result);
          }
        });
      });

      if (response && response.mediaUrl) {
        // Store audio info in birdInfo
        birdInfo.mediaUrl = response.mediaUrl;
        birdInfo.recordist = response.recordist;
        birdInfo.recordistUrl = response.recordistUrl;
        log('Successfully fetched audio for photo mode');

        // Update credits to show audio credit
        updateCreditsForPhotoMode();
      } else {
        log('No audio available for this bird');
      }
    } catch (error) {
      log(`Error fetching audio: ${error.message}`);
    } finally {
      hideAudioLoadingIndicator();
    }
  }

  // Update credits if audio info already exists
  if (birdInfo && birdInfo.recordist) {
    updateCreditsForPhotoMode();
  }

  // Check for quiet hours before showing controls
  const isQuietHour = await isQuietHoursActive();

  // Initialize audio if available
  if (birdInfo && birdInfo.mediaUrl) {
    // Create audio object if it doesn't exist
    if (!audio) {
      audio = new Audio(birdInfo.mediaUrl);
      audio.currentTime = 4; // Skip recordist commentary
      audio.muted = isMuted;
      audio.volume = isMuted ? 0 : volumeLevel;
      audio.onended = () => {
        isPlaying = false;
        updatePlayPauseButton();
      };
      log('Created audio player for photo mode');
    }

    // Remove existing button (to remove old video event listeners) and create new one for audio
    let playBtn = document.getElementById('play-button');
    if (playBtn) {
      playBtn.remove();
    }

    // Create fresh button for audio mode
    playBtn = document.createElement('button');
    playBtn.id = 'play-button';
    playBtn.classList.add('icon-button', 'play-button');
    playBtn.innerHTML = `<img src="images/svg/play.svg" alt="${chrome.i18n.getMessage('playAlt')}" width="16" height="16">`;
    playBtn.title = chrome.i18n.getMessage('playTooltip');
    playBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Don't trigger handler if button is disabled (quiet hours)
      if (playBtn.disabled) return;
      await togglePlay();
    });
    document.querySelector('.control-buttons').appendChild(playBtn);
    log('Created play button for photo mode');

    // Handle quiet hours - show disabled play button, don't auto-play
    if (isQuietHour) {
      // Show quiet hours icon first (if not already present), then reposition play button after it
      if (!document.getElementById('quiet-hours-pill')) {
        showQuietHoursPill();
      }
      showDisabledPlayButton();
      updatePlayPauseButton();
      log('Switched to photo mode (quiet hours active - play disabled)');
      return;
    }

    // Show audio controls
    playBtn.style.display = '';
    showAudioControls();

    // Check autoplay setting and play audio if enabled
    chrome.storage.sync.get(['autoPlay'], (result) => {
      const shouldAutoPlay = result.autoPlay !== false; // Default to true
      if (shouldAutoPlay && audio && !isPlaying) {
        playAudio();
      }
    });
  } else if (isQuietHour) {
    // No audio available but quiet hours active - show disabled play button and quiet hours icon
    // Show quiet hours icon first (if not already present), then reposition play button after it
    if (!document.getElementById('quiet-hours-pill')) {
      showQuietHoursPill();
    }
    showDisabledPlayButton();
    updatePlayPauseButton();
    log('Switched to photo mode (quiet hours active - no audio, play disabled)');
    return;
  }

  updatePlayPauseButton();

  log('Switched to photo mode');
}

async function switchToVideoMode() {
  isShowingVideo = true;

  // Stop audio if playing (video has its own audio)
  if (audio && !audio.paused) {
    pauseAudio();
  }

  // Show video element
  showVideoElement();

  // Setup video controls (progress bar) if video exists
  if (video) {
    setupVideoControls();
  }

  // Reinitialize VideoVisibilityManager if needed
  if (!getVideoVisibilityManager() && video) {
    createVideoVisibilityManager(video, birdInfo);
  }

  // Setup click-to-play/pause functionality
  setupMediaClickHandler();

  // Check for quiet hours - mute video, hide volume control, but allow play/pause
  const isQuietHour = await isQuietHoursActive();
  if (isQuietHour) {
    // Mute video during quiet hours (not a persisted setting)
    if (video) {
      video.muted = true;
    }
    // Hide only volume control during quiet hours (play/pause still allowed)
    hideVolumeControl();
    // Show quiet hours pill if not already present
    if (!document.getElementById('quiet-hours-pill')) {
      showQuietHoursPill();
    }
  } else {
    // Show audio controls (volume) for normal mode
    showAudioControls();
  }

  // Show play button for video mode
  // Remove existing button (to remove old audio event listeners) and create new one
  let playBtn = document.getElementById('play-button');
  if (playBtn) {
    playBtn.remove();
  }

  // Create fresh button for video mode
  playBtn = createVideoPlayer();
  if (playBtn) {
    const controlButtons = document.querySelector('.control-buttons');
    // Append at the end (after moon icon if present in quiet hours)
    controlButtons.appendChild(playBtn);
  }

  // Check autoplay setting and play video if enabled (video can auto-play muted during quiet hours)
  const shouldAutoPlayVideo = await getVideoAutoPlayState();
  if (shouldAutoPlayVideo && video) {
    await playVideo();
  }

  if (isQuietHour) {
    log('Switched to video mode (quiet hours active - muted, play/pause allowed)');
  } else {
    log('Switched to video mode');
  }
}

// Combined message listener to handle all background messages
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  if (request.action === "refreshBird") {
    location.reload();
  } else if (request.action === "toggleMute") {
    toggleMute();
  } else if (request.action === "quietHoursChanged") {
    if (request.quietHoursEnabled) {
      const isQuietHour = await isQuietHoursActive();
      if (isQuietHour && isPlaying) {
        pauseAudio();
        pauseVideo();
      }
    }
  } else if (request.action === "pauseAudio") {
    // Pause both audio and video when switching tabs
    if (audio && !audio.paused) {
      pauseAudio();
    }
    if (video && !video.paused) {
      pauseVideo();
    }
  }
});

function setupExternalLinks() {
  const bingLink = document.querySelector('.bing-link');
  const ebirdLink = document.querySelector('.ebird-link');

  bingLink.addEventListener('mouseenter', () => {
    bingLink.querySelector('img').src = 'images/svg/bing-hover.svg';
  });

  bingLink.addEventListener('mouseleave', () => {
    bingLink.querySelector('img').src = 'images/svg/bing-default.svg';
  });

  ebirdLink.addEventListener('mouseenter', () => {
    ebirdLink.querySelector('img').src = 'images/svg/ebird-hover.svg';
  });

  ebirdLink.addEventListener('mouseleave', () => {
    ebirdLink.querySelector('img').src = 'images/svg/ebird-default.svg';
  });

  // Track eBird link clicks
  ebirdLink.addEventListener('click', () => {
    trackFeature('ebird_click');
  });

  // Also track bird name link clicks (goes to eBird)
  const birdNameLink = document.querySelector('.bird-name-link');
  if (birdNameLink) {
    birdNameLink.addEventListener('click', () => {
      trackFeature('ebird_click');
    });
  }
}

// Share functionality is now imported from shareMenu.js

function initializeSearch() {
  const searchContainer = document.getElementById('search-container');

  // Check settings synchronously first to show/hide immediately
  chrome.storage.sync.get(['quickAccessEnabled'], (result) => {
    chrome.permissions.contains({
      permissions: ['search']
    }, (hasPermission) => {
      if (hasPermission && result.quickAccessEnabled) {
        searchContainer.style.display = 'block';
        document.body.classList.add('quick-access-enabled');
        setupSearchListeners();
      } else {
        searchContainer.style.display = 'none';
        document.body.classList.remove('quick-access-enabled');
      }
    });
  });
}

function setupSearchListeners() {
  const searchForm = document.getElementById('search-form');
  const searchInput = document.getElementById('search-input');

  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = searchInput.value.trim();
    if (query) {
      // Use Chrome's search API
      chrome.search.query({
        text: query,
        disposition: 'CURRENT_TAB'
      });
    }
  });
  // Add keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Focus search (Ctrl/Cmd + K)
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      searchInput.focus();
      return;
    }

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

  // Clear search on Escape key
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      searchInput.blur();
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
      chrome.storage.sync.get(['quickAccessEnabled', 'hideTopSites'], resolve);
    });

    // If quick access is not enabled or top sites are already hidden, nothing to do
    if (!result.quickAccessEnabled || result.hideTopSites !== false) {
      return;
    }

    // hideTopSites is false (meaning top sites should be visible)
    // Check if we have the required permissions
    const hasPermissions = await chrome.permissions.contains({
      permissions: ['topSites', 'favicon']
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
      chrome.storage.sync.set({ hideTopSites: true }, resolve);
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
  chrome.storage.sync.get(['isMuted', 'volumeLevel'], (result) => {
    isMuted = result.isMuted || false;
    volumeLevel = result.volumeLevel !== undefined ? result.volumeLevel : CONFIG.DEFAULT_VOLUME;
    lastVolumeLevel = volumeLevel > 0 ? volumeLevel : CONFIG.DEFAULT_VOLUME;
    updateVolumeControl();
  });

  // Setup volume control event listeners
  setupVolumeControl();

  // Initialize search box and top sites immediately for better UX
  initializeSearch();

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
  try {
    await initializeGoogleApps();
    log('Google Apps initialized');
  } catch (error) {
    captureException(error, {
      tags: { operation: 'initializeGoogleApps' }
    });
  }

  // Initialize quiz mode
  try {
    quizMode = new QuizMode({ onQuizStart: pauseAllMedia });
    log('Quiz mode initialized');

    // Add quiz button event listener for static HTML
    const quizButton = document.getElementById('quiz-button');
    if (quizButton) {
      quizButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (quizMode && !quizMode.isActive) {
          quizMode.startQuiz();
        }
      });
    }
  } catch (error) {
    captureException(error, {
      tags: { operation: 'initializeQuizMode' }
    });
  }

  // Start page update after UI elements are initialized
  log('Starting page update');
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

// Page unload cleanup - release video resources to prevent memory leaks
window.addEventListener('beforeunload', () => {
  log('Page unloading, cleaning up resources');

  // Clean up VideoVisibilityManager
  destroyVideoVisibilityManager();

  // Release video memory
  if (video) {
    video.pause();
    video.src = '';
    video.load();
    video = null;
  }

  // Release audio memory
  if (fadeAudioInterval) {
    clearInterval(fadeAudioInterval);
    fadeAudioInterval = null;
  }
  if (audio) {
    audio.pause();
    audio.src = '';
    audio = null;
  }
});

log('Main script loaded');

// Add storage change listener
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync') {
    // Handle quick access toggle
    if (changes.quickAccessEnabled) {
      const searchContainer = document.getElementById('search-container');
      searchContainer.style.display = changes.quickAccessEnabled.newValue ? 'block' : 'none';

      if (changes.quickAccessEnabled.newValue) {
        document.body.classList.add('quick-access-enabled');
        setupSearchListeners();
      } else {
        document.body.classList.remove('quick-access-enabled');
      }
    }

    // Handle top sites and shortcuts toggle - update existing TopSites instance
    if (changes.quickAccessEnabled || changes.customShortcuts) {
      if (window.topSitesInstance) {
        try {
          window.topSitesInstance.updateVisibility();
        } catch (error) {
          console.error('Failed to update top sites:', error);
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
          // Quiet hours just became active - show the pill
          showQuietHoursPill();

          // Update audio controls based on media type
          if (birdInfo && birdInfo.videoMode && video) {
            // Video mode: mute video, hide volume control
            video.muted = true;
            hideVolumeControl();
          } else {
            // Photo/audio mode: show disabled play button
            showDisabledPlayButton();
          }
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
}

// Export for use by quiz mode
window.restoreMainUIElements = restoreMainUIElements;