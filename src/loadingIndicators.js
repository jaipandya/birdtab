/**
 * Loading Indicators Module
 * Manages page loading, media loading indicators, media play/pause indicators, and toast notifications
 */

// ===== Media Indicator State =====
let mediaPlayIndicatorTimeout = null;
let mediaPauseIndicatorTimeout = null;

// ===== Loading Indicator State =====
let loadingShowTimeout = null;
let loadingCancelled = false;
const LOADING_SHOW_DELAY_MS = 1000;

// ===== Loading Messages =====

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

/**
 * Get a random loading message
 * @returns {string} Localized loading message
 */
export function getRandomLoadingMessage() {
  const randomKey = loadingMessageKeys[Math.floor(Math.random() * loadingMessageKeys.length)];
  return chrome.i18n.getMessage(randomKey);
}

// ===== Page Loading Indicator =====

/**
 * Schedule the page loading indicator to appear after a delay.
 * If hideLoadingIndicator() is called before the delay elapses,
 * the indicator never appears — avoiding a distracting flash
 * when content loads quickly.
 */
export function showLoadingIndicator() {
  loadingCancelled = false;

  if (loadingShowTimeout) {
    clearTimeout(loadingShowTimeout);
  }

  loadingShowTimeout = setTimeout(() => {
    loadingShowTimeout = null;
    if (loadingCancelled) return;

    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'loading';
    loadingDiv.innerHTML = `
      <div class="spinner"></div>
      <p id="loading-message">${getRandomLoadingMessage()}</p>
    `;
    document.body.appendChild(loadingDiv);
  }, LOADING_SHOW_DELAY_MS);
}

/**
 * Hide page loading indicator with a subtle fade-out.
 * Also cancels a pending show if the delay hasn't elapsed yet.
 */
export function hideLoadingIndicator() {
  loadingCancelled = true;

  if (loadingShowTimeout) {
    clearTimeout(loadingShowTimeout);
    loadingShowTimeout = null;
  }

  const loadingDiv = document.getElementById('loading');
  if (!loadingDiv) return;
  loadingDiv.style.opacity = '0';
  setTimeout(() => loadingDiv.remove(), 300);
}

/**
 * Update loading message with a new random message
 */
export function updateLoadingMessage() {
  const loadingMessage = document.getElementById('loading-message');
  if (loadingMessage) {
    loadingMessage.textContent = getRandomLoadingMessage();
  }
}

// ===== Audio Loading Indicator =====

/**
 * Show audio loading indicator (used when fetching audio on-demand)
 */
export function showAudioLoadingIndicator() {
  // Don't show if already exists
  const existing = document.querySelector('.audio-loading-indicator');
  if (existing) return;

  const indicator = document.createElement('div');
  indicator.className = 'video-loading-indicator audio-loading-indicator'; // Reuse video loading styles
  indicator.innerHTML = `
    <div class="loading-spinner"></div>
    <span class="loading-text">${chrome.i18n.getMessage('loadingAudio') || 'Loading audio'}</span>
  `;

  const contentContainer = document.getElementById('content-container');
  if (contentContainer) {
    contentContainer.appendChild(indicator);
  }
}

/**
 * Hide audio loading indicator
 */
export function hideAudioLoadingIndicator() {
  const indicator = document.querySelector('.audio-loading-indicator');
  if (indicator) {
    indicator.remove();
  }
}

// ===== Media Play/Pause Indicators (for audio mode) =====

/**
 * Show brief audio play indicator (waveform icon for audio mode)
 */
export function showMediaPlayIndicator() {
  // Clear any existing timeout
  if (mediaPlayIndicatorTimeout) {
    clearTimeout(mediaPlayIndicatorTimeout);
    mediaPlayIndicatorTimeout = null;
  }

  // Remove any existing indicators
  const existingPlayIndicator = document.querySelector('.video-play-indicator');
  if (existingPlayIndicator) existingPlayIndicator.remove();
  const existingPauseIndicator = document.querySelector('.video-pause-indicator');
  if (existingPauseIndicator) existingPauseIndicator.remove();

  // Use waveform icon to represent audio playing
  const indicator = document.createElement('div');
  indicator.className = 'video-play-indicator';
  indicator.innerHTML = `
    <div class="play-icon-container">
      <img src="images/svg/waveform.svg" alt="${chrome.i18n.getMessage('audioPlayingAlt') || 'Audio Playing'}" width="56" height="56">
    </div>
  `;

  const contentContainer = document.getElementById('content-container');
  if (contentContainer) {
    contentContainer.appendChild(indicator);
  }

  // Remove after animation completes (400ms)
  mediaPlayIndicatorTimeout = setTimeout(() => {
    mediaPlayIndicatorTimeout = null;
    const playIndicator = document.querySelector('.video-play-indicator');
    if (playIndicator) playIndicator.remove();
  }, 400);
}

/**
 * Show brief audio pause indicator (pause icon for audio mode)
 */
export function showMediaPauseIndicator() {
  // Clear any existing timeout
  if (mediaPauseIndicatorTimeout) {
    clearTimeout(mediaPauseIndicatorTimeout);
    mediaPauseIndicatorTimeout = null;
  }

  // Remove any existing indicators
  const existingPlayIndicator = document.querySelector('.video-play-indicator');
  if (existingPlayIndicator) existingPlayIndicator.remove();
  const existingPauseIndicator = document.querySelector('.video-pause-indicator');
  if (existingPauseIndicator) existingPauseIndicator.remove();

  // Use pause icon for audio paused
  const indicator = document.createElement('div');
  indicator.className = 'video-pause-indicator';
  indicator.innerHTML = `
    <div class="pause-icon-container">
      <img src="images/svg/pause.svg" alt="${chrome.i18n.getMessage('audioPausedAlt') || 'Audio Paused'}" width="56" height="56">
    </div>
  `;

  const contentContainer = document.getElementById('content-container');
  if (contentContainer) {
    contentContainer.appendChild(indicator);
  }

  // Remove after animation completes (400ms)
  mediaPauseIndicatorTimeout = setTimeout(() => {
    mediaPauseIndicatorTimeout = null;
    const pauseIndicator = document.querySelector('.video-pause-indicator');
    if (pauseIndicator) pauseIndicator.remove();
  }, 400);
}

// ===== Toast Notifications =====

/**
 * Show a toast notification message
 * @param {string} message - Message to display
 * @param {string} type - Type: 'info' (default), 'success', or 'error'
 */
export function showToast(message, type = 'info') {
  // Remove existing toast if present
  const existingToast = document.querySelector('.toast-notification');
  if (existingToast) {
    existingToast.remove();
  }

  // Create new toast
  const toast = document.createElement('div');
  toast.className = `toast-notification toast-${type}`;
  toast.textContent = message;

  // Add to document
  document.body.appendChild(toast);

  // Show toast with animation after a brief delay
  setTimeout(() => {
    toast.classList.add('show');
  }, 50);

  // Hide and remove toast after 3 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 300);
  }, 3000);
}
