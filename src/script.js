import './styles.css';
import CONFIG from './config.js';

let isMuted = false;
let audio;
let isPlaying = false;
let shouldShowReviewPrompt = false;

// Helper function for logging messages (only in development)
function log(message) {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[BirdTab]: ${message}`);
  }
}

// Array of loading messages for a more engaging user experience
const loadingMessages = [
  "Fluffing feathers...",
  "Tuning bird calls...",
  "Scanning the skies...",
  "Peeking into nests...",
  "Filling bird feeders...",
  "Polishing binoculars...",
  "Preening tail feathers...",
  "Warming up chirps...",
  "Adjusting wing spans...",
  "Cleaning bird baths...",
  "Preparing migration routes...",
  "Sorting seeds and berries...",
  "Practicing flight patterns...",
  "Dusting off field guides...",
  "Setting up bird houses...",
  "Sharpening beaks...",
];

// Get a random loading message
const getRandomLoadingMessage = () => loadingMessages[Math.floor(Math.random() * loadingMessages.length)];

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

const updatePlayButton = () => {
  const playButton = document.getElementById('play-button');
  if (playButton) {
    playButton.innerHTML = isPlaying ?
      '<img src="images/svg/pause.svg" alt="Pause" width="24" height="24">' :
      '<img src="images/svg/play.svg" alt="Play" width="24" height="24">';
  }
};

// Create audio player for bird calls
function createAudioPlayer(mediaUrl, recordist, recordistUrl, autoPlay) {
  log(`Creating audio player with URL: ${mediaUrl}, auto-play: ${autoPlay}`);
  audio = new Audio(mediaUrl);
  // Skip the first 4 seconds of the audio
  // because it's usually recordist commentary
  audio.currentTime = 4;
  audio.muted = isMuted;

  const togglePlay = () => {
    if (isPlaying) {
      pauseAudio();
    } else {
      playAudio();
    }
  };

  const playAudio = () => {
    audio.play();
    isPlaying = true;
    updatePlayButton();
    audio.volume = 0;
    let fadeAudioIn = setInterval(function () {
      if (audio.volume < 0.9) {
        audio.volume += 0.1;
      } else {
        clearInterval(fadeAudioIn);
      }
    }, 200);
  };

  const pauseAudio = () => {
    audio.pause();
    isPlaying = false;
    updatePlayButton();
  };

  const playButton = document.createElement('button');
  playButton.id = 'play-button';
  playButton.classList.add('icon-button', 'play-button');
  playButton.innerHTML = '<img src="images/svg/play.svg" alt="Play" width="16" height="16">';
  playButton.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    togglePlay();
  });

  audio.oncanplaythrough = () => {
    if (autoPlay) {
      playAudio();
    }
  };

  audio.onended = () => {
    isPlaying = false;
    updatePlayButton();
  };

  return playButton;
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
        <h2>Enjoying BirdTab?</h2>
        <p>Your review would mean the world to us and help other bird enthusiasts discover our extension!</p>
        <div class="review-buttons">
          <button id="leave-review" class="review-btn primary">Leave a Review</button>
          <button id="maybe-later" class="review-btn secondary">Maybe Later</button>
          <button id="no-thanks" class="review-btn tertiary">No, Thanks</button>
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
async function updatePage() {
  incrementNewTabCount();
  await checkAndPrepareReviewPrompt();
  log('Updating page');
  showLoadingIndicator();
  const loadingInterval = setInterval(updateLoadingMessage, 2000);

  try {
    const birdInfo = await getBirdInfo();

    // add artificial delay of about 4 seconds to simulate a slow loading experience
    // await new Promise(resolve => setTimeout(resolve, 4000));
    
    // force an error to test error handling
    // throw new Error('Simulated error');

    clearInterval(loadingInterval);
    hideLoadingIndicator();
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
          <span class="credit-item">
            <img src="images/svg/waveform.svg" alt="Audio" width="16" height="16">
            <a id="recordist" href="${birdInfo.recordistUrl}" target="_blank">${birdInfo.recordist}</a>
          </span>
          <span class="credit-item">
            via <a href="https://www.macaulaylibrary.org/" target="_blank">Macaulay Library</a>
          </span>
        </p>
      </div>
      <div class="control-buttons">
        <button id="refresh-button" class="icon-button">
          <img src="images/svg/refresh.svg" alt="Refresh" width="24" height="24">
        </button>
        <button id="mute-button" class="icon-button">
          <img src="images/svg/sound-off.svg" alt="Mute" width="24" height="24">
        </button>
      </div>
    `;

    setImageSource(birdInfo.imageUrl);

    if (birdInfo.mediaUrl) {
      log(`Audio URL found: ${birdInfo.mediaUrl}`);
      const audioPlayer = createAudioPlayer(birdInfo.mediaUrl, birdInfo.recordist, birdInfo.recordistUrl, birdInfo.autoPlay);
      document.querySelector('.control-buttons').appendChild(audioPlayer);
    } else {
      log('No audio URL found in bird info');
    }

    document.getElementById('bird-name').textContent = birdInfo.name;
    document.getElementById('scientific-name').textContent = "(" + birdInfo.scientificName + ")";
    document.getElementById('photographer').textContent = birdInfo.photographer;

    document.getElementById('refresh-button').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.location.reload();
    });

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
    // After updating the page content, add the review prompt if needed
    if (shouldShowReviewPrompt) {
      document.body.insertAdjacentHTML('beforeend', getReviewPromptHTML());
      addReviewPromptListeners();
    }

    setupExternalLinks();

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
  errorDetails.textContent = `Error details: ${errorMessage}`;
  errorModal.classList.remove('hidden');
  
  const retryButton = document.getElementById('retry-button');
  // Remove existing event listeners to prevent multiple bindings
  retryButton.removeEventListener('click', retryHandler);
  retryButton.addEventListener('click', retryHandler);
}

function retryHandler() {
  const errorModal = document.getElementById('error-modal');
  errorModal.classList.add('hidden');
  updatePage();
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

// Add this function to handle messages from the background script
function handleBackgroundMessages(request, sender, sendResponse) {
  if (request.action === "pauseAudio" && audio && !audio.paused) {
    audio.pause();
    isPlaying = false;
    updatePlayButton();
  }
}

// Add this line to start listening for messages
chrome.runtime.onMessage.addListener(handleBackgroundMessages);

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "refreshBird") {
    location.reload();
  } else if (request.action === "toggleMute") {
    isMuted = !isMuted;
    updateMuteButton();
    if (audio) audio.muted = isMuted;
    saveMuteState();
  }
});

// Initialize page when DOM content is loaded
document.addEventListener('DOMContentLoaded', () => {
  log('DOM content loaded, starting page update');
  updatePage();
  document.body.classList.add('loaded');
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

log('Main script loaded');