console.log('Background script starting...');

const PROXY_SERVER_URL = 'https://birdtab-proxy.vercel.app/api';

let lastFetchDate = null;

function log(message) {
  if (!('update_url' in chrome.runtime.getManifest())) {
    console.log(`[BirdTab]: ${message}`);
  }
}

async function getMacaulayImage(speciesCode) {
  log(`Fetching Macaulay image for species code ${speciesCode}`);
  const response = await fetch(`${PROXY_SERVER_URL}/bird-image?speciesCode=${speciesCode}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const data = await response.json();
  if (data.imageUrl) {
    log(`Macaulay image found for species code ${speciesCode}`);
    return {
      imageUrl: data.imageUrl,
      photographer: data.photographer,
      photographerUrl: data.photographerUrl
    };
  }
  log(`No Macaulay image found for species code ${speciesCode}`);
  throw new Error('No image found in Macaulay Library');
}

async function getMacaulayAudio(speciesCode) {
  log(`Fetching Macaulay audio for species code ${speciesCode}`);
  const response = await fetch(`${PROXY_SERVER_URL}/bird-audio?speciesCode=${speciesCode}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const data = await response.json();
  if (data.audioUrl) {
    log(`Macaulay audio found for species code ${speciesCode}`);
    return {
      audioUrl: data.audioUrl,
      recordist: data.recordist,
      recordistUrl: data.recordistUrl
    };
  }
  log(`No Macaulay audio found for species code ${speciesCode}`);
  return null;
}

async function fetchBirdInfo(region) {
  log(`Fetching bird info for region: ${region}`);

  try {
    log(`Sending request to proxy server: ${PROXY_SERVER_URL}/recent-observations?region=${region}`);
    const response = await fetch(`${PROXY_SERVER_URL}/recent-observations?region=${region}`);
    log(`Received response from proxy server. Status: ${response.status}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    log(`Parsed proxy server response: ${JSON.stringify(data)}`);

    if (data.observations && data.observations.length > 0) {
      // Randomly select one bird from the fetched observations
      const bird = data.observations[Math.floor(Math.random() * data.observations.length)];
      log(`Bird found: ${bird.comName}`);

      try {
        const imageInfo = await getMacaulayImage(bird.speciesCode);
        const audioInfo = await getMacaulayAudio(bird.speciesCode);

        // Construct location string from available information
        const locationParts = [bird.locName, bird.subnational1Name, bird.countryName].filter(Boolean);
        const locationString = locationParts.join(', ');

        const birdInfo = {
          name: bird.comName,
          scientificName: bird.sciName,
          location: locationString,
          ebirdUrl: `https://ebird.org/species/${bird.speciesCode}`,
          imageUrl: imageInfo.imageUrl,
          photographer: imageInfo.photographer,
          photographerUrl: imageInfo.photographerUrl,
          audioUrl: audioInfo ? audioInfo.audioUrl : null,
          recordist: audioInfo ? audioInfo.recordist : null,
          recordistUrl: audioInfo ? audioInfo.recordistUrl : null
        };

        log(`Bird info compiled: ${JSON.stringify(birdInfo)}`);
        return birdInfo;
      } catch (error) {
        log(`Error fetching image or audio: ${error.message}`);
        throw error;
      }
    } else {
      throw new Error('No bird sightings found for the given region');
    }
  } catch (error) {
    log(`Error in fetchBirdInfo: ${error.message}`);
    throw error;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getBirdInfo') {
    log(`Received request for bird info`);
    chrome.storage.sync.get(['region', 'autoPlay'], async function (result) {
      const region = result.region || 'US';
      const autoPlay = result.autoPlay || false;
      log(`Using region: ${region}, auto-play: ${autoPlay}`);
      try {
        const currentDate = new Date().toDateString();
        chrome.storage.local.get(['cachedBirdInfo', 'cacheDate'], async function (cache) {
          if (cache.cachedBirdInfo && cache.cacheDate === currentDate) {
            log(`Using cached bird info`);
            sendResponse({ ...cache.cachedBirdInfo, autoPlay });
          } else {
            log(`Fetching new bird info`);
            const birdInfo = await fetchBirdInfo(region);
            chrome.storage.local.set({
              cachedBirdInfo: birdInfo,
              cacheDate: currentDate
            }, function () {
              log(`New bird info cached`);
            });
            sendResponse({ ...birdInfo, autoPlay });
          }
        });
      } catch (error) {
        console.error('Error fetching bird info:', error);
        log(`Error: ${error.message}`);
        sendResponse({ error: error.message });
      }
    });
    return true;  // Indicates that the response is asynchronous
  } else if (request.action === 'deleteCache') {
    clearCache();
    sendResponse({ message: 'Cache deleted' });
    return true; // Indicates that the response is asynchronous
  }
});

function clearCache() {
  chrome.storage.local.remove(['cachedBirdInfo', 'cacheDate'], function () {
    log('Cache cleared');
  });
}


chrome.storage.onChanged.addListener(function (changes, namespace) {
  if (namespace === 'sync' && changes.region) {
    log(`Region changed, clearing cache`);
    chrome.storage.local.remove(['cachedBirdInfo', 'cacheDate'], function () {
      log('Cache cleared due to region change');
    });
  }
});

log('Background script loaded');
