import './styles.css';
import CONFIG from './config.js';
import { getAutoPlayState } from './quietHours.js';
import { isQuietHoursActive } from './quietHours.js';
import SettingsModal from './settingsModal.js';
import TopSites from './topSites.js';
import { localizeHtml } from './i18n.js';
import QuizMode from './quiz.js';
import { initSentry, captureException, addBreadcrumb, startTransaction } from './sentry.js';
import { log } from './logger.js';

// Initialize Sentry for content script
initSentry('content-script');

let isMuted = false;
let volumeLevel = CONFIG.DEFAULT_VOLUME;
let lastVolumeLevel = CONFIG.DEFAULT_VOLUME;
let audio;
let video; // Video element for video mode
let isPlaying = false;
let shouldShowReviewPrompt = false;
let birdInfo;
let quizMode;
let saveVolumeTimeout = null;
let showShareMenu = false;
let videoVisibilityManager = null; // Manages video visibility and memory

// Video Visibility Manager - handles tab visibility, memory management, and state
class VideoVisibilityManager {
  constructor(videoElement, birdData) {
    this.video = videoElement;
    this.birdData = birdData; // Store bird info for credits switching
    this.hiddenTimestamp = null;
    this.wasPlaying = false;
    this.lastPlaybackPosition = 0;
    this.isUnloaded = false;
    this.unloadTimeout = null;
    this.UNLOAD_DELAY = 30000; // 30 seconds

    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    log('VideoVisibilityManager initialized');
  }

  handleVisibilityChange() {
    if (document.hidden) {
      this.onTabHidden();
    } else {
      this.onTabVisible();
    }
  }

  onTabHidden() {
    this.hiddenTimestamp = Date.now();
    this.wasPlaying = this.video && !this.video.paused;
    this.lastPlaybackPosition = this.video ? this.video.currentTime : 0;

    // Pause video immediately
    if (this.video && !this.video.paused) {
      this.video.pause();
      log('Video paused on tab hide');
    }

    // Schedule unload after 30 seconds
    this.unloadTimeout = setTimeout(() => {
      this.unloadVideo();
    }, this.UNLOAD_DELAY);

    log(`Tab hidden, scheduled unload in ${this.UNLOAD_DELAY}ms`);
  }

  onTabVisible() {
    // Clear unload timeout if returning before 30s
    if (this.unloadTimeout) {
      clearTimeout(this.unloadTimeout);
      this.unloadTimeout = null;
    }

    if (this.isUnloaded) {
      // Video was unloaded - show play overlay, let user click to reload
      log('Tab visible after unload - showing play overlay');
      this.showPlayOverlay();
      this.switchToPhotoCredits();
    } else if (this.wasPlaying && this.video) {
      // Video still in memory - resume playback
      log('Tab visible < 30s - resuming video');
      this.video.play().catch(err => {
        log(`Error resuming video: ${err.message}`);
      });
    }
  }

  unloadVideo() {
    if (!this.video || this.isUnloaded) return;

    log('Unloading video to release memory');
    this.isUnloaded = true;

    // Pause the video first
    this.video.pause();

    // Remove the video element entirely to release memory without triggering error events
    // (Setting src='' and calling load() triggers an error event which we want to avoid)
    if (this.video.parentNode) {
      this.video.remove();
    }

    // Clear references
    this.video = null;
    video = null; // Clear global reference too

    // Show the poster image
    showPosterImage();

    // Show play overlay
    this.showPlayOverlay();

    // Hide video controls (they don't make sense when video is unloaded)
    cleanupVideoControls();

    // Switch to photo credits (we're showing the poster now)
    this.switchToPhotoCredits();
  }

