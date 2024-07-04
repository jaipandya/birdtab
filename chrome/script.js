function log(message) {
  if (!('update_url' in chrome.runtime.getManifest())) {
    console.log(`[Bird of the Day]: ${message}`);
  }
}

const loadingMessages = [
  "Fluffing feathers...",
  "Tuning bird calls...",
  "Scanning the skies...",
  "Peeking into nests...",
  "Filling bird feeders...",
  "Polishing binoculars...",
];

function getRandomLoadingMessage() {
  return loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
}

function setLoadingState() {
  log('Setting loading state');
  document.body.innerHTML = `
    <div class="loading">
      <h1>Bird of the Day</h1>
      <p id="loading-message">${getRandomLoadingMessage()}</p>
    </div>
  `;
}

function updateLoadingMessage() {
  const loadingMessage = document.getElementById('loading-message');
  if (loadingMessage) {
    loadingMessage.textContent = getRandomLoadingMessage();
    log(`Updated loading message: ${loadingMessage.textContent}`);
  }
}

async function getBirdInfo() {
  log(`Requesting bird info`);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Request timed out'));
    }, 30000); // 30 seconds timeout

    chrome.runtime.sendMessage({ action: 'getBirdInfo' }, response => {
      clearTimeout(timeout);
      if (response.error) {
        log(`Error getting bird info: ${response.error}`);
        reject(new Error(response.error));
      } else {
        log(`Bird info received: ${JSON.stringify(response)}`);
        resolve(response);
      }
    });
  });
}

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

function generateLocationDescription(birdName, location) {
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

function createAudioPlayer(audioUrl, recordist, recordistUrl, autoPlay) {
  log(`Creating audio player with URL: ${audioUrl}, auto-play: ${autoPlay}`);
  const audio = new Audio(audioUrl);
  let isPlaying = false;

  const togglePlay = () => {
      if (isPlaying) {
          audio.pause();
      } else {
          audio.play();
      }
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

async function updatePage() {
  log('Updating page');
  setLoadingState();
  const loadingInterval = setInterval(updateLoadingMessage, 2000);

  try {
    const birdInfo = await getBirdInfo();

    clearInterval(loadingInterval);
    log('Bird info received, updating page content');

    document.body.innerHTML = `
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
          ${birdInfo.imageSource === 'unsplash' ? 'on Unsplash' : 'via Macaulay Library'} | 
          Info: <a href="https://ebird.org" target="_blank">eBird</a>
        </p>
      </div>
    `;

    if (birdInfo.audioUrl) {
      log(`Audio URL found: ${birdInfo.audioUrl}`);
      const audioPlayer = createAudioPlayer(birdInfo.audioUrl, birdInfo.recordist, birdInfo.recordistUrl, birdInfo.autoPlay);
      document.body.appendChild(audioPlayer);
    } else {
      log('No audio URL found in bird info');
    }

    document.getElementById('bird-name').textContent = birdInfo.name;
    document.getElementById('scientific-name').textContent = birdInfo.scientificName;
    document.getElementById('description').textContent = generateLocationDescription(birdInfo.name, birdInfo.location);
    document.getElementById('fun-fact').textContent = generateFunFact(birdInfo.name);
    document.getElementById('photographer').textContent = birdInfo.photographer;

    log('Page updated successfully');
  } catch (error) {
    clearInterval(loadingInterval);
    console.error('Error updating page:', error);
    log(`Error updating page: ${error.message}`);
    document.body.innerHTML = `
      <div class="error">
        <h1>Oops! Our birds flew the coop!</h1>
        <p>Seems like our feathered friends are camera shy today. Try again later!</p>
        <p class="error-details">${error.message}</p>
      </div>
    `;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  log('DOM content loaded, starting page update');
  updatePage();
});

log('Main script loaded');