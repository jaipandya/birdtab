import { CONFIG } from './config.js';
import { initSentry, captureException, captureMessage, addBreadcrumb } from './sentry.js';
import { log } from './logger.js';

// Initialize Sentry for background script
initSentry('background');

log('Background script starting...');
addBreadcrumb('Background script started', 'lifecycle', 'info');

let preloadedBirdInfo = null;
let preloadInProgress = false; // Prevents concurrent preload operations
let lastNewTabId = null;
let serviceWorkerStartTime = Date.now();

// Detect if user is on a slow connection
function isSlowConnection() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!connection) {
    // Connection API not available, assume good connection
    return false;
  }

  // Check for slow connection types or data saver mode
  const slowTypes = ['slow-2g', '2g'];
  const isSlowType = slowTypes.includes(connection.effectiveType);
  const isSaveData = connection.saveData === true;

  if (isSlowType || isSaveData) {
    log(`Slow connection detected: effectiveType=${connection.effectiveType}, saveData=${connection.saveData}`);
    return true;
  }

  return false;
}

// Track service worker lifecycle for debugging
log(`Service worker started at: ${new Date(serviceWorkerStartTime).toISOString()}`);

// Add error handler for unhandled promise rejections
self.addEventListener('unhandledrejection', (event) => {
  log(`Unhandled promise rejection: ${event.reason}`);
  captureException(event.reason, {
    tags: { type: 'unhandledRejection' }
  });
});

/**
 * Check if the preloaded bird matches the requested mode and can be used
 */
function canUsePreloadedBird(preloadedBird, requestedVideoMode) {
  if (!preloadedBird) {
    return false;
  }

  // If video mode requested, preloaded bird must have video
  if (requestedVideoMode && !preloadedBird.videoUrl) {
    return false;
  }

  // If image mode requested, preloaded bird must be image mode (not video)
  if (!requestedVideoMode && preloadedBird.videoMode) {
    return false;
  }

  return true;
}

// new async delay function to simulate a slow loading experience
async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch image information from Macaulay Library
// Prefers landscape orientation images for better display in new tab
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

  // Fetch multiple images to find a landscape one (width > height)
  // Using count=5 for balance between finding landscape images and payload size
  const url = `https://search.macaulaylibrary.org/api/v1/search?taxonCode=${speciesCode}&count=5&sort=rating_rank_desc&mediaType=photo`;
  const data = await fetchJson(url);

  if (data.results?.content?.length > 0) {
    // Prefer landscape images (width > height) for better new tab display
    const landscapeImage = data.results.content.find(img => 
      img.mediaUrl && img.width && img.height && img.width > img.height
    );
    
    // Fall back to first image with mediaUrl if no landscape found
    const image = landscapeImage || data.results.content.find(img => img.mediaUrl);
    
    if (!image) {
      const error = new Error('No image found in Macaulay Library');
      error.responseData = { hasResults: true, hasMediaUrl: false };
      throw error;
    }

    if (landscapeImage) {
      log(`[LANDSCAPE IMAGE]: Found landscape image for ${speciesCode}`);
    } else {
      log(`[PORTRAIT FALLBACK]: No landscape image found for ${speciesCode}, using first available`);
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

// Fetch video information from Macaulay Library
async function getMacaulayVideo(speciesCode) {
  const cacheKey = `video_${speciesCode}`;
  const cachedData = await getCachedData(cacheKey);
  if (cachedData) return cachedData;

  const url = `https://search.macaulaylibrary.org/api/v1/search?taxonCode=${speciesCode}&count=1&sort=rating_rank_desc&mediaType=video`;
  const data = await fetchJson(url);

  if (data.results?.content?.[0]) {
    const video = data.results.content[0];
    if (!video.mediaUrl) {
      // Video has results but no mediaUrl
      return null;
    }
    const videoInfo = {
      videoUrl: video.mediaUrl,
      videographer: video.userDisplayName,
      videographerUrl: `https://macaulaylibrary.org/asset/${video.assetId}`
    };
    await cacheData(cacheKey, videoInfo, CONFIG.CACHE_DURATION.BIRD_INFO);
    return videoInfo;
  }

  // Video not found - this is OK, video is optional
  return null;
}

// Helper function to fetch and parse JSON from a URL
// Includes retry logic for 5xx server errors (transient issues)
async function fetchJson(url, timeoutMs = 25000, maxRetries = 1) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Use AbortController to implement timeout (25 seconds default)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = new Error(`HTTP error! status: ${response.status}`);
        error.isHttpError = true;
        error.statusCode = response.status;
        error.isServerError = response.status >= 500 && response.status < 600;
        throw error;
      }
      return response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;

      // Retry on 5xx server errors (transient issues on external APIs)
      if (error.isServerError && attempt < maxRetries) {
        log(`Server error (${error.statusCode}), retrying... (attempt ${attempt + 1}/${maxRetries})`);
        // Brief delay before retry (500ms)
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }

      // Distinguish between network errors (Failed to fetch) and HTTP errors
      if (error.isHttpError) {
        throw error; // Re-throw HTTP errors as-is
      }

      // Handle network errors (Failed to fetch, timeouts, etc.)
      let networkError;
      if (error.name === 'AbortError') {
        // AbortError means fetch was cancelled due to timeout
        networkError = new Error(`Request timed out after ${timeoutMs}ms`);
        networkError.isNetworkError = true;
        networkError.isTimeout = true;
      } else {
        // Other network errors (Failed to fetch, DNS failures, etc.)
        networkError = new Error(error.message || 'Network request failed');
        networkError.isNetworkError = true;
        networkError.originalError = error.name;
      }

      // Retry network errors if user is online (transient network glitches)
      // Don't retry if offline - it's pointless and wastes resources
      if (attempt < maxRetries && navigator.onLine) {
        log(`Network error, retrying... (attempt ${attempt + 1}/${maxRetries})`);
        // Longer delay for network errors (1.5s) to allow connectivity to recover
        await new Promise(resolve => setTimeout(resolve, 1500));
        continue;
      }

      throw networkError;
    }
  }

  // If we've exhausted retries, throw the last error
  throw lastError;
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