  showPlayOverlay() {
    // Remove existing overlay if present
    const existing = document.querySelector('.video-play-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'video-play-overlay';
    overlay.innerHTML = `
      <button class="video-play-btn" aria-label="${chrome.i18n.getMessage('playTooltip') || 'Play video'}">
        <img src="images/svg/play.svg" alt="Play" width="32" height="32">
      </button>
    `;

    overlay.addEventListener('click', async () => {
      if (this.isUnloaded) {
        // Video was unloaded - need to reload
        await this.reloadAndPlay();
      } else {
        // Video is just paused - play it
        this.hidePlayOverlay();
        if (this.video) {
          await playVideo();
        }
      }
    });

    const contentContainer = document.getElementById('content-container');
    if (contentContainer) {
      contentContainer.appendChild(overlay);
    }
  }

  hidePlayOverlay() {
    const overlay = document.querySelector('.video-play-overlay');
    if (overlay) overlay.remove();
  }

  async reloadAndPlay() {
    if (!this.birdData || !this.birdData.videoUrl) {
      log('Cannot reload - no video URL available');
      return;
    }

    log('Reloading video after unload');

    // Reset unloaded state BEFORE reloading to prevent error handler from ignoring real errors
    this.isUnloaded = false;
    this.wasPlaying = false;

    // Show loading indicator
    showVideoLoadingIndicator();

    // Hide the play overlay immediately to show we're responding
    this.hidePlayOverlay();

    // Always create a fresh video element to avoid stale state issues
    const existingVideo = document.querySelector('.background-video');
    if (existingVideo) {
      existingVideo.remove();
    }

    // Create new video element
    const videoEl = document.createElement('video');
    videoEl.className = 'background-video hidden';
    videoEl.loop = true;
    videoEl.playsInline = true;
    videoEl.preload = 'auto'; // Use 'auto' for faster loading on reload
    videoEl.poster = this.birdData.imageUrl;

    const source = document.createElement('source');
    source.src = this.birdData.videoUrl;
    source.type = 'video/mp4';
    videoEl.appendChild(source);

    const contentContainer = document.getElementById('content-container');
    if (contentContainer) {
      contentContainer.insertBefore(videoEl, contentContainer.firstChild);
    }

    // Update references
    this.video = videoEl;
    video = videoEl; // Update global reference

    // Handle errors during reload
    const handleReloadError = () => {
      log('Error reloading video, falling back to image mode');
      hideVideoLoadingIndicator();
      showPosterImage();
      this.switchToPhotoCredits();
      // Mark as unloaded so we don't try to play
      this.isUnloaded = true;
    };

    // Set up all event listeners for the reloaded video (play, pause, ended, buffering, etc.)
    const markAsLoaded = setupVideoEventListeners(videoEl, handleReloadError);

    // Handle successful load
    const handleCanPlay = () => {
      hideVideoLoadingIndicator();
      markAsLoaded(); // Mark as successfully loaded
      this.switchToVideoCredits();
      // Re-setup video controls for the reloaded video
      setupVideoControls();
      // Video will be shown when play event fires
    };

    videoEl.addEventListener('canplay', handleCanPlay, { once: true });
    videoEl.addEventListener('error', handleReloadError, { once: true });
    source.addEventListener('error', handleReloadError, { once: true });

    // Apply volume settings
    videoEl.volume = volumeLevel;
    videoEl.muted = isMuted;

    // Play video
    try {
      await videoEl.play();
      isPlaying = true;
      updatePlayPauseButton();
    } catch (err) {
      log(`Error playing video after reload: ${err.message}`);
    }
  }

  switchToPhotoCredits() {
    if (!this.birdData) return;

    const creditsContainer = document.querySelector('.credits');
    if (!creditsContainer) return;

    // Build photo credits HTML
    const photoCreditsHtml = `
      <span class="credit-item">
        <img src="images/svg/camera.svg" alt="${chrome.i18n.getMessage('cameraAlt') || 'Photo'}" width="16" height="16">
        <a href="${this.birdData.photographerUrl}" target="_blank">${this.birdData.photographer}</a>
      </span>
      ${this.birdData.mediaUrl ? `
      <span class="credit-item">
        <img src="images/svg/waveform.svg" alt="${chrome.i18n.getMessage('audioAlt') || 'Audio'}" width="16" height="16">
        <a href="${this.birdData.recordistUrl}" target="_blank">${this.birdData.recordist}</a>
      </span>
      ` : ''}
      <span class="credit-item">
        via <a href="https://www.macaulaylibrary.org/" target="_blank">Macaulay Library</a>
      </span>
      <span id="share-container" class="credit-item share-container">
        <button id="share-button" class="share-inline-button" title="${chrome.i18n.getMessage('shareTooltip') || 'Share'}">
          <img src="images/svg/share.svg" alt="${chrome.i18n.getMessage('shareAlt') || 'Share'}" width="16" height="16">
        </button>
      </span>
    `;

    creditsContainer.innerHTML = photoCreditsHtml;
    setupShareButton(); // Re-bind share button
    log('Switched to photo credits');
  }

  switchToVideoCredits() {
    if (!this.birdData) return;

    const creditsContainer = document.querySelector('.credits');
    if (!creditsContainer) return;

    // Build video credits HTML
    const videoCreditsHtml = `
      <span class="credit-item">
        <img src="images/svg/video.svg" alt="${chrome.i18n.getMessage('videoAlt') || 'Video'}" width="16" height="16">
        <a href="${this.birdData.videographerUrl}" target="_blank">${this.birdData.videographer}</a>
      </span>
      <span class="credit-item">
        via <a href="https://www.macaulaylibrary.org/" target="_blank">Macaulay Library</a>
      </span>
      <span id="share-container" class="credit-item share-container">
        <button id="share-button" class="share-inline-button" title="${chrome.i18n.getMessage('shareTooltip') || 'Share'}">
          <img src="images/svg/share.svg" alt="${chrome.i18n.getMessage('shareAlt') || 'Share'}" width="16" height="16">
        </button>
      </span>
    `;

    creditsContainer.innerHTML = videoCreditsHtml;
    setupShareButton(); // Re-bind share button
    log('Switched to video credits');
  }

  destroy() {
    // Clean up
    if (this.unloadTimeout) {
      clearTimeout(this.unloadTimeout);
    }
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.hidePlayOverlay();
    log('VideoVisibilityManager destroyed');
  }
}

// Array of loading message keys for i18n
const loadingMessageKeys = [
  'loadingMessage1',
  'loadingMessage2',
  'loadingMessage3',
  'loadingMessage4',
  'loadingMessage5',
  'loadingMessage6',
  'loadingMessage7',
  'loadingMessage8',
  'loadingMessage9',
  'loadingMessage10',
  'loadingMessage11',
  'loadingMessage12',
  'loadingMessage13',
  'loadingMessage14',
  'loadingMessage15',
  'loadingMessage16'
];

// Get a random loading message
const getRandomLoadingMessage = () => {
  const randomKey = loadingMessageKeys[Math.floor(Math.random() * loadingMessageKeys.length)];
  return chrome.i18n.getMessage(randomKey);
};

// Show loading indicator with a random message
function showLoadingIndicator() {
  const loadingDiv = document.createElement('div');
  loadingDiv.id = 'loading';
  loadingDiv.innerHTML = `
    <div class="spinner"></div>
    <p id="loading-message">${getRandomLoadingMessage()}</p>
  `;
  document.body.appendChild(loadingDiv);
}

// Hide loading indicator
function hideLoadingIndicator() {
  const loadingDiv = document.getElementById('loading');
  if (loadingDiv) loadingDiv.remove();
}

// Update loading message
function updateLoadingMessage() {
  const loadingMessage = document.getElementById('loading-message');
  if (loadingMessage) {
    loadingMessage.textContent = getRandomLoadingMessage();
    log(`Updated loading message: ${loadingMessage.textContent}`);
  }
}

// Fetch bird information from background script
// Note: No separate transaction here - this is captured as part of the page-load transaction
// to reduce Sentry span usage (1000+ daily users × new tabs)
const MAX_RETRIES = 1; // Reduced to 1 retry to minimize API load

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

// ===== History Management Functions =====

// Add bird to viewing history
async function addToHistory(birdInfo) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['viewHistory'], (result) => {
      const history = result.viewHistory?.value || [];

      const entry = {
        speciesCode: birdInfo.speciesCode,
        name: birdInfo.name,
        scientificName: birdInfo.scientificName,
        imageUrl: birdInfo.imageUrl,
        timestamp: Date.now(),
        ebirdUrl: birdInfo.ebirdUrl
      };

      history.push(entry); // Newest at end

      // Enforce 200 item limit - remove oldest
      if (history.length > 200) {
        history.shift();
      }

      chrome.storage.local.set({
        viewHistory: { value: history, timestamp: Date.now() }
      }, () => {
        if (chrome.runtime.lastError) {
          log(`Error saving history: ${chrome.runtime.lastError.message}`);
        }
        resolve();
      });
    });
  });
}

