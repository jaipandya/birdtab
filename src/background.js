import { CONFIG } from './config.js';

log('Background script starting...');

let preloadedBirdInfo = null;
let lastNewTabId = null;

// Helper function for logging messages (only in development)
function log(message) {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[BirdTab]: ${message}`);
  }
}

// new async delay function to simulate a slow loading experience
async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch image information from Macaulay Library
async function getMacaulayImage(speciesCode) {

  // simulate a slow loading experience
  // await delay(4000);

  const cacheKey = `image_${speciesCode}`;
  const cachedData = await getCachedData(cacheKey);
  if (cachedData) {
    log(`[CACHE HIT]: ${speciesCode}`);
    return cachedData;
  } else {
    log(`[CACHE MISS]: ${speciesCode}`);
  }

  const url = `https://search.macaulaylibrary.org/api/v1/search?taxonCode=${speciesCode}&count=1&sort=rating_rank_desc&mediaType=photo`;
  const data = await fetchJson(url);

  if (data.results?.content?.[0]) {
    const image = data.results.content[0];
    if (!image.mediaUrl) throw new Error('No image found in Macaulay Library');

    const imageInfo = {
      imageUrl: image.mediaUrl,
      photographer: image.userDisplayName,
      photographerUrl: `https://macaulaylibrary.org/asset/${image.assetId}`
    };
    await cacheData(cacheKey, imageInfo, CONFIG.CACHE_DURATION.BIRD_INFO);
    return imageInfo;
  }
  throw new Error('No image found in Macaulay Library');
}

// Fetch audio information from Macaulay Library
async function getMacaulayAudio(speciesCode) {
  
  // simulate a slow loading experience
  // await delay(4000);

  const cacheKey = `audio_${speciesCode}`;
  const cachedData = await getCachedData(cacheKey);
  if (cachedData) return cachedData;

  const url = `https://search.macaulaylibrary.org/api/v1/search?taxonCode=${speciesCode}&count=1&sort=rating_rank_desc&mediaType=audio`;
  const data = await fetchJson(url);

  if (data.results?.content?.[0]) {
    const audio = data.results.content[0];
    const audioInfo = {
      mediaUrl: audio.mediaUrl,
      recordist: audio.userDisplayName,
      recordistUrl: `https://macaulaylibrary.org/asset/${audio.assetId}`
    };
    await cacheData(cacheKey, audioInfo, CONFIG.CACHE_DURATION.BIRD_INFO);
    return audioInfo;
  }
  return null;
}

// Helper function to fetch and parse JSON from a URL
async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return response.json();
}

// Get cached data from chrome.storage.local
async function getCachedData(key) {
  return new Promise(resolve => {
    chrome.storage.local.get(key, result => {
      const data = result[key];
      if (data && Date.now() - data.timestamp < data.duration) {
        resolve(data.value);
      } else {
        resolve(null);
      }
    });
  });
}

// Cache data in chrome.storage.local
async function cacheData(key, value, duration) {
  return new Promise(resolve => {
    chrome.storage.local.set({
      [key]: { value, timestamp: Date.now(), duration }
    }, resolve);
  });
}

// Format location string
function formatLocation(locName, subnational1Name, countryName) {
  return [locName, subnational1Name, countryName].filter(Boolean).join(', ');
}

// Get birds by the specified region from redis
async function getBirdsByRegion(region) {
  const cacheKey = `birds_${region}`;
  const cachedData = await getCachedData(cacheKey);
  if (cachedData) {
    log(`[CACHE HIT]: ${region}`);
    return cachedData;
  } else {
    log(`[CACHE MISS]: ${region}`);
  }

  try {
    const url = `${CONFIG.API_SERVER_URL}/birds-by-region?region=${region}`;
    log(`Sending request to server: ${url}`);
    const data = await fetchJson(url);
    log(`Parsed server response: ${JSON.stringify(data)}`);

    if (data.birds?.length > 0) {
      await cacheData(cacheKey, data.birds, CONFIG.CACHE_DURATION.BIRDS_BY_REGION);
      return data.birds;
    }
    throw new Error('No birds found in the response');
  } catch (error) {
    log(`Error fetching birds: ${error.message}`);
    const cachedData = await getCachedData(cacheKey);
    if (cachedData) {
      log(`Using cached birds due to error: ${error.message}`);
      return cachedData;
    }
    throw error;
  }
}

