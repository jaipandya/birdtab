import './styles.css';
import CONFIG from './config.js';
import { getAutoPlayState } from './quietHours.js';
import { isQuietHoursActive } from './quietHours.js';
import SettingsModal from './settingsModal.js';
import TopSites from './topSites.js';
import { localizeHtml } from './i18n.js';

let isMuted = false;
let audio;
let isPlaying = false;
let shouldShowReviewPrompt = false;
let birdInfo;

// Helper function for logging messages (only in development)
function log(message) {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[BirdTab]: ${message}`);
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
async function getBirdInfo() {
  log(`Requesting bird info`);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Request timed out')), 30000);

    chrome.runtime.sendMessage({ action: 'getBirdInfo' }, response => {
      clearTimeout(timeout);
      if (response.error) {
        log(`Error getting bird info: ${response.error}`);
        reject(new Error(response.error));
      } else {
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
  const muteButton = document.getElementById('mute-button');
  if (playButton) playButton.style.display = 'none';
  if (muteButton) muteButton.style.display = 'none';
}

function showAudioControls() {
  const playButton = document.getElementById('play-button');
  const muteButton = document.getElementById('mute-button');
  if (playButton) playButton.style.display = 'inline-flex';
  if (muteButton) muteButton.style.display = 'inline-flex';
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
  audio.load();
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

  const playButton = document.createElement('button');
  playButton.id = 'play-button';
  playButton.classList.add('icon-button', 'play-button');
  playButton.innerHTML = `<img src="images/svg/play.svg" alt="${chrome.i18n.getMessage('playAlt')}" width="16" height="16">`;
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
  }
  try {
    await audio.play();
    isPlaying = true;
    updatePlayPauseButton();
    audio.volume = 0;
    let fadeAudioIn = setInterval(function () {
      if (audio.volume < 0.9) {
        audio.volume += 0.1;
      } else {
        clearInterval(fadeAudioIn);
      }
    }, 200);
  } catch (error) {
    console.error('Error playing audio:', error);
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
    
    // force an error to test error handling
    // throw new Error('Simulated error');

    clearInterval(loadingInterval);
    hideLoadingIndicator();

    // add a class to the body to trigger the fade-in animation
    document.body.classList.add('loaded');

    log('Bird info received, updating page content');

    const contentContainer = document.getElementById('content-container');
    contentContainer.innerHTML = `
      <a href="${birdInfo.ebirdUrl}" target="_blank" class="bird-link">
        <img src="" alt="${birdInfo.name}" class="background-image">
      </a>
      <div class="info-panel">
        <div class="external-links">
          <a href="https://www.bing.com/search?q=${encodeURIComponent(birdInfo.name)}" target="_blank" class="external-link bing-link">
            <img src="images/svg/bing-default.svg" alt="Bing Search" width="24" height="24">
          </a>
          <a href="${birdInfo.ebirdUrl}" target="_blank" class="external-link ebird-link">
            <img src="images/svg/ebird-default.svg" alt="eBird Page" width="24" height="24">
          </a>
        </div>
        <div class="info-panel-header">
          <h1 id="bird-name"></h1>
          <span id="scientific-name"></span>
          <span class="info-icon" data-tooltip="${birdInfo.description}&#10;&#10;Conservation Status: ${birdInfo.conservationStatus}">
            <img src="images/svg/info.svg" alt="Info" width="16" height="16">
          </span>
        </div>
        <p class="credits">
          <span class="credit-item">
            <img src="images/svg/camera.svg" alt="Camera" width="16" height="16">
            <a id="photographer" href="${birdInfo.photographerUrl}" target="_blank">${birdInfo.photographer}</a>
          </span>
          ${birdInfo.mediaUrl ? `
          <span class="credit-item">
            <img src="images/svg/waveform.svg" alt="Audio" width="16" height="16">
            <a id="recordist" href="${birdInfo.recordistUrl}" target="_blank">${birdInfo.recordist}</a>
          </span>
          ` : ''}
          <span class="credit-item">
            via <a href="https://www.macaulaylibrary.org/" target="_blank">Macaulay Library</a>
          </span>
        </p>
      </div>
      <div class="control-buttons">
        <button id="settings-button" class="icon-button" aria-label="Open settings">
          <img src="images/svg/settings.svg" alt="Settings" width="24" height="24">
        </button>
        <button id="refresh-button" class="icon-button">
          <img src="images/svg/refresh.svg" alt="Refresh" width="24" height="24">
        </button>
        ${birdInfo.mediaUrl ? `
        <button id="mute-button" class="icon-button">
          <img src="images/svg/sound-off.svg" alt="Mute" width="24" height="24">
        </button>
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

      chrome.storage.sync.get(['isMuted'], (result) => {
        isMuted = result.isMuted || false;
        updateMuteButton();
        if (audio) audio.muted = isMuted;
      });

      document.getElementById('mute-button').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        isMuted = !isMuted;
        updateMuteButton();
        if (audio) audio.muted = isMuted;
        saveMuteState();
      });

      updateMuteButton();
    } else {
      log('No audio URL found in bird info');
      hideAudioControls();
    }

    document.getElementById('bird-name').textContent = birdInfo.name;
    document.getElementById('scientific-name').textContent = "(" + birdInfo.scientificName + ")";
    document.getElementById('photographer').textContent = birdInfo.photographer;

    document.getElementById('refresh-button').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.location.reload();
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
      }
    });

    log('Page updated successfully');
  } catch (error) {
    clearInterval(loadingInterval);
    hideLoadingIndicator();
    console.error('Error updating page:', error);
    log(`Error updating page: ${error.message}`);
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

// Update mute button UI
function updateMuteButton() {
  const muteButton = document.getElementById('mute-button');
  if (muteButton) {
    muteButton.innerHTML = isMuted ?
      `<img src="images/svg/sound-off.svg" alt="Mute" width="24" height="24">` :
      `<img src="images/svg/sound-on.svg" alt="Mute" width="24" height="24">`;
  }
}

// Save mute state to chrome storage
function saveMuteState() {
  chrome.storage.sync.set({ isMuted }, () => {
    log(`Mute state saved: ${isMuted}`);
  });
}

// Combined message listener to handle all background messages
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  if (request.action === "refreshBird") {
    location.reload();
  } else if (request.action === "toggleMute") {
    isMuted = !isMuted;
    updateMuteButton();
    if (audio) audio.muted = isMuted;
    saveMuteState();
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
  // Add keyboard shortcut to focus search (Ctrl/Cmd + K)
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      searchInput.focus();
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
  // Localize the page immediately
  localizeHtml();
  
  log('DOM content loaded, checking onboarding status');
  
  // Check if onboarding is complete first
  const shouldContinue = await checkOnboardingStatus();
  if (!shouldContinue) {
    log('Redirecting to onboarding');
    return;
  }
  
  log('Onboarding complete, initializing UI components first');
  
  // Initialize search box and top sites immediately for better UX
  initializeSearch();
  
  // Initialize top sites
  try {
    window.topSitesInstance = new TopSites();
    await window.topSitesInstance.initialize();
  } catch (error) {
    console.error('Failed to initialize top sites:', error);
  }
  
  // Start page update after UI elements are initialized
  log('Starting page update');
  await initializePage();
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
        }
      }
    }
  }
});