// Get viewing history
async function getHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['viewHistory'], (result) => {
      resolve(result.viewHistory?.value || []);
    });
  });
}

// Clear all viewing history
async function clearHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(['viewHistory'], resolve);
  });
}

// Get relative time string for timestamp display
function getRelativeTimeString(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return chrome.i18n.getMessage('justNow') || 'Just now';
  } else if (minutes < 60) {
    const key = minutes === 1 ? 'minuteAgo' : 'minutesAgo';
    return chrome.i18n.getMessage(key, [minutes.toString()]) || `${minutes} min ago`;
  } else if (hours < 24) {
    const key = hours === 1 ? 'hourAgo' : 'hoursAgo';
    return chrome.i18n.getMessage(key, [hours.toString()]) || `${hours}h ago`;
  } else if (days === 1) {
    return chrome.i18n.getMessage('yesterday') || 'Yesterday';
  } else if (days < 7) {
    return chrome.i18n.getMessage('daysAgo', [days.toString()]) || `${days} days ago`;
  } else {
    // Format as "Jan 15" or localized equivalent
    const date = new Date(timestamp);
    return new Intl.DateTimeFormat(chrome.i18n.getUILanguage(), {
      month: 'short',
      day: 'numeric'
    }).format(date);
  }
}

// Load specific bird by species code from history
async function loadBirdBySpeciesCode(speciesCode) {
  log(`Loading bird by species code: ${speciesCode}`);

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: 'getBirdInfoBySpeciesCode', speciesCode },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response.error) {
          reject(new Error(response.error));
          return;
        }

        // Store the loaded bird info and reload page
        // This ensures all initialization logic runs correctly
        chrome.storage.local.set({ pendingBirdInfo: response }, () => {
          window.location.reload();
          resolve(response);
        });
      }
    );
  });
}

// ===== End History Management Functions =====

// ===== History Modal UI Functions =====

let historyModal = null;

