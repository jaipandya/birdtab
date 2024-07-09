importScripts('config.js');

console.log('Background script starting...');

let lastFetchDate = null;
let preloadedBirdInfo = null;

function log(message) {
  if (!('update_url' in chrome.runtime.getManifest())) {
    console.log(`[BirdTab]: ${message}`);
  }
}

async function getMacaulayImage(speciesCode) {
    const cacheKey = `image_${speciesCode}`;
    const cachedData = await getCachedData(cacheKey);
    if (cachedData) return cachedData;

    const url = `https://search.macaulaylibrary.org/api/v1/search?taxonCode=${speciesCode}&count=1&sort=rating_rank_desc&mediaType=photo`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.results && data.results.content && data.results.content.length > 0) {
        const image = data.results.content[0];
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

async function getMacaulayAudio(speciesCode) {
    const cacheKey = `audio_${speciesCode}`;
    const cachedData = await getCachedData(cacheKey);
    if (cachedData) return cachedData;

    const url = `https://search.macaulaylibrary.org/api/v1/search?taxonCode=${speciesCode}&count=1&sort=rating_rank_desc&mediaType=audio`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.results && data.results.content && data.results.content.length > 0) {
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

async function getRecentObservations(region) {
    const cacheKey = `observations_${region}`;
    try {
        const cachedData = await getCachedData(cacheKey);
        if (cachedData) {
            log(`Using cached observations for region: ${region}`);
            return cachedData;
        }

        log(`Sending request to proxy server: ${CONFIG.PROXY_SERVER_URL}/recent-observations?region=${region}`);
        const response = await fetch(`${CONFIG.PROXY_SERVER_URL}/recent-observations?region=${region}`);
        log(`Received response from proxy server. Status: ${response.status}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        log(`Parsed proxy server response: ${JSON.stringify(data)}`);

        if (data.observations && data.observations.length > 0) {
            await cacheData(cacheKey, data.observations, CONFIG.CACHE_DURATION.RECENT_OBSERVATIONS);
            return data.observations;
        } else {
            throw new Error('No observations found in the response');
        }
    } catch (error) {
        log(`Error fetching recent observations: ${error.message}`);
        // If there's an error (including network error), try to use cached data
        const cachedData = await getCachedData(cacheKey);
        if (cachedData) {
            log(`Using cached observations due to error: ${error.message}`);
            return cachedData;
        }
        throw error;
    }
}

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

async function cacheData(key, value, duration) {
    return new Promise(resolve => {
        chrome.storage.local.set({
            [key]: {
                value: value,
                timestamp: Date.now(),
                duration: duration
            }
        }, resolve);
    });
}

function formatLocation(locName, subnational1Name, countryName) {
    return [locName, subnational1Name, countryName].filter(Boolean).join(', ');
}

async function fetchBirdInfo(region) {
    log(`Fetching bird info for region: ${region}`);
    
    try {
        const observations = await getRecentObservations(region);
        
        // Randomly select one bird from the fetched observations
        const bird = observations[Math.floor(Math.random() * observations.length)];
        log(`Bird found: ${bird.comName}`);
        
        let imageInfo;
        let audioInfo;
        
        try {
            imageInfo = await getMacaulayImage(bird.speciesCode);
        } catch (error) {
            log(`Error fetching image: ${error.message}`);
            imageInfo = { imageUrl: 'path_to_default_image.jpg', photographer: 'Unknown', photographerUrl: '#' };
        }

        try {
            audioInfo = await getMacaulayAudio(bird.speciesCode);
        } catch (error) {
            log(`Error fetching audio: ${error.message}`);
            audioInfo = null;
        }
        
        const birdInfo = {
            name: bird.comName,
            scientificName: bird.sciName,
            location: formatLocation(bird.locName, bird.subnational1Name, bird.countryName),
            ebirdUrl: `https://ebird.org/species/${bird.speciesCode}`,
            imageUrl: imageInfo.imageUrl,
            photographer: imageInfo.photographer,
            photographerUrl: imageInfo.photographerUrl,
            mediaUrl: audioInfo ? audioInfo.mediaUrl : null,
            recordist: audioInfo ? audioInfo.recordist : null,
            recordistUrl: audioInfo ? audioInfo.recordistUrl : null
        };

        log(`Bird info compiled: ${JSON.stringify(birdInfo)}`);
        return birdInfo;
    } catch (error) {
        log(`Error in fetchBirdInfo: ${error.message}`);
        throw error;
    }
}

async function preloadNextBird(region) {
    try {
        const birdInfo = await fetchBirdInfo(region);
        preloadedBirdInfo = birdInfo;
        // Preload the image
        await fetch(birdInfo.imageUrl, { mode: 'no-cors' });
        // Preload the audio if available
        if (birdInfo.mediaUrl) {
            await fetch(birdInfo.mediaUrl, { mode: 'no-cors' });
        }
        log('Next bird preloaded');
    } catch (error) {
        log(`Error preloading next bird: ${error.message}`);
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getBirdInfo') {
        log(`Received request for bird info`);
        chrome.storage.sync.get(['region', 'autoPlay'], async function(result) {
            const region = result.region || 'US';
            const autoPlay = result.autoPlay || false;
            log(`Using region: ${region}, auto-play: ${autoPlay}`);
            try {
                let birdInfo;
                if (preloadedBirdInfo) {
                    birdInfo = preloadedBirdInfo;
                    preloadedBirdInfo = null; // Clear the preloaded info
                    log('Using preloaded bird info');
                } else {
                    birdInfo = await fetchBirdInfo(region);
                    log('Fetched new bird info');
                }
                birdInfo.autoPlay = autoPlay;
                sendResponse(birdInfo);
                
                // Preload next bird
                preloadNextBird(region);
            } catch (error) {
                console.error('Error fetching bird info:', error);
                log(`Error: ${error.message}`);
                sendResponse({error: error.message});
            }
        });
        return true;  // Indicates that the response is asynchronous
    } else if (request.action === 'deleteCache') {
        clearCache();
        preloadedBirdInfo = null; // Clear preloaded info when cache is deleted
        sendResponse({message: 'Cache deleted'});
        return true;
    }
});

function clearCache() {
    chrome.storage.local.get(null, function(items) {
        const keysToRemove = Object.keys(items).filter(key => 
            key.startsWith('image_') || 
            key.startsWith('audio_') || 
            key.startsWith('observations_')
        );
        chrome.storage.local.remove(keysToRemove, function() {
            log('Relevant cache keys cleared');
        });
    });
}

chrome.commands.onCommand.addListener((command) => {
  if (command === "refresh-bird") {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, {action: "refreshBird"});
    });
  } else if (command === "toggle-mute") {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, {action: "toggleMute"});
    });
  }
});

chrome.storage.onChanged.addListener(function (changes, namespace) {
  if (namespace === 'sync' && changes.region) {
    log(`Region changed, clearing cache`);
    clearCache();
    preloadedBirdInfo = null; // Clear preloaded info when region changes
  }
});

// Initial preload
chrome.storage.sync.get(['region'], function(result) {
    const region = result.region || 'US';
    preloadNextBird(region);
});

log('Background script loaded');
