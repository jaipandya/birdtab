console.log('Background script starting...');

const UNSPLASH_ACCESS_KEY = 'mH0pX0bna9zgxESECadRUMSnrUPloNDaGN4rjEf5A9s';
const EBIRD_API_KEY = '40hmhkcjeb5r';

function log(message) {
  if (!('update_url' in chrome.runtime.getManifest())) {
    console.log(`[Bird of the Day]: ${message}`);
  }
}

function formatLocation(locName, subnational2Name, countryName) {
  const parts = [locName, subnational2Name, countryName].filter(Boolean);
  return parts.join(', ');
}

async function getUnsplashImage(birdName) {
  log(`Fetching Unsplash image for ${birdName}`);
  const response = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(birdName + " bird")}&per_page=1&client_id=${UNSPLASH_ACCESS_KEY}`);
  const data = await response.json();
  if (data.results && data.results.length > 0) {
    const image = data.results[0];
    console.log("image", image);
    log(`Unsplash image found for ${birdName}`);
    return {
      imageUrl: image.urls.full,
      photographer: image.user.name,
      photographerUrl: image.user.links.html
    };
  }
  log(`No Unsplash image found for ${birdName}`);
  throw new Error('No image found on Unsplash');
}

async function getMacaulayImage(speciesCode) {
  log(`Fetching Macaulay image for species code ${speciesCode}`);
  const response = await fetch(`https://search.macaulaylibrary.org/api/v1/search?taxonCode=${speciesCode}&count=1&sort=rating_rank_desc&mediaType=photo`);
  const data = await response.json();
  if (data.results && data.results.content && data.results.content.length > 0) {
    const image = data.results.content[0];
    log(`Macaulay image found for species code ${speciesCode}`);
    return {
      imageUrl: image.mediaUrl,
      photographer: image.userDisplayName,
      photographerUrl: `https://macaulaylibrary.org/asset/${image.assetId}`
    };
  }
  log(`No Macaulay image found for species code ${speciesCode}`);
  throw new Error('No image found in Macaulay Library');
}

async function fetchAndCacheImage(url) {
  log(`Fetching image from ${url}`);
  const response = await fetch(url, { mode: 'no-cors' });
  log(`Image fetched successfully`);
  return url; // Return the URL directly instead of creating a blob
}

async function getCachedBirdInfo() {
  log(`Checking for cached bird info`);
  return new Promise((resolve) => {
    chrome.storage.local.get(['cachedBirdInfo', 'cacheDate'], function (result) {
      if (result.cachedBirdInfo && result.cacheDate) {
        const today = new Date().toDateString();
        if (result.cacheDate === today) {
          log(`Found valid cached bird info`);
          resolve(result.cachedBirdInfo);
        } else {
          log(`Cached bird info expired`);
          resolve(null);
        }
      } else {
        log(`No cached bird info found`);
        resolve(null);
      }
    });
  });
}

async function cacheBirdInfo(birdInfo) {
  log(`Caching bird info`);
  const today = new Date().toDateString();
  chrome.storage.local.set({
    cachedBirdInfo: birdInfo,
    cacheDate: today
  }, function () {
    log(`Bird info cached successfully`);
  });
}

async function getMacaulayAudio(speciesCode) {
  log(`Fetching Macaulay audio for species code ${speciesCode}`);
  const response = await fetch(`https://search.macaulaylibrary.org/api/v1/search?taxonCode=${speciesCode}&count=1&sort=rating_rank_desc&mediaType=audio`);
  const data = await response.json();
  if (data.results && data.results.content && data.results.content.length > 0) {
    const audio = data.results.content[0];
    log(`Macaulay audio found for species code ${speciesCode}`);
    log(`Audio info: ${JSON.stringify(audio)}`);
    return {
      audioUrl: audio.mediaUrl,
      recordist: audio.userDisplayName,
      recordistUrl: `https://macaulaylibrary.org/asset/${audio.assetId}`
    };
  }
  log(`No Macaulay audio found for species code ${speciesCode}`);
  return null;
}