// Escape HTML to prevent XSS
function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Create history modal DOM element
function createHistoryModal() {
  const existingModal = document.getElementById('history-modal');
  if (existingModal) existingModal.remove();

  const modalHTML = `
    <div id="history-modal" class="settings-modal hidden" role="dialog" aria-modal="true">
      <div class="settings-content history-content">
        <div class="settings-header">
          <h2 id="history-modal-title" data-i18n="historyTitle">Viewing History</h2>
          <button id="close-history" class="close-button" aria-label="Close history">
            <img src="images/svg/close.svg" alt="Close" width="20" height="20">
          </button>
        </div>
        <div class="settings-body">
          <div id="history-list" class="history-list"></div>
          <div id="empty-history" class="empty-history hidden">
            <img src="images/svg/info.svg" alt="" width="64" height="64">
            <p data-i18n="emptyHistory">No viewing history yet. Start exploring birds!</p>
          </div>
        </div>
        <div class="history-footer">
          <button id="clear-history-btn" class="shortcut-btn secondary" data-i18n="clearHistory">
            Clear History
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);
  localizeHtml();
  return document.getElementById('history-modal');
}

// Populate history list with entries
async function populateHistoryList() {
  const history = await getHistory();
  const historyList = document.getElementById('history-list');
  const emptyState = document.getElementById('empty-history');

  if (history.length === 0) {
    historyList.classList.add('hidden');
    emptyState.classList.remove('hidden');
    return;
  }

  historyList.classList.remove('hidden');
  emptyState.classList.add('hidden');

  // Reverse to show newest first
  const reversedHistory = [...history].reverse();

  // Use escaped HTML to prevent XSS
  historyList.innerHTML = reversedHistory.map(entry => `
    <button class="history-item" data-species-code="${escapeHtml(entry.speciesCode)}">
      <img src="${escapeHtml(entry.imageUrl)}" alt="${escapeHtml(entry.name)}" class="history-item-image" loading="lazy">
      <div class="history-item-info">
        <div class="history-item-name">${escapeHtml(entry.name)}</div>
        <div class="history-item-scientific">${escapeHtml(entry.scientificName)}</div>
        <div class="history-item-time">${escapeHtml(getRelativeTimeString(entry.timestamp))}</div>
      </div>
    </button>
  `).join('');
}

// Handle clicking on a history item
async function handleHistoryItemClick(item) {
  const speciesCode = item.dataset.speciesCode;
  closeHistoryModal();
  showLoadingIndicator();

  try {
    await loadBirdBySpeciesCode(speciesCode);
  } catch (error) {
    hideLoadingIndicator();
    log(`Error loading bird from history: ${error.message}`);
    showErrorModal(error.message || 'Failed to load bird. Loading a random bird instead...');
    setTimeout(() => window.location.reload(), 2000);
  }
}

// Open history modal
function openHistoryModal() {
  if (!historyModal) {
    historyModal = createHistoryModal();
    bindHistoryModalEvents();
  }
  populateHistoryList();
  historyModal.classList.remove('hidden');
}

// Close history modal
function closeHistoryModal() {
  if (historyModal) {
    historyModal.classList.add('hidden');
  }
}

// Bind event listeners to history modal
function bindHistoryModalEvents() {
  const closeBtn = document.getElementById('close-history');
  const clearBtn = document.getElementById('clear-history-btn');
  const historyList = document.getElementById('history-list');

  // Close button
  closeBtn.addEventListener('click', closeHistoryModal);

  // Click outside to close
  historyModal.addEventListener('click', (e) => {
    if (e.target === historyModal) {
      closeHistoryModal();
    }
  });

  // ESC key to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !historyModal.classList.contains('hidden')) {
      closeHistoryModal();
    }
  });

  // Event delegation for history items
  historyList.addEventListener('click', (e) => {
    const historyItem = e.target.closest('.history-item');
    if (historyItem) {
      handleHistoryItemClick(historyItem);
    }
  });

  // Clear history button
  clearBtn.addEventListener('click', async () => {
    const confirmed = confirm(chrome.i18n.getMessage('confirmClearHistory') ||
      'Are you sure you want to clear your viewing history?');
    if (confirmed) {
      await clearHistory();
      await populateHistoryList();
    }
  });
}

// ===== End History Modal UI Functions =====

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
  const shouldAutoPlay = await getAutoPlayState();

  if (isQuietHour) {
    hideAudioControls();
    showQuietHoursIcon();
  } else {
    // Video mode: auto-play video if enabled
    if (birdInfo && birdInfo.videoMode && video) {
      showAudioControls();
      if (shouldAutoPlay) {
        await playVideo();
      } else {
        // Show play overlay if not auto-playing
        if (videoVisibilityManager) {
          videoVisibilityManager.showPlayOverlay();
        }
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
async function playVideo() {
  if (!video) return;

  try {
    await video.play();
    isPlaying = true;
    updatePlayPauseButton();
    log('Video playback started');
  } catch (error) {
    if (error.name === 'AbortError') {
      log('Video playback interrupted');
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

function showAudioControls() {
  const playButton = document.getElementById('play-button');
  const volumeControl = document.getElementById('volume-control');
  if (playButton) playButton.style.display = 'inline-flex';
  if (volumeControl) volumeControl.style.display = 'inline-flex';
}

function showQuietHoursIcon() {
  const button = document.createElement('button');
  button.id = 'quiet-hours-button';
  button.className = 'icon-button';
  button.innerHTML = `<img src="images/svg/moon.svg" class="invert" alt="${chrome.i18n.getMessage('quietHoursAlt')}" width="24" height="24">`;
  button.title = chrome.i18n.getMessage('quietHoursActive');

  document.querySelector('.control-buttons').appendChild(button);
}

// Load audio without playing it
function loadAudioWithoutPlaying() {
  if (audio) {
    audio.pause();
    audio = null;
  }
  audio = new Audio(birdInfo.mediaUrl);
  audio.preload = 'metadata'; // Only load metadata to save bandwidth
  updatePlayPauseButton();
}

// Create audio player for bird calls (image mode)
function createAudioPlayer(mediaUrl) {
  if (!mediaUrl) {
    log('No media URL provided, skipping audio player creation');
    return null;
  }

  log(`Creating audio player with URL: ${mediaUrl}`);
  audio = new Audio(mediaUrl);
  // Skip the first 4 seconds of the audio
  // because it's usually recordist commentary
  audio.currentTime = 4;
  audio.muted = isMuted;
  audio.volume = volumeLevel;

  const playButton = document.createElement('button');
  playButton.id = 'play-button';
  playButton.classList.add('icon-button', 'play-button');
  playButton.innerHTML = `<img src="images/svg/play.svg" alt="${chrome.i18n.getMessage('playAlt')}" width="16" height="16">`;
  playButton.title = chrome.i18n.getMessage('playTooltip');
  playButton.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await togglePlay();
  });

  audio.onended = () => {
    isPlaying = false;
    updatePlayPauseButton();
  };

  return playButton;
}

// Create video player controls (video mode)
function createVideoPlayer() {
  log('Creating video player controls');

  // In video mode, we don't show the bottom-right play/pause button
  // Instead, we use the centered play overlay
  return null;
}

// Toggle video play/pause
async function toggleVideoPlay() {
  if (!video) return;

  if (isPlaying) {
    pauseVideo();
  } else {
    await playVideo();
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

  if (!audio) {
    audio = new Audio(birdInfo.mediaUrl);
    audio.volume = volumeLevel;
    audio.muted = isMuted;
  }
  try {
    await audio.play();
    isPlaying = true;
    updatePlayPauseButton();

    // Fade in the audio gradually to the current volume level
    const targetVolume = isMuted ? 0 : volumeLevel;
    audio.volume = 0;
    let fadeAudioIn = setInterval(function () {
      if (audio.volume < targetVolume - 0.1) {
        audio.volume += 0.1;
      } else {
        audio.volume = targetVolume;
        clearInterval(fadeAudioIn);
      }
    }, 200);
  } catch (error) {
    // AbortError is expected when user opens multiple tabs quickly (background sends pauseAudio)
    // Don't log this as an error - it's normal behavior
    if (error.name === 'AbortError') {
      log('Audio playback interrupted (user opened another tab)');
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

// Review section

function incrementNewTabCount() {
  chrome.storage.local.get(['newTabCount', 'installTime'], function (result) {
    const now = Date.now();
    const installTime = result.installTime || now;

    if (now - installTime <= 28 * 24 * 60 * 60 * 1000) {
      chrome.storage.local.set({
        newTabCount: (result.newTabCount || 0) + 1
      });
    }
  });
}

function checkAndPrepareReviewPrompt() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['installTime', 'newTabCount', 'lastReviewPrompt', 'reviewDismissed', 'reviewLeft'], function (result) {
      const now = Date.now();
      const installTime = result.installTime || now;
      const newTabCount = result.newTabCount || 0;
      const lastReviewPrompt = result.lastReviewPrompt || 0;
      const reviewDismissed = result.reviewDismissed || false;
      const reviewLeft = result.reviewLeft || false;

      if (reviewLeft || reviewDismissed) {
        resolve(false);
        return;
      }

      const isDev = process.env.NODE_ENV !== 'production';
      const timeDelay = isDev ? CONFIG.DEV_TIME_DELAY : CONFIG.PROD_TIME_DELAY;
      const tabCountThreshold = isDev ? CONFIG.DEV_TAB_COUNT : CONFIG.PROD_TAB_COUNT;
      const oneWeek = 7 * 24 * 60 * 60 * 1000;

      const timeCondition = now - installTime > timeDelay;
      const activityCondition = newTabCount >= tabCountThreshold;
      const frequencyCondition = now - lastReviewPrompt > timeDelay;

      shouldShowReviewPrompt = timeCondition && activityCondition && frequencyCondition;
      resolve(shouldShowReviewPrompt);
    });
  });
}

function getReviewPromptHTML() {
  return `
    <div id="review-prompt" class="review-prompt">
      <div class="review-content">
        <h2>${chrome.i18n.getMessage('reviewPromptTitle')}</h2>
        <p>${chrome.i18n.getMessage('reviewPromptMessage')}</p>
        <div class="review-buttons">
          <button id="leave-review" class="review-btn primary">${chrome.i18n.getMessage('leaveReview')}</button>
          <button id="maybe-later" class="review-btn secondary">${chrome.i18n.getMessage('maybeLater')}</button>
          <button id="no-thanks" class="review-btn tertiary">${chrome.i18n.getMessage('noThanks')}</button>
        </div>
      </div>
    </div>
  `;
}

// New function to set image source and show it when loaded
function setImageSource(imageUrl) {
  const img = document.querySelector('.background-image');
  img.onload = function () {
    img.classList.remove('hidden');
  };
  img.src = imageUrl;
}

// Set up all video event listeners (play, pause, ended, buffering, errors, etc.)
// This is extracted into a separate function so it can be reused when reloading video
function setupVideoEventListeners(videoEl, fallbackToImage) {
  // Handle buffering - show loading indicator when video is waiting for data
  videoEl.addEventListener('waiting', function () {
    log('Video buffering...');
    showVideoLoadingIndicator();
  });

  // Handle buffering resolved - hide loading indicator when video can play
  videoEl.addEventListener('canplaythrough', function () {
    hideVideoLoadingIndicator();
  });

  // Also hide loading indicator on playing event (in case canplaythrough doesn't fire)
  videoEl.addEventListener('playing', function () {
    hideVideoLoadingIndicator();
  });

  // Track if initial load has completed successfully
  let hasLoadedSuccessfully = false;

  // Handle video element errors
  // Note: We need to ignore errors that occur after intentional unload or during playback
  videoEl.addEventListener('error', function (e) {
    // If video was intentionally unloaded by VideoVisibilityManager, ignore errors
    if (videoVisibilityManager && videoVisibilityManager.isUnloaded) {
      log('Ignoring video error after intentional unload');
      return;
    }

    // If video already loaded successfully before, don't fall back on transient errors
    // (network hiccups during playback shouldn't cause full fallback)
    if (hasLoadedSuccessfully) {
      log(`Video playback error (non-fatal): ${e.message || 'Unknown error'}`);
      return;
    }

    log(`Video load error: ${e.message || 'Unknown error'}, falling back to image`);
    if (fallbackToImage) fallbackToImage();
  });

  // Handle source element errors (this is where most load failures occur)
  const source = videoEl.querySelector('source');
  if (source) {
    source.addEventListener('error', function (e) {
      // If video was intentionally unloaded, ignore errors
      if (videoVisibilityManager && videoVisibilityManager.isUnloaded) {
        log('Ignoring source error after intentional unload');
        return;
      }

      // If already loaded successfully, don't fall back
      if (hasLoadedSuccessfully) {
        log('Video source error (non-fatal during playback)');
        return;
      }

      log('Video source failed to load, falling back to image');
      if (fallbackToImage) fallbackToImage();
    });
  }

  // Handle video ended - show poster and replay overlay
  videoEl.addEventListener('ended', function () {
    isPlaying = false;
    updatePlayPauseButton();
    showPosterImage();

    // Reset video to beginning for replay
    videoEl.currentTime = 0;

    // Show play overlay for replay and switch to photo credits (showing poster)
    if (videoVisibilityManager) {
      videoVisibilityManager.showPlayOverlay();
      videoVisibilityManager.switchToPhotoCredits();
    }
  });

  // Handle video play/pause state changes
  videoEl.addEventListener('play', function () {
    isPlaying = true;
    updatePlayPauseButton();
    showVideoElement();

    // Hide play overlay when video starts playing and switch to video credits
    if (videoVisibilityManager) {
      videoVisibilityManager.hidePlayOverlay();
      videoVisibilityManager.switchToVideoCredits();
    }
  });

  videoEl.addEventListener('pause', function () {
    isPlaying = false;
    updatePlayPauseButton();
    showPosterImage();

    // Show play overlay when paused and switch to photo credits (showing poster)
    if (videoVisibilityManager && !videoVisibilityManager.isUnloaded) {
      videoVisibilityManager.showPlayOverlay();
      videoVisibilityManager.switchToPhotoCredits();
    }
  });

  // Add click handler on video to toggle play/pause
  videoEl.addEventListener('click', async function (e) {
    e.preventDefault();
    e.stopPropagation();

    if (videoEl.paused) {
      // Video is paused - clicking overlay will play it
      // The overlay click handler will handle this
    } else {
      // Video is playing - pause it and show overlay
      pauseVideo();
    }
  });

  // Return a function to mark the video as successfully loaded
  return () => {
    hasLoadedSuccessfully = true;
  };
}

// Set up video to show when ready
function setVideoSource() {
  const videoEl = document.querySelector('.background-video');
  if (!videoEl) return;

  // Show loading indicator immediately
  showVideoLoadingIndicator();

  const fallbackToImage = () => {
    log('Falling back to image mode (visual only)');
    showPosterImage();

    // Remove loading indicator
    hideVideoLoadingIndicator();
    cleanupVideoControls();

    // Show play overlay so user can click to retry loading the video
    if (videoVisibilityManager) {
      videoVisibilityManager.isUnloaded = true; // Mark as needing reload
      videoVisibilityManager.showPlayOverlay();
      videoVisibilityManager.switchToPhotoCredits(); // Show photo credits while image is displayed
    }

    // Keep video reference for retry attempts - don't destroy the manager
    // The play overlay click will trigger reloadAndPlay
  };

  // Set up all event listeners for video playback, buffering, errors, etc.
  const markAsLoaded = setupVideoEventListeners(videoEl, fallbackToImage);

  // Show video when it can start playing
  videoEl.addEventListener('canplay', function () {
    log('Video ready to play');

    // Mark as successfully loaded - future errors won't trigger fallback
    markAsLoaded();

    // Hide loading indicator
    hideVideoLoadingIndicator();

    // Setup video controls (progress bar + duration)
    setupVideoControls();

    // Switch from photo credits to video credits
    if (videoVisibilityManager) {
      videoVisibilityManager.switchToVideoCredits();
    }

    // Note: We don't show video here - it will be shown when play event fires
    // If autoplay is disabled, poster remains visible until user clicks play
  }, { once: true });

  // Start loading the video
  videoEl.load();
}

// Show video loading indicator in top-left corner
function showVideoLoadingIndicator() {
  // Don't show if already exists
  if (document.querySelector('.video-loading-indicator')) return;

  const indicator = document.createElement('div');
  indicator.className = 'video-loading-indicator';
  indicator.innerHTML = '<div class="loading-spinner"></div>';

  const contentContainer = document.getElementById('content-container');
  if (contentContainer) {
    contentContainer.appendChild(indicator);
  }
}

// Hide video loading indicator
function hideVideoLoadingIndicator() {
  const indicator = document.querySelector('.video-loading-indicator');
  if (indicator) {
    indicator.remove();
  }
}

// Video progress bar controller
let progressHideTimeout = null;

// Create video progress bar
function createVideoProgressBar() {
  // Don't create if already exists
  if (document.querySelector('.video-progress')) return;

  const progressBar = document.createElement('div');
  progressBar.className = 'video-progress';
  progressBar.innerHTML = `
    <div class="video-progress-buffered"></div>
    <div class="video-progress-played"></div>
  `;

  const contentContainer = document.getElementById('content-container');
  if (contentContainer) {
    contentContainer.appendChild(progressBar);
  }

  // Click to seek
  progressBar.addEventListener('click', handleProgressBarClick);

  return progressBar;
}

// Handle click on progress bar to seek
function handleProgressBarClick(e) {
  if (!video || !video.duration) return;

  const progressBar = e.currentTarget;
  const rect = progressBar.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const percentage = clickX / rect.width;
  const newTime = percentage * video.duration;

  video.currentTime = newTime;
  updateProgressBar();
}

// Update progress bar visuals
function updateProgressBar() {
  if (!video) return;

  const playedBar = document.querySelector('.video-progress-played');
  const bufferedBar = document.querySelector('.video-progress-buffered');

  if (playedBar && video.duration) {
    const playedPercent = (video.currentTime / video.duration) * 100;
    playedBar.style.width = `${playedPercent}%`;
  }

  if (bufferedBar && video.buffered.length > 0 && video.duration) {
    // Get the buffered end time for the current position
    let bufferedEnd = 0;
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= video.currentTime && video.currentTime <= video.buffered.end(i)) {
        bufferedEnd = video.buffered.end(i);
        break;
      }
    }
    const bufferedPercent = (bufferedEnd / video.duration) * 100;
    bufferedBar.style.width = `${bufferedPercent}%`;
  }
}

// Show progress bar
function showProgressBar() {
  const progressBar = document.querySelector('.video-progress');
  if (progressBar) {
    progressBar.classList.add('visible');
  }

  // Clear existing timeout
  if (progressHideTimeout) {
    clearTimeout(progressHideTimeout);
  }

  // Hide after 3 seconds (unless paused)
  if (video && !video.paused) {
    progressHideTimeout = setTimeout(() => {
      hideProgressBar();
    }, 3000);
  }
}

// Hide progress bar
function hideProgressBar() {
  const progressBar = document.querySelector('.video-progress');
  if (progressBar && video && !video.paused) {
    progressBar.classList.remove('visible');
  }
}

// Check if video has audio track
function videoHasAudio(videoEl) {
  // Check various browser-specific properties
  if (typeof videoEl.webkitAudioDecodedByteCount !== 'undefined') {
    // Chrome/Safari - check after some playback
    return videoEl.webkitAudioDecodedByteCount > 0;
  }
  if (typeof videoEl.mozHasAudio !== 'undefined') {
    // Firefox
    return videoEl.mozHasAudio;
  }
  if (videoEl.audioTracks && videoEl.audioTracks.length > 0) {
    // Standard API (limited support)
    return true;
  }
  // Assume has audio if we can't detect
  return true;
}

// Update volume control visibility based on whether video has audio
function updateVolumeControlForVideo() {
  if (!video) return;

  const videoEl = video; // Capture reference

  // We need to wait a bit for audio to be detected after video starts playing
  const checkAudio = () => {
    // Safety check - video might have been unloaded
    if (!videoEl || !video) return;
    
    const hasAudio = videoHasAudio(videoEl);
    
    if (!hasAudio) {
      // Use existing hideAudioControls pattern
      hideAudioControls();
      log('Video has no audio track - hiding volume control');
    }
  };

  // Check after video has been playing for a short time
  // (webkitAudioDecodedByteCount only updates after some decoding)
  const checkOnce = function() {
    // Safety check - video might have been unloaded
    if (!videoEl || !video || videoEl !== video) {
      videoEl.removeEventListener('timeupdate', checkOnce);
      return;
    }
    if (videoEl.currentTime > 0.5) {
      checkAudio();
      videoEl.removeEventListener('timeupdate', checkOnce);
    }
  };

  video.addEventListener('timeupdate', checkOnce);
}

// Setup video controls (progress bar)
function setupVideoControls() {
  if (!video) return;

  // Create progress bar
  createVideoProgressBar();

  // Check if video has audio and update volume control accordingly
  updateVolumeControlForVideo();

  // Listen for timeupdate to update progress
  video.addEventListener('timeupdate', () => {
    updateProgressBar();
  });

  // Show progress bar on mouse move over video/content
  const contentContainer = document.getElementById('content-container');
  if (contentContainer) {
    contentContainer.addEventListener('mousemove', () => {
      if (video) {
        showProgressBar();
      }
    });

    contentContainer.addEventListener('mouseleave', () => {
      if (video && !video.paused) {
        hideProgressBar();
      }
    });
  }

  // Always show progress bar when paused
  video.addEventListener('pause', () => {
    showProgressBar();
    if (progressHideTimeout) {
      clearTimeout(progressHideTimeout);
    }
  });

  // Start hiding timer when playing
  video.addEventListener('play', () => {
    // Don't immediately hide, let the 3s timer handle it
    showProgressBar();
  });
}

// Cleanup video controls (when falling back to image mode or unloading)
function cleanupVideoControls() {
  // Remove progress bar
  const progressBar = document.querySelector('.video-progress');
  if (progressBar) {
    progressBar.remove();
  }

  // Clear any pending hide timeout
  if (progressHideTimeout) {
    clearTimeout(progressHideTimeout);
    progressHideTimeout = null;
  }
}

// Switch to full image mode credits (photo + audio) on video fallback
function switchToImageModeCredits() {
  const creditsContainer = document.querySelector('.credits');
  if (!creditsContainer || !birdInfo) return;

  const imageCreditsHtml = `
    <span class="credit-item">
      <img src="images/svg/camera.svg" alt="${chrome.i18n.getMessage('cameraAlt') || 'Photo'}" width="16" height="16">
      <a href="${birdInfo.photographerUrl}" target="_blank">${birdInfo.photographer}</a>
    </span>
    ${birdInfo.mediaUrl ? `
    <span class="credit-item">
      <img src="images/svg/waveform.svg" alt="${chrome.i18n.getMessage('audioAlt') || 'Audio'}" width="16" height="16">
      <a href="${birdInfo.recordistUrl}" target="_blank">${birdInfo.recordist}</a>
    </span>
    ` : ''}
    <span class="credit-item">
      via <a href="https://www.macaulaylibrary.org/" target="_blank">Macaulay Library</a>
    </span>
    <span id="share-container" class="credit-item share-container">
      <button id="share-button" class="share-inline-button" title="${chrome.i18n.getMessage('shareTooltip') || 'Share'}">
        <img src="images/svg/share.svg" alt="${chrome.i18n.getMessage('shareAlt') || 'Share'}" width="16" height="16">
      </button>
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

    if (pendingBird) {
      birdInfo = pendingBird;
    } else {
      birdInfo = await getBirdInfo();
    }

    // Add bird to viewing history
    await addToHistory(birdInfo);

    // add artificial delay of about 4 seconds to simulate a slow loading experience
    // await new Promise(resolve => setTimeout(resolve, 4000));


    clearInterval(loadingInterval);
    hideLoadingIndicator();

    // add a class to the body to trigger the fade-in animation
    document.body.classList.add('loaded');

    log('Bird info received, updating page content');

    const contentContainer = document.getElementById('content-container');

    // Determine if we're in video mode (video mode enabled AND video available)
    const isVideoMode = birdInfo.videoMode;

    // Build credits HTML based on mode
    // In video mode, initially show photo credits (poster visible while video loads)
    // Credits will switch to video credits when video is ready (canplay event)
    let creditsHtml;
    if (isVideoMode) {
      // Video mode: initially show photo credits
      // (we're showing the poster while video loads)
      // Will switch to video credits on canplay event
      creditsHtml = `
        <span class="credit-item">
          <img src="images/svg/camera.svg" alt="${chrome.i18n.getMessage('cameraAlt') || 'Photo'}" width="16" height="16">
          <a href="${birdInfo.photographerUrl}" target="_blank">${birdInfo.photographer}</a>
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
          <img src="images/svg/waveform.svg" alt="${chrome.i18n.getMessage('audioAlt')}" width="16" height="16">
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
            <span id="scientific-name"></span>
          </a>
          <span class="info-icon" data-tooltip="${birdInfo.description}&#10;&#10;Conservation Status: ${birdInfo.conservationStatus}">
            <img src="images/svg/info.svg" alt="${chrome.i18n.getMessage('infoAlt')}" width="16" height="16">
          </span>
        </div>
        <p class="credits">
          ${creditsHtml}
          <span class="credit-item">
            via <a href="https://www.macaulaylibrary.org/" target="_blank">Macaulay Library</a>
          </span>
          <span id="share-container" class="credit-item share-container">
            <button id="share-button" class="share-inline-button" title="${chrome.i18n.getMessage('shareTooltip')}">
              <img src="images/svg/share.svg" alt="${chrome.i18n.getMessage('shareAlt')}" width="16" height="16">
            </button>
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

      // Initialize VideoVisibilityManager for tab visibility handling
      if (videoVisibilityManager) {
        videoVisibilityManager.destroy();
      }
      videoVisibilityManager = new VideoVisibilityManager(video, birdInfo);

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
      } else {
        log('No audio URL found in bird info');
        hideAudioControls();
      }
    }


    const lang = chrome.i18n.getUILanguage();
    let nameToDisplay = birdInfo.name;

    if (lang && birdInfo.primaryComName_fr && lang.toLowerCase().startsWith('fr')) {
      nameToDisplay = birdInfo.primaryComName_fr;
    } else if (lang && birdInfo.primaryComName_cn && lang.toLowerCase().startsWith('zh')) {
      nameToDisplay = birdInfo.primaryComName_cn;
    }

    document.getElementById('bird-name').textContent = nameToDisplay;
    document.getElementById('scientific-name').textContent = "(" + birdInfo.scientificName + ")";

    document.getElementById('refresh-button').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
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

    // Setup share functionality
    setupShareButton();

    // After updating the page content, add the review prompt if needed
    if (shouldShowReviewPrompt) {
      document.body.insertAdjacentHTML('beforeend', getReviewPromptHTML());
      addReviewPromptListeners();
    }

    setupExternalLinks();

    // Initialize settings modal immediately after DOM elements are created
    // (before initializeAudio which may take time for video to load)
    try {
      new SettingsModal();
    } catch (error) {
      console.error('Failed to initialize settings modal:', error);
      captureException(error, {
        tags: { operation: 'initializeSettingsModal' }
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

function addReviewPromptListeners() {
  document.getElementById('leave-review').addEventListener('click', () => {
    if (process.env.BROWSER === 'edge') {
      chrome.tabs.create({ url: 'https://microsoftedge.microsoft.com/addons/detail/ciggnaneplggkgmjnmcjpmaggbbbcakg' });
    } else {
      chrome.tabs.create({ url: 'https://chromewebstore.google.com/detail/birdtab/dkdnidbnjihhilbjndnnlfipmbnoaipn' });
    }
    chrome.storage.local.set({ reviewLeft: true });
    dismissPrompt();
  });

  document.getElementById('maybe-later').addEventListener('click', () => {
    chrome.storage.local.set({ lastReviewPrompt: Date.now() });
    dismissPrompt();
  });

  document.getElementById('no-thanks').addEventListener('click', () => {
    chrome.storage.local.set({ reviewDismissed: true });
    dismissPrompt();
  });
}

function dismissPrompt() {
  const prompt = document.getElementById('review-prompt');
  if (prompt) {
    prompt.style.opacity = '0';
    setTimeout(() => prompt.remove(), 300);
  }
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
    volumeSlider.value = Math.round(volumeLevel * 100);
    // Update CSS custom property for visual feedback
    volumeSlider.style.setProperty('--volume-percentage', `${volumeLevel * 100}%`);
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

  // Volume slider change handler
  volumeSlider.addEventListener('input', (e) => {
    const newVolume = parseFloat(e.target.value) / 100;
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

// Show poster image, hide video (for paused/ended/unloaded states)
function showPosterImage() {
  const videoEl = document.querySelector('.background-video');
  const posterEl = document.querySelector('.background-image');

  if (videoEl) {
    videoEl.classList.add('hidden');
  }
  if (posterEl) {
    posterEl.classList.remove('hidden');
    posterEl.classList.remove('video-fallback');
  }
  log('Showing poster image');
}

// Show video, hide poster (for playing state)
function showVideoElement() {
  const videoEl = document.querySelector('.background-video');
  const posterEl = document.querySelector('.background-image');

  if (videoEl) {
    videoEl.classList.remove('hidden');
  }
  if (posterEl) {
    posterEl.classList.add('video-fallback'); // Keep it loaded but behind video
  }
  log('Showing video element');
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
}

// Share functionality
function getShareUrl() {
  return `https://birdtab.app/species/${birdInfo.speciesCode}`;
}

function getShareText() {
  const template = chrome.i18n.getMessage('shareText') || 'Check out this beautiful {birdName}!';
  return template.replace('{birdName}', birdInfo.name);
}

function copyToClipboard() {
  const shareUrl = getShareUrl();
  navigator.clipboard.writeText(shareUrl).then(() => {
    const copyBtn = document.querySelector('.share-menu-copy-btn');
    if (copyBtn) {
      copyBtn.textContent = chrome.i18n.getMessage('linkCopied') || 'Copied!';
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.textContent = chrome.i18n.getMessage('copyLink') || 'Copy';
        copyBtn.classList.remove('copied');
      }, 2000);
    }
  }).catch(err => {
    console.error('Failed to copy:', err);
  });
}

