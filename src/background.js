import { CONFIG } from './config.js';
import { initSentry, captureException, captureMessage, addBreadcrumb } from './sentry.js';
import { log } from './logger.js';

// Initialize Sentry for background script
initSentry('background');

log('Background script starting...');
addBreadcrumb('Background script started', 'lifecycle', 'info');

let preloadedBirdInfo = null;
let lastNewTabId = null;
let serviceWorkerStartTime = Date.now();

// Track service worker lifecycle for debugging
log(`Service worker started at: ${new Date(serviceWorkerStartTime).toISOString()}`);

// Add error handler for unhandled promise rejections
self.addEventListener('unhandledrejection', (event) => {
  log(`Unhandled promise rejection: ${event.reason}`);
  captureException(event.reason, {
    tags: { type: 'unhandledRejection' }
  });
});

// Keepalive mechanism: Use chrome.alarms to prevent service worker from being terminated
// This creates a minimal alarm that fires periodically to keep the worker alive during critical operations
let keepAliveInterval = null;

function startKeepAlive() {
  if (!keepAliveInterval) {
    // Ping every 20 seconds to keep service worker alive (Chrome terminates after ~30s of inactivity)
    keepAliveInterval = setInterval(() => {
      log('Keepalive ping');
    }, 20000);
    log('Keepalive started');
  }
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
    log('Keepalive stopped');
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
    if (!image.mediaUrl) {
      const error = new Error('No image found in Macaulay Library');
      error.responseData = { hasResults: true, hasMediaUrl: false };
      throw error;
    }

    const imageInfo = {
      imageUrl: image.mediaUrl,
      photographer: image.userDisplayName,
      photographerUrl: `https://macaulaylibrary.org/asset/${image.assetId}`
    };
    await cacheData(cacheKey, imageInfo, CONFIG.CACHE_DURATION.BIRD_INFO);
    return imageInfo;
  }

  // No results found in API response
  const error = new Error('No image found in Macaulay Library');
  error.responseData = {
    hasResults: false,
    resultCount: data.results?.content?.length || 0,
    totalResults: data.results?.total || 0
  };
  throw error;
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
    if (!audio.mediaUrl) {
      // Audio has results but no mediaUrl
      return null;
    }
    const audioInfo = {
      mediaUrl: audio.mediaUrl,
      recordist: audio.userDisplayName,
      recordistUrl: `https://macaulaylibrary.org/asset/${audio.assetId}`
    };
    await cacheData(cacheKey, audioInfo, CONFIG.CACHE_DURATION.BIRD_INFO);
    return audioInfo;
  }

  // Audio not found - this is OK, audio is optional
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