async function fetchBirdInfo(lat, lng, imageSource) {
  log(`Fetching bird info for lat: ${lat}, lng: ${lng}, source: ${imageSource}`);
  const url = `https://api.ebird.org/v2/data/obs/geo/recent?lat=${lat}&lng=${lng}&maxResults=1&back=30&dist=50`;
  try {
    log(`Sending request to eBird API: ${url}`);
    const response = await fetch(url, {
      headers: {
        'X-eBirdApiToken': EBIRD_API_KEY
      }
    });
    log(`Received response from eBird API. Status: ${response.status}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    log(`Parsed eBird API response: ${JSON.stringify(data)}`);

    if (data.length > 0) {
      const bird = data[0];
      log(`Bird found: ${bird.comName}`);
      let imageInfo;
      let audioInfo;
      
      try {
        // Always fetch audio, regardless of image source
        audioInfo = await getMacaulayAudio(bird.speciesCode);
        log(`Audio info received: ${JSON.stringify(audioInfo)}`);

        if (imageSource === 'unsplash') {
          imageInfo = await getUnsplashImage(bird.comName);
        } else {
          imageInfo = await getMacaulayImage(bird.speciesCode);
        }
        
        const imageUrl = await fetchAndCacheImage(imageInfo.imageUrl);
        
        const birdInfo = {
          name: bird.comName,
          scientificName: bird.sciName,
          location: formatLocation(bird.locName, bird.subnational2Name, bird.countryName),
          ebirdUrl: `https://ebird.org/species/${bird.speciesCode}`,
          imageUrl: imageUrl,
          photographer: imageInfo.photographer,
          photographerUrl: imageInfo.photographerUrl,
          imageSource: imageSource,
          audioUrl: audioInfo ? audioInfo.audioUrl : null,
          recordist: audioInfo ? audioInfo.recordist : null,
          recordistUrl: audioInfo ? audioInfo.recordistUrl : null
        };

        log(`Bird info before caching: ${JSON.stringify(birdInfo)}`);
        await cacheBirdInfo(birdInfo);
        log(`Bird info after caching: ${JSON.stringify(birdInfo)}`);
        return birdInfo;
      } catch (error) {
        log(`Error fetching image or audio: ${error.message}`);
        throw new Error(`Failed to fetch image or audio: ${error.message}`);
      }
    } else {
      log(`No bird sightings found for the given location`);
      throw new Error('No recent bird sightings in your area');
    }
  } catch (error) {
    log(`Error in fetchBirdInfo: ${error.message}`);
    throw error;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Received message:', request);
  if (request.action === 'getBirdInfo') {
    log(`Received request for bird info: lat=${request.lat}, lng=${request.lng}`);
    chrome.storage.sync.get(['imageSource'], async function (result) {
      const imageSource = result.imageSource || 'macaulay';
      log(`Using image source: ${imageSource}`);
      try {
        log('Checking for cached bird info');
        const cachedInfo = await getCachedBirdInfo();
        if (cachedInfo && cachedInfo.imageSource === imageSource) {
          log(`Using cached bird info: ${JSON.stringify(cachedInfo)}`);
          sendResponse(cachedInfo);
        } else {
          log('No valid cache found, fetching new bird info');
          const birdInfo = await fetchBirdInfo(request.lat, request.lng, imageSource);
          log(`New bird info fetched: ${JSON.stringify(birdInfo)}`);
          sendResponse(birdInfo);
        }
      } catch (error) {
        console.error('Error fetching bird info:', error);
        log(`Error: ${error.message}`);
        sendResponse({ error: error.message });
      }
    });
    return true;  // Indicates that the response is asynchronous
  }
});

chrome.storage.onChanged.addListener(function (changes, namespace) {
  if (namespace === 'sync' && changes.imageSource) {
    log(`Image source changed to ${changes.imageSource.newValue}`);
    chrome.storage.local.remove(['cachedBirdInfo', 'cacheDate'], function () {
      log(`Cache cleared due to image source change`);
    });
  }
});

log('Background script loaded');