function shareToTwitter() {
  const shareUrl = getShareUrl();
  const shareText = getShareText();
  window.open(
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`,
    '_blank',
    'width=550,height=420'
  );
  closeShareMenu();
}

function shareToFacebook() {
  const shareUrl = getShareUrl();
  window.open(
    `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
    '_blank',
    'width=550,height=420'
  );
  closeShareMenu();
}

function shareToWhatsApp() {
  const shareUrl = getShareUrl();
  const shareText = getShareText();
  window.open(
    `https://wa.me/?text=${encodeURIComponent(shareText + ' ' + shareUrl)}`,
    '_blank'
  );
  closeShareMenu();
}

function createShareMenuHTML() {
  const shareUrl = getShareUrl();
  return `
    <div class="share-menu">
      <div class="share-menu-section">
        <p class="share-menu-label">${chrome.i18n.getMessage('shareLink') || 'Share link'}</p>
        <div class="share-menu-url-row">
          <div class="share-menu-url">
            <span class="share-menu-url-text">${shareUrl}</span>
          </div>
          <button class="share-menu-copy-btn">${chrome.i18n.getMessage('copyLink') || 'Copy'}</button>
        </div>
      </div>
      <div class="share-menu-section">
        <p class="share-menu-label">${chrome.i18n.getMessage('shareOn') || 'Share on'}</p>
        <div class="share-menu-social">
          <button class="share-social-btn share-twitter" title="${chrome.i18n.getMessage('shareToX') || 'Share on X'}">
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
          </button>
          <button class="share-social-btn share-facebook" title="${chrome.i18n.getMessage('shareToFacebook') || 'Share on Facebook'}">
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
            </svg>
          </button>
          <button class="share-social-btn share-whatsapp" title="${chrome.i18n.getMessage('shareToWhatsApp') || 'Share on WhatsApp'}">
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  `;
}

