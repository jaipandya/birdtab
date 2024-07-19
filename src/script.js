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

// Generate a fun fact about the bird
function generateFunFact(birdName) {
  const funFacts = [
    `Did you know? If ${birdName}s could take selfies, they'd always get their best angle!`,
    `${birdName}s don't need GPS. They were into migration before it was cool.`,
    `If ${birdName}s had thumbs, they'd definitely be into bird-watching humans.`,
    `${birdName}s are nature's alarm clocks, except you can't hit snooze!`,
    `${birdName}s: Proving that dinosaurs didn't all go extinct, they just got adorable!`,
  ];
  const fact = funFacts[Math.floor(Math.random() * funFacts.length)];
  log(`Generated fun fact: ${fact}`);
  return fact;
}

// Generate a description of the bird's location
function generateLocationDescription(birdName, location) {
  location = location || "an undisclosed location";
  const descriptions = [
    `A ${birdName} was recently spotted in ${location}. Lucky birders!`,
    `Birders in ${location} were thrilled to see a ${birdName} in their area.`,
    `${location} just got a visit from a charming ${birdName}.`,
    `The skies of ${location} were graced by a ${birdName} not long ago.`,
    `A ${birdName} decided to make ${location} its runway for a bird fashion show.`,
  ];
  const description = descriptions[Math.floor(Math.random() * descriptions.length)];
  log(`Generated location description: ${description}`);
  return description;
}

const updatePlayButton = () => {
  const playButton = document.getElementById('play-button');
  if (playButton) {
    playButton.innerHTML = isPlaying ?
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>' :
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
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
  playButton.classList.add('play-button');
  playButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
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

  const audioCredit = document.createElement('p');
  audioCredit.classList.add('audio-credit');
  audioCredit.innerHTML = `Audio: <a href="${recordistUrl}" target="_blank">${recordist}</a> via Macaulay Library`;

  const audioContainer = document.createElement('div');
  audioContainer.classList.add('audio-container');
  audioContainer.appendChild(playButton);
  audioContainer.appendChild(audioCredit);

  return audioContainer;
}


// Review section

function incrementNewTabCount() {
  chrome.storage.local.get(['newTabCount', 'installTime'], function(result) {
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
    chrome.storage.local.get(['installTime', 'newTabCount', 'lastReviewPrompt', 'reviewDismissed', 'reviewLeft'], function(result) {
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


// Main function to update the page with new bird information
async function updatePage() {
  incrementNewTabCount();
  await checkAndPrepareReviewPrompt();
  log('Updating page');
  showLoadingIndicator();
  const loadingInterval = setInterval(updateLoadingMessage, 2000);

  try {
    const birdInfo = await getBirdInfo();

    clearInterval(loadingInterval);
    hideLoadingIndicator();
    log('Bird info received, updating page content');

    document.body.innerHTML = `
      <button id="refresh-button" class="icon-button">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 4v6h-6"></path>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
        </svg>
      </button>
      <button id="mute-button" class="icon-button">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
          <line x1="23" y1="9" x2="17" y2="15"></line>
          <line x1="17" y1="9" x2="23" y2="15"></line>
        </svg>
      </button>
      <a href="${birdInfo.ebirdUrl}" target="_blank" class="bird-link">
        <img src="" alt="${birdInfo.name}" class="background-image">
      </a>
      <div class="info-panel">
      <div class="info-panel-header">
      <h1 id="bird-name"></h1>
      <span id="scientific-name"></span>
      </div>
      <p id="description"></p>
      <p id="fun-fact"></p>
      <p class="credits">
      <svg class="camera-icon" width="16" height="16" viewBox="0 0 24 24" fill="none"
        xmlns="http://www.w3.org/2000/svg">
        <path
          d="M23 19C23 19.5304 22.7893 20.0391 22.4142 20.4142C22.0391 20.7893 21.5304 21 21 21H3C2.46957 21 1.96086 20.7893 1.58579 20.4142C1.21071 20.0391 1 19.5304 1 19V8C1 7.46957 1.21071 6.96086 1.58579 6.58579C1.96086 6.21071 2.46957 6 3 6H7L9 3H15L17 6H21C21.5304 6 22.0391 6.21071 22.4142 6.58579C22.7893 6.96086 23 7.46957 23 8V19Z"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <path
          d="M12 17C14.2091 17 16 15.2091 16 13C16 10.7909 14.2091 9 12 9C9.79086 9 8 10.7909 8 13C8 15.2091 9.79086 17 12 17Z"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <a id="photographer" href="${birdInfo.photographerUrl}" target="_blank"></a> 
          via
          <a href="https://www.macaulaylibrary.org/" target="_blank">Macaulay Library</a>
      </p>
      </div>
    `;

    // New function to set image source and show it when loaded
    function setImageSource(imageUrl) {
      const img = document.querySelector('.background-image');
      img.onload = function () {
        img.classList.remove('hidden');
      };
      img.src = imageUrl;
    }

    setImageSource(birdInfo.imageUrl);

    if (birdInfo.mediaUrl) {
      log(`Audio URL found: ${birdInfo.mediaUrl}`);
      const audioPlayer = createAudioPlayer(birdInfo.mediaUrl, birdInfo.recordist, birdInfo.recordistUrl, birdInfo.autoPlay);
      document.body.appendChild(audioPlayer);
    } else {
      log('No audio URL found in bird info');
    }

    document.getElementById('bird-name').textContent = birdInfo.name;
    document.getElementById('scientific-name').textContent = "(" + birdInfo.scientificName + ")";
    document.getElementById('description').textContent = generateLocationDescription(birdInfo.name, birdInfo.location);
    document.getElementById('fun-fact').textContent = generateFunFact(birdInfo.name);
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

    log('Page updated successfully');
  } catch (error) {
    clearInterval(loadingInterval);
    hideLoadingIndicator();
    console.error('Error updating page:', error);
    log(`Error updating page: ${error.message}`);
    document.body.innerHTML = `
      <div class="error">
        <h1>Oops! Something went wrong</h1>
        <p>We're having trouble fetching bird information. Please check your internet connection and try again.</p>
        <p class="error-details">${error.message}</p>
        <button id="retry-button">Retry</button>
      </div>
    `;
    document.getElementById('retry-button').addEventListener('click', updatePage);
  }
}

function addReviewPromptListeners() {
  document.getElementById('leave-review').addEventListener('click', () => {
    chrome.tabs.create({url: 'https://chromewebstore.google.com/detail/birdtab/dkdnidbnjihhilbjndnnlfipmbnoaipn'});
    chrome.storage.local.set({reviewLeft: true});
    dismissPrompt();
  });

  document.getElementById('maybe-later').addEventListener('click', () => {
    chrome.storage.local.set({lastReviewPrompt: Date.now()});
    dismissPrompt();
  });

  document.getElementById('no-thanks').addEventListener('click', () => {
    chrome.storage.local.set({reviewDismissed: true});
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
      `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <line x1="23" y1="9" x2="17" y2="15"></line>
        <line x1="17" y1="9" x2="23" y2="15"></line>
      </svg>` :
      `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
      </svg>`;
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
});


log('Main script loaded');