// Get count of cached birds across all regions (for Sentry impact assessment)
async function getCachedBirdCount() {
  return new Promise(resolve => {
    chrome.storage.local.get(null, items => {
      let totalBirds = 0;
      Object.keys(items).forEach(key => {
        if (key.startsWith('birds_') && items[key]?.value?.length) {
          totalBirds += items[key].value.length;
        }
      });
      resolve(totalBirds);
    });
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

      // Get cached video if available
      const videoData = items[`video_${speciesCode}`];
      const videoInfo = videoData?.value || null;

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
        videoUrl: videoInfo?.videoUrl,
        videographer: videoInfo?.videographer,
        videographerUrl: videoInfo?.videographerUrl,
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

    // Distinguish between network errors (user issue) and API errors (our issue)
    if (error.isNetworkError) {
      // Network connectivity issue - log as warning
      // Include cached bird count for impact assessment and online status for debugging
      const cachedBirdCount = await getCachedBirdCount();
      captureMessage('Network error fetching birds from API', 'warning', {
        tags: {
          operation: 'getBirdsByRegion',
          errorType: 'network'
        },
        extra: {
          region,
          errorMessage: error.message,
          cachedBirdCount
        }
      });
    } else {
      // API errors, data errors, or other issues - log as error
      captureException(error, {
        tags: { operation: 'getBirdsByRegion' },
        extra: {
          region,
          statusCode: error.statusCode // Include HTTP status if available
        }
      });
    }

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
async function fetchBirdInfo(region, videoMode = false) {
  log(`Fetching bird info for region: ${region}, videoMode: ${videoMode}`);
  const startTime = Date.now();
  addBreadcrumb(`Fetching bird info for region: ${region}, videoMode: ${videoMode}`, 'http', 'info');

  try {
    const birds = await getBirdsByRegion(region);
    const bird = birds[Math.floor(Math.random() * birds.length)];
    log(`Bird found: ${bird.primaryComName}`);

    let imageInfo, audioInfo, videoInfo;
    try {
      // Always fetch image
      // Only fetch audio when NOT in video mode (video has its own audio)
      // Only fetch video when in video mode (for performance)
      const fetchPromises = [getMacaulayImage(bird.speciesCode)];

      if (!videoMode) {
        // In image mode: fetch audio
        fetchPromises.push(
          getMacaulayAudio(bird.speciesCode).catch(error => {
            log(`[AUDIO ERROR]: ${error.message} for species ${bird.speciesCode} in region ${region}`);
            return null;
          })
        );
        fetchPromises.push(Promise.resolve(null)); // placeholder for video
      } else {
        // In video mode: fetch video, skip audio
        fetchPromises.push(Promise.resolve(null)); // placeholder for audio
        fetchPromises.push(
          getMacaulayVideo(bird.speciesCode).catch(error => {
            log(`[VIDEO ERROR]: ${error.message} for species ${bird.speciesCode} in region ${region}`);
            return null;
          })
        );
      }

      [imageInfo, audioInfo, videoInfo] = await Promise.all(fetchPromises);

      // Log media availability for debugging
      if (videoMode) {
        if (!videoInfo) {
          log(`[VIDEO UNAVAILABLE]: species ${bird.speciesCode} in region ${region} - will fall back to image`);
        } else {
          log(`[VIDEO AVAILABLE]: species ${bird.speciesCode} in region ${region}`);
        }
      } else {
        if (!audioInfo) {
          log(`[AUDIO UNAVAILABLE]: species ${bird.speciesCode} in region ${region}`);
        }
      }
    } catch (error) {
      // Image fetch failed - try to use a previously cached complete bird
      log(`Error fetching image: ${error.message}`);

      // Report network errors and 5xx server errors as warnings (not our bug)
      // - Network errors: user's network issue
      // - 5xx errors: transient issues on Macaulay Library's servers
      // Report data errors (4xx, missing images) as errors (issues we might fix)
      if (error.isNetworkError || error.message?.includes('Failed to fetch') || error.isServerError) {
        const errorType = error.isServerError ? 'serverError' : 'network';
        const cachedBirdCount = await getCachedBirdCount();
        captureMessage(`${errorType === 'serverError' ? 'Server' : 'Network'} error fetching bird image`, 'warning', {
          tags: {
            operation: 'getMacaulayImage',
            component: 'background',
            errorType,
            statusCode: error.statusCode || 'unknown'
          },
          extra: {
            speciesCode: bird.speciesCode,
            region,
            errorMessage: error.message,
            cachedBirdCount
          }
        });
      } else {
        // Data errors (missing images, 4xx client errors) - report as errors
        captureException(error, {
          tags: { operation: 'getMacaulayImage', component: 'background' },
          extra: {
            speciesCode: bird.speciesCode,
            region,
            responseData: error.responseData,
            statusCode: error.statusCode
          }
        });
      }
      
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
      speciesCode: bird.speciesCode,
      location: region, // We don't have specific location data anymore
      ebirdUrl: `https://ebird.org/species/${bird.speciesCode}`,
      imageUrl: imageInfo.imageUrl,
      photographer: imageInfo.photographer,
      photographerUrl: imageInfo.photographerUrl,
      mediaUrl: audioInfo?.mediaUrl,
      recordist: audioInfo?.recordist,
      recordistUrl: audioInfo?.recordistUrl,
      videoUrl: videoInfo?.videoUrl,
      videographer: videoInfo?.videographer,
      videographerUrl: videoInfo?.videographerUrl,
      videoMode: videoMode && !!videoInfo, // Only true if video mode enabled AND video is available
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
      speciesCode: birdInfo.speciesCode,
      ebirdUrl: birdInfo.ebirdUrl
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
async function preloadNextBird(region, videoMode = false) {
  try {
    preloadedBirdInfo = await fetchBirdInfo(region, videoMode);
    log('Bird info fetched successfully for preloading');

    // Preload image and audio/video based on mode
    const preloadPromises = [
      fetch(preloadedBirdInfo.imageUrl, { mode: 'no-cors' })
        .then(() => log('Image preloaded successfully'))
        .catch(error => log(`Error preloading image: ${error.message}`))
    ];

    if (videoMode && preloadedBirdInfo.videoUrl) {
      preloadPromises.push(
        fetch(preloadedBirdInfo.videoUrl, { mode: 'no-cors' })
          .then(() => log('Video preloaded successfully'))
          .catch(error => log(`Error preloading video: ${error.message}`))
      );
    } else if (preloadedBirdInfo.mediaUrl) {
      preloadPromises.push(
        fetch(preloadedBirdInfo.mediaUrl, { mode: 'no-cors' })
          .then(() => log('Audio preloaded successfully'))
          .catch(error => log(`Error preloading audio: ${error.message}`))
      );
    }

    await Promise.all(preloadPromises);

    log('Next bird preloaded');
  } catch (error) {
    log(`Error preloading next bird: ${error.message}`);

    // Network and 5xx server errors during preload are expected - log as info
    // Preload is an optimization, not critical functionality
    // - Network errors: user offline, etc.
    // - 5xx errors: transient issues on Macaulay Library's servers
    if (error.isNetworkError || error.message?.includes('Failed to fetch') || error.isServerError) {
      const errorType = error.isServerError ? 'serverError' : 'network';
      const cachedBirdCount = await getCachedBirdCount();
      captureMessage(`${errorType === 'serverError' ? 'Server' : 'Network'} error during bird preload`, 'info', {
        tags: {
          operation: 'preloadNextBird',
          errorType,
          statusCode: error.statusCode || 'unknown'
        },
        extra: {
          region,
          errorMessage: error.message,
          cachedBirdCount
        }
      });
    } else {
      // Non-network/non-server errors (data issues, bugs) should still be reported as errors
      captureException(error, {
        tags: { operation: 'preloadNextBird' },
        extra: { region, statusCode: error.statusCode }
      });
    }
  }
}

// Clear cache
function clearCache() {
  chrome.storage.local.get(null, items => {
    const keysToRemove = Object.keys(items).filter(key =>
      key.startsWith('image_') || key.startsWith('audio_') || key.startsWith('video_') || key.startsWith('birds_')
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

    // Use IIFE pattern to handle async operations properly
    (async () => {
      try {
        // Get settings from storage
        const result = await chrome.storage.sync.get(['region', 'autoPlay', 'videoMode']);
        const region = result.region || 'US';
        const autoPlay = result.autoPlay || false;
        let videoMode = result.videoMode || false;

        // Silent fallback: skip video on slow connections
        const slowConnection = isSlowConnection();
        const videoDisabledDueToSlowConnection = videoMode && slowConnection;
        if (videoDisabledDueToSlowConnection) {
          log('Slow connection detected, silently falling back to image mode');
          videoMode = false; // Don't change user's setting, just skip video for this request
        }

        log(`Using region: ${region}, auto-play: ${autoPlay}, video-mode: ${videoMode}, slow-connection: ${slowConnection}`);

        // Fetch or retrieve preloaded bird info
        let birdInfo;

        if (canUsePreloadedBird(preloadedBirdInfo, videoMode)) {
          // Use preloaded bird and consume it atomically
          birdInfo = preloadedBirdInfo;
          preloadedBirdInfo = null;
          log('Using preloaded bird info');
        } else {
          // Can't use preload - fetch fresh
          if (preloadedBirdInfo) {
            log('Preloaded bird mode mismatch, fetching fresh');
            preloadedBirdInfo = null; // Free the unusable preload from memory
          }
          birdInfo = await fetchBirdInfo(region, videoMode);
        }

        birdInfo.autoPlay = autoPlay;

        // Add slow connection flag to response
        if (videoDisabledDueToSlowConnection) {
          birdInfo.videoDisabledDueToSlowConnection = true;
        }

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

        // Preload next bird in background only if not already in progress
        if (!preloadInProgress) {
          preloadInProgress = true;
          preloadNextBird(region, videoMode)
            .catch(error => log(`Preload failed: ${error.message}`))
            .finally(() => {
              preloadInProgress = false;
            });
        }
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
  } else if (namespace === 'sync' && changes.videoMode) {
    // Video mode changed - clear preload so next tab fetches with correct mode
    log(`Video mode changed to ${changes.videoMode.newValue}, clearing preload`);
    preloadedBirdInfo = null;
  }

  if (namespace === 'sync' && changes.quietHours) {
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
chrome.storage.sync.get(['region', 'videoMode'], result => {
  const region = result.region || 'US';
  const videoMode = result.videoMode || false;
  preloadNextBird(region, videoMode);
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