// Update fetchBirdInfo function
async function fetchBirdInfo(region) {
  log(`Fetching bird info for region: ${region}`);

  try {
    const birds = await getBirdsByRegion(region);
    const bird = birds[Math.floor(Math.random() * birds.length)];
    log(`Bird found: ${bird.primaryComName}`);

    let imageInfo = await getMacaulayImage(bird.speciesCode).catch(error => {
      log(`Error fetching image: ${error.message}`);
      return {
        imageUrl: chrome.runtime.getURL('images/default-bird.jpg'),
        photographer: 'Unknown',
        photographerUrl: '#'
      };
    });

    let audioInfo = await getMacaulayAudio(bird.speciesCode).catch(error => {
      log(`Error fetching audio: ${error.message}`);
      return null;
    });

    const birdInfo = {
      name: bird.primaryComName,
      scientificName: bird.scientificName,
      location: region, // We don't have specific location data anymore
      ebirdUrl: `https://ebird.org/species/${bird.speciesCode}`,
      imageUrl: imageInfo.imageUrl,
      photographer: imageInfo.photographer,
      photographerUrl: imageInfo.photographerUrl,
      mediaUrl: audioInfo?.mediaUrl,
      recordist: audioInfo?.recordist,
      recordistUrl: audioInfo?.recordistUrl,
      description: bird.description,
      conservationStatus: bird.conservationStatus
    };

    log(`Bird info compiled: ${JSON.stringify(birdInfo)}`);
    return birdInfo;
  } catch (error) {
    log(`Error in fetchBirdInfo: ${error.message}`);
    throw error;
  }
}

// Preload next bird information
async function preloadNextBird(region) {
  try {
    preloadedBirdInfo = await fetchBirdInfo(region);
    log('Bird info fetched successfully for preloading');

    // Preload image and audio
    await Promise.all([
      fetch(preloadedBirdInfo.imageUrl, { mode: 'no-cors' })
        .then(() => log('Image preloaded successfully'))
        .catch(error => log(`Error preloading image: ${error.message}`)),
      preloadedBirdInfo.mediaUrl && fetch(preloadedBirdInfo.mediaUrl, { mode: 'no-cors' })
        .then(() => log('Audio preloaded successfully'))
        .catch(error => log(`Error preloading audio: ${error.message}`))
    ]);

    log('Next bird preloaded');
  } catch (error) {
    log(`Error preloading next bird: ${error.message}`);
  }
}

// Clear cache
function clearCache() {
  chrome.storage.local.get(null, items => {
    const keysToRemove = Object.keys(items).filter(key =>
      key.startsWith('image_') || key.startsWith('audio_') || key.startsWith('birds_')
    );
    chrome.storage.local.remove(keysToRemove, () => log('Relevant cache keys cleared'));
  });
}

// Modify this function to handle new tab creation
function handleNewTab(tab) {
  if (lastNewTabId && lastNewTabId !== tab.id) {
    chrome.tabs.sendMessage(lastNewTabId, { action: "pauseAudio" }, response => {
      if (chrome.runtime.lastError) {
        // Handle the error silently
        log(`Error sending message to tab ${lastNewTabId}: ${chrome.runtime.lastError.message}`);
      }
    });
  }
  lastNewTabId = tab.id;
}

// Add these listeners
chrome.tabs.onCreated.addListener(handleNewTab);

// We'll keep this listener to handle cases where the URL might change after creation
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url === 'chrome://newtab/') {
    handleNewTab(tab);
  }
});

// Message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getBirdInfo') {
    log(`Received request for bird info`);
    chrome.storage.sync.get(['region', 'autoPlay'], async result => {
      const region = result.region || 'US';
      const autoPlay = result.autoPlay || false;
      log(`Using region: ${region}, auto-play: ${autoPlay}`);
      try {
        let birdInfo = preloadedBirdInfo || await fetchBirdInfo(region);
        preloadedBirdInfo = null;
        birdInfo.autoPlay = autoPlay;
        sendResponse(birdInfo);
        preloadNextBird(region);
      } catch (error) {
        console.error('Error fetching bird info:', error);
        log(`Error: ${error.message}`);
        sendResponse({ error: error.message });
      }
    });
    return true;  // Indicates that the response is asynchronous
  } else if (request.action === 'deleteCache') {
    clearCache();
    preloadedBirdInfo = null;
    sendResponse({ message: 'Cache deleted' });
    return true;
  }
});

// Storage change listener
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.region) {
    log(`Region changed, clearing cache`);
    clearCache();
    preloadedBirdInfo = null;
  } else if (namespace === 'sync' && changes.quietHours) {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: "quietHoursChanged",
        quietHoursEnabled: changes.quietHours.newValue
      });
    });
  }
});

// Initial preload
chrome.storage.sync.get(['region'], result => {
  const region = result.region || 'US';
  preloadNextBird(region);
});

// Add this function to check if onboarding is necessary
function checkOnboarding() {
  chrome.storage.sync.get(['onboardingComplete'], function (result) {
    if (!result.onboardingComplete) {
      chrome.tabs.create({ url: 'onboarding.html' });
    }
  });
}

// Listen for installation or update events
chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason === 'install' || details.reason === 'update') {
    checkOnboarding();
  }
  
  // This helps in tracking the number of new tabs opened by the user
  // which is used in the review prompt
  if (details.reason === "install") {
    chrome.storage.local.set({
      installTime: Date.now(),
      newTabCount: 0
    });
  }
});



log('Background script loaded');