// Get a random cached complete bird info as fallback when network fails
// Uses existing cache keys (image_*, audio_*, birds_*) for backward compatibility
async function getRandomCachedBirdInfo() {
  return new Promise(resolve => {
    chrome.storage.local.get(null, async items => {
      // Find all cached images
      const imageKeys = Object.keys(items).filter(key => key.startsWith('image_'));
      if (imageKeys.length === 0) {
        resolve(null);
        return;
      }

      // Pick a random cached image
      const randomImageKey = imageKeys[Math.floor(Math.random() * imageKeys.length)];
      const imageData = items[randomImageKey];
      if (!imageData?.value) {
        resolve(null);
        return;
      }

      // Extract speciesCode from key (image_SPECIESCODE)
      const speciesCode = randomImageKey.replace('image_', '');
      log(`Found cached image for species: ${speciesCode}`);

      // Find the bird data from any cached region
      const birdsKeys = Object.keys(items).filter(key => key.startsWith('birds_'));
      let bird = null;
      for (const birdsKey of birdsKeys) {
        const birdsData = items[birdsKey];
        if (birdsData?.value) {
          bird = birdsData.value.find(b => b.speciesCode === speciesCode);
          if (bird) break;
        }
      }

      if (!bird) {
        log(`No bird data found for species: ${speciesCode}`);
        resolve(null);
        return;
      }

      // Get cached audio if available
      const audioData = items[`audio_${speciesCode}`];
      const audioInfo = audioData?.value || null;

      // Reconstruct complete bird info from cached data
      const birdInfo = {
        name: bird.primaryComName,
        scientificName: bird.scientificName,
        location: 'Cached', // We don't know the original region
        ebirdUrl: `https://ebird.org/species/${bird.speciesCode}`,
        imageUrl: imageData.value.imageUrl,
        photographer: imageData.value.photographer,
        photographerUrl: imageData.value.photographerUrl,
        mediaUrl: audioInfo?.mediaUrl,
        recordist: audioInfo?.recordist,
        recordistUrl: audioInfo?.recordistUrl,
        description: bird.description,
        conservationStatus: bird.conservationStatus,
        primaryComName_fr: bird.primaryComName_fr,
        primaryComName_cn: bird.primaryComName_cn
      };

      log(`Reconstructed cached bird info: ${birdInfo.name}`);
      resolve(birdInfo);
    });
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
    captureException(error, {
      tags: { operation: 'getBirdsByRegion' },
      extra: { region } // Removed URL to avoid exposing API endpoints
    });

    const cachedData = await getCachedData(cacheKey);
    if (cachedData) {
      log(`Using cached birds due to error: ${error.message}`);
      addBreadcrumb(`Using cached birds for region ${region}`, 'fallback', 'warning');
      return cachedData;
    }
    throw error;
  }
}

// Update fetchBirdInfo function
// Note: Uses breadcrumbs instead of transactions to reduce Sentry span usage
// (1000+ daily users × new tabs = lots of potential spans)
async function fetchBirdInfo(region) {
  log(`Fetching bird info for region: ${region}`);
  const startTime = Date.now();
  addBreadcrumb(`Fetching bird info for region: ${region}`, 'http', 'info');

  try {
    const birds = await getBirdsByRegion(region);
    const bird = birds[Math.floor(Math.random() * birds.length)];
    log(`Bird found: ${bird.primaryComName}`);

    let imageInfo, audioInfo;
    try {
      [imageInfo, audioInfo] = await Promise.all([
        getMacaulayImage(bird.speciesCode),
        getMacaulayAudio(bird.speciesCode).catch(error => {
          log(`[AUDIO ERROR]: ${error.message} for species ${bird.speciesCode} in region ${region}`);
          // Audio is optional, don't throw - just return null
          return null;
        })
      ]);

      // Track audio unavailability in Sentry for data quality analysis
      if (!audioInfo) {
        log(`[AUDIO UNAVAILABLE]: species ${bird.speciesCode} in region ${region}`);
        captureMessage('Audio unavailable for bird species', 'info', {
          tags: {
            operation: 'getMacaulayAudio',
            component: 'background',
            mediaType: 'audio'
          },
          extra: {
            speciesCode: bird.speciesCode,
            region
          }
        });
      }
    } catch (error) {
      // Image fetch failed - try to use a previously cached complete bird
      log(`Error fetching image: ${error.message}`);
      captureException(error, {
        tags: { operation: 'getMacaulayImage', component: 'background' },
        extra: {
          speciesCode: bird.speciesCode,
          region,
          responseData: error.responseData
        }
      });
      
      const cachedBirdInfo = await getRandomCachedBirdInfo();
      if (cachedBirdInfo) {
        addBreadcrumb('Using cached bird info as fallback', 'fallback', 'warning');
        log(`Falling back to cached bird: ${cachedBirdInfo.name}`);
        return cachedBirdInfo;
      }
      
      // No cached bird available - throw error to trigger network error UI
      log('No cached bird available, throwing network error');
      throw new Error('NETWORK_ERROR_NO_CACHE');
    }

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
      conservationStatus: bird.conservationStatus,
      primaryComName_fr: bird.primaryComName_fr,
      primaryComName_cn: bird.primaryComName_cn
    };

    log(`Bird info compiled: ${JSON.stringify(birdInfo)}`);

    // Track successful fetch via breadcrumb (lightweight, no span cost)
    const duration = Date.now() - startTime;
    addBreadcrumb('Bird info fetched successfully', 'http', 'info', {
      duration,
      region,
      birdName: birdInfo.name
    });

    return birdInfo;
  } catch (error) {
    log(`Error in fetchBirdInfo: ${error.message}`);
    const duration = Date.now() - startTime;

    addBreadcrumb('Bird info fetch failed', 'http', 'error', { duration, region });
    
    // Try to use a cached bird as fallback before giving up
    const cachedBirdInfo = await getRandomCachedBirdInfo();
    if (cachedBirdInfo) {
      addBreadcrumb('Using cached bird info as fallback after fetch error', 'fallback', 'warning');
      log(`Falling back to cached bird: ${cachedBirdInfo.name}`);
      return cachedBirdInfo;
    }
    
    captureException(error, {
      tags: { operation: 'fetchBirdInfo' },
      extra: { region, duration }
    });
    
    // No cached bird available - throw specific error
    throw new Error('NETWORK_ERROR_NO_CACHE');
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
    captureException(error, {
      tags: { operation: 'preloadNextBird' },
      extra: { region }
    });
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
    log(`Received request for bird info from tab ${sender.tab?.id || 'unknown'}`);

    // Start keepalive to prevent service worker termination during fetch
    startKeepAlive();

    // Use IIFE pattern to handle async operations properly
    (async () => {
      try {
        // Get settings from storage
        const result = await chrome.storage.sync.get(['region', 'autoPlay']);
        const region = result.region || 'US';
        const autoPlay = result.autoPlay || false;
        log(`Using region: ${region}, auto-play: ${autoPlay}`);

        // Fetch or retrieve preloaded bird info
        let birdInfo = preloadedBirdInfo || await fetchBirdInfo(region);
        preloadedBirdInfo = null;
        birdInfo.autoPlay = autoPlay;

        log(`Sending bird info response: ${birdInfo.name}`);

        // Check if the message port is still open before sending response
        try {
          sendResponse(birdInfo);
        } catch (responseError) {
          log(`Failed to send response: ${responseError.message}`);
          captureException(responseError, {
            tags: { operation: 'sendResponse', source: 'messageListener' },
            extra: { birdName: birdInfo?.name }
          });
        }

        // Preload next bird in background (don't await)
        preloadNextBird(region);
      } catch (error) {
        log(`Error in getBirdInfo handler: ${error.message}`);
        captureException(error, {
          tags: { operation: 'getBirdInfo', source: 'messageListener' },
          extra: {
            tabId: sender.tab?.id,
            url: sender.url
          }
        });

        try {
          sendResponse({ error: error.message });
        } catch (responseError) {
          log(`Failed to send error response: ${responseError.message}`);
        }
      } finally {
        // Stop keepalive after operation completes
        stopKeepAlive();
      }
    })();

    return true;  // Keep message channel open for async response
  } else if (request.action === 'deleteCache') {
    clearCache();
    preloadedBirdInfo = null;
    sendResponse({ message: 'Cache deleted' });
    return true;
  } else if (request.action === 'getBirdsByRegion') {
    (async () => {
      try {
        const birds = await getBirdsByRegion(request.region);
        sendResponse({ success: true, birds: birds });
      } catch (error) {
        captureException(error, {
          tags: { operation: 'getBirdsByRegion', source: 'messageListener' },
          extra: { region: request.region }
        });
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // Indicates that the response is asynchronous
  }
});

// Storage change listener
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.region) {
    log(`Region changed, clearing cache`);
    clearCache();
    preloadedBirdInfo = null;
  } else if (namespace === 'sync' && changes.quietHours) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs && tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: "quietHoursChanged",
          quietHoursEnabled: changes.quietHours.newValue
        }, () => {
          // Consume the response to prevent "message port closed" error
          if (chrome.runtime.lastError) {
            log(`Error sending quietHoursChanged: ${chrome.runtime.lastError.message}`);
          }
        });
      }
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

    // Set the uninstall URL
    chrome.runtime.setUninstallURL('https://tally.so/r/wzZyDR', () => {
      if (chrome.runtime.lastError) {
        log('Error setting uninstall URL: ' + chrome.runtime.lastError.message);
      } else {
        log('Uninstall URL set successfully');
      }
    });
  }
});

log('Background script loaded');