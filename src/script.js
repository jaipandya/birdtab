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
let isPlaying = false;
let shouldShowReviewPrompt = false;
let birdInfo;
let quizMode;
let saveVolumeTimeout = null;



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
async function getBirdInfo() {
  log(`Requesting bird info`);
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      addBreadcrumb('Bird info request timed out', 'http', 'error');
      reject(new Error('Request timed out'));
    }, 30000);

    chrome.runtime.sendMessage({ action: 'getBirdInfo' }, response => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;

      // Check for message delivery failure
      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message || 'Message delivery failed';
        log(`Error sending message: ${errorMsg}`);
        addBreadcrumb(`Message error: ${errorMsg}`, 'http', 'error', { duration });
        reject(new Error(errorMsg));
        return;
      }

      // Check if response is undefined (background script unavailable)
      if (!response) {
        log('No response from background script');
        addBreadcrumb('No response from background script', 'http', 'error', { duration });
        reject(new Error('No response from background script'));
        return;
      }

      if (response.error) {
        log(`Error getting bird info: ${response.error}`);
        addBreadcrumb(`Bird info error: ${response.error}`, 'http', 'error', { duration });
        reject(new Error(response.error));
      } else {
        addBreadcrumb('Bird info received', 'http', 'info', {
          duration,
          birdName: response.name,
          region: response.location
        });
        resolve(response);
      }
    });
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

// Initialize audio based on auto-play settings
async function initializeAudio() {
  const isQuietHour = await isQuietHoursActive();
  const shouldAutoPlay = await getAutoPlayState();

  if (isQuietHour) {
    hideAudioControls();
    showQuietHoursIcon();
  } else {
    if (birdInfo && birdInfo.mediaUrl) {
      showAudioControls();
      if (shouldAutoPlay) {
        await playAudio();
      } else {
        loadAudioWithoutPlaying();
      }
    }
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

// Create audio player for bird calls
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
    console.error('Error playing audio:', error);
    captureException(error, {
      tags: { operation: 'playAudio' },
      extra: {
        mediaUrl: birdInfo?.mediaUrl,
        currentTime: audio?.currentTime,
        volume: audio?.volume,
        muted: audio?.muted
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

// Main function to update the page with new bird information
async function initializePage() {
  incrementNewTabCount();
  await checkAndPrepareReviewPrompt();
  log('Updating page');
  showLoadingIndicator();
  const loadingInterval = setInterval(updateLoadingMessage, 2000);

  try {
    birdInfo = await getBirdInfo();

    // add artificial delay of about 4 seconds to simulate a slow loading experience
    // await new Promise(resolve => setTimeout(resolve, 4000));


    clearInterval(loadingInterval);
    hideLoadingIndicator();

    // add a class to the body to trigger the fade-in animation
    document.body.classList.add('loaded');

    log('Bird info received, updating page content');

    const contentContainer = document.getElementById('content-container');
    contentContainer.innerHTML = `
      <a href="${birdInfo.ebirdUrl}" target="_blank" class="bird-link">
        <img src="" alt="${birdInfo.name}" class="background-image" decoding="async">
      </a>
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
          <h1 id="bird-name"></h1>
          <span id="scientific-name"></span>
          <span class="info-icon" data-tooltip="${birdInfo.description}&#10;&#10;Conservation Status: ${birdInfo.conservationStatus}">
            <img src="images/svg/info.svg" alt="${chrome.i18n.getMessage('infoAlt')}" width="16" height="16">
          </span>
        </div>
        <p class="credits">
          <span class="credit-item">
            <img src="images/svg/camera.svg" alt="${chrome.i18n.getMessage('cameraAlt')}" width="16" height="16">
            <a id="photographer" href="${birdInfo.photographerUrl}" target="_blank">${birdInfo.photographer}</a>
          </span>
          ${birdInfo.mediaUrl ? `
          <span class="credit-item">
            <img src="images/svg/waveform.svg" alt="${chrome.i18n.getMessage('audioAlt')}" width="16" height="16">
            <a id="recordist" href="${birdInfo.recordistUrl}" target="_blank">${birdInfo.recordist}</a>
          </span>
          ` : ''}
          <span class="credit-item">
            via <a href="https://www.macaulaylibrary.org/" target="_blank">Macaulay Library</a>
          </span>
        </p>
      </div>
      <div class="control-buttons">
        <button id="settings-button" class="icon-button" aria-label="${chrome.i18n.getMessage('openSettings')}" title="${chrome.i18n.getMessage('settingsTooltip')}">
          <img src="images/svg/settings.svg" alt="${chrome.i18n.getMessage('settingsAlt')}" width="24" height="24">
        </button>
        <button id="quiz-button" class="icon-button" aria-label="${chrome.i18n.getMessage('startQuiz')}" title="${chrome.i18n.getMessage('quizTooltip')}">
          <img src="images/svg/quiz.svg" alt="${chrome.i18n.getMessage('quizAlt')}" width="24" height="24">
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
    `;

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


    const lang = chrome.i18n.getUILanguage();
    let nameToDisplay = birdInfo.name;

    if (lang && birdInfo.primaryComName_fr && lang.toLowerCase().startsWith('fr')) {
      nameToDisplay = birdInfo.primaryComName_fr;
    } else if (lang && birdInfo.primaryComName_cn && lang.toLowerCase().startsWith('zh')) {
      nameToDisplay = birdInfo.primaryComName_cn;
    }

    document.getElementById('bird-name').textContent = nameToDisplay;
    document.getElementById('scientific-name').textContent = "(" + birdInfo.scientificName + ")";
    document.getElementById('photographer').textContent = birdInfo.photographer;

    document.getElementById('refresh-button').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.location.reload();
    });

    document.getElementById('quiz-button').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (quizMode && !quizMode.isActive) {
        quizMode.startQuiz();
      }
    });

    // After updating the page content, add the review prompt if needed
    if (shouldShowReviewPrompt) {
      document.body.insertAdjacentHTML('beforeend', getReviewPromptHTML());
      addReviewPromptListeners();
    }

    setupExternalLinks();
    await initializeAudio();

    // Initialize settings modal after DOM elements are available
    requestAnimationFrame(() => {
      try {
        new SettingsModal();
      } catch (error) {
        console.error('Failed to initialize settings modal:', error);
        captureException(error, {
          tags: { operation: 'initializeSettingsModal' }
        });
      }
    });

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
  const errorModal = document.getElementById('error-modal');
  const errorDetails = errorModal.querySelector('.error-details');
  errorDetails.textContent = `${chrome.i18n.getMessage('errorDetails')}: ${errorMessage}`;
  errorModal.classList.remove('hidden');

  const retryButton = document.getElementById('retry-button');
  // Remove existing event listeners to prevent multiple bindings
  retryButton.removeEventListener('click', retryHandler);
  retryButton.addEventListener('click', retryHandler);
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

  // Update audio volume
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
      }
    }
  } else if (request.action === "pauseAudio" && audio && !audio.paused) {
    pauseAudio();
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