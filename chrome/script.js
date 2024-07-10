let isMuted = false;
let audio;

// Helper function for logging messages (only in development)
function log(message) {
  if (!('update_url' in chrome.runtime.getManifest())) {
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

// Create audio player for bird calls
function createAudioPlayer(mediaUrl, recordist, recordistUrl, autoPlay) {
  log(`Creating audio player with URL: ${mediaUrl}, auto-play: ${autoPlay}`);
  audio = new Audio(mediaUrl);
  audio.muted = isMuted;
  let isPlaying = false;

  const togglePlay = () => {
    isPlaying ? audio.pause() : audio.play();
    isPlaying = !isPlaying;
    updatePlayButton();
  };

  const updatePlayButton = () => {
    const playButton = document.getElementById('play-button');
    if (playButton) {
      playButton.innerHTML = isPlaying ?
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>' :
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
    }
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
      audio.play();
      isPlaying = true;
      updatePlayButton();
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

// Main function to update the page with new bird information
async function updatePage() {
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
        <img src="${birdInfo.imageUrl}" alt="${birdInfo.name}" class="background-image">
      </a>
      <div class="info-panel">
        <h1 id="bird-name"></h1>
        <h2 id="scientific-name"></h2>
        <p id="description"></p>
        <p id="fun-fact"></p>
        <p class="credits">
          Photo: <a id="photographer" href="${birdInfo.photographerUrl}" target="_blank"></a> 
          via Macaulay Library | 
          Info: <a href="https://ebird.org" target="_blank">eBird</a>
        </p>
      </div>
    `;

    if (birdInfo.mediaUrl) {
      log(`Audio URL found: ${birdInfo.mediaUrl}`);
      const audioPlayer = createAudioPlayer(birdInfo.mediaUrl, birdInfo.recordist, birdInfo.recordistUrl, birdInfo.autoPlay);
      document.body.appendChild(audioPlayer);
    } else {
      log('No audio URL found in bird info');
    }

    document.getElementById('bird-name').textContent = birdInfo.name;
    document.getElementById('scientific-name').textContent = birdInfo.scientificName;
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