function openShareMenu() {
  const shareContainer = document.getElementById('share-container');
  if (!shareContainer || showShareMenu) return;

  showShareMenu = true;
  shareContainer.insertAdjacentHTML('beforeend', createShareMenuHTML());

  // Add event listeners to share menu buttons
  const copyBtn = shareContainer.querySelector('.share-menu-copy-btn');
  const twitterBtn = shareContainer.querySelector('.share-twitter');
  const facebookBtn = shareContainer.querySelector('.share-facebook');
  const whatsappBtn = shareContainer.querySelector('.share-whatsapp');

  if (copyBtn) copyBtn.addEventListener('click', copyToClipboard);
  if (twitterBtn) twitterBtn.addEventListener('click', shareToTwitter);
  if (facebookBtn) facebookBtn.addEventListener('click', shareToFacebook);
  if (whatsappBtn) whatsappBtn.addEventListener('click', shareToWhatsApp);

  // Close on click outside
  setTimeout(() => {
    document.addEventListener('mousedown', handleClickOutsideShareMenu);
    document.addEventListener('keydown', handleEscapeShareMenu);
  }, 10);
}

function closeShareMenu() {
  const shareMenu = document.querySelector('.share-menu');
  if (shareMenu) {
    shareMenu.remove();
  }
  showShareMenu = false;
  document.removeEventListener('mousedown', handleClickOutsideShareMenu);
  document.removeEventListener('keydown', handleEscapeShareMenu);
}

function handleClickOutsideShareMenu(event) {
  const shareContainer = document.getElementById('share-container');
  if (shareContainer && !shareContainer.contains(event.target)) {
    closeShareMenu();
  }
}

function handleEscapeShareMenu(event) {
  if (event.key === 'Escape') {
    closeShareMenu();
  }
}

async function handleShare() {
  // Check if native share is available (mobile/touch devices)
  const isMobile = window.matchMedia('(max-width: 768px)').matches || 'ontouchstart' in window;
  
  if (isMobile && navigator.share) {
    try {
      await navigator.share({
        title: `${birdInfo.name} | BirdTab`,
        text: getShareText(),
        url: getShareUrl(),
      });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      // Fall through to show menu if native share fails
    }
  }
  
  // On desktop or if native share unavailable, toggle dropdown
  if (showShareMenu) {
    closeShareMenu();
  } else {
    openShareMenu();
  }
}

function setupShareButton() {
  const shareButton = document.getElementById('share-button');
  if (shareButton) {
    shareButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleShare();
    });
  }
}

function initializeSearch() {
  const searchContainer = document.getElementById('search-container');

  // Check settings synchronously first to show/hide immediately
  chrome.storage.sync.get(['quickAccessEnabled'], (result) => {
    chrome.permissions.contains({
      permissions: ['search']
    }, (hasPermission) => {
      if (hasPermission && result.quickAccessEnabled) {
        searchContainer.style.display = 'block';
        setupSearchListeners();
      } else {
        searchContainer.style.display = 'none';
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

// Initialize page when DOM content is loaded
document.addEventListener('DOMContentLoaded', async () => {
  // Start performance monitoring transaction
  const transaction = startTransaction('page-load', 'navigation');

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

  // Initialize quiz mode
  try {
    quizMode = new QuizMode();
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
  if (videoVisibilityManager) {
    videoVisibilityManager.destroy();
    videoVisibilityManager = null;
  }

  // Release video memory
  if (video) {
    video.pause();
    video.src = '';
    video.load();
    video = null;
  }

  // Release audio memory
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
        setupSearchListeners();
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