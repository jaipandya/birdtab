console.log('Background script starting...');

const UNSPLASH_ACCESS_KEY = 'mH0pX0bna9zgxESECadRUMSnrUPloNDaGN4rjEf5A9s';
const EBIRD_API_KEY = '40hmhkcjeb5r';

let lastFetchDate = null;

function log(message) {
  if (!('update_url' in chrome.runtime.getManifest())) {
    console.log(`[Bird of the Day]: ${message}`);
  }
}

async function getUnsplashImage(birdName) {
  log(`Fetching Unsplash image for ${birdName}`);
  const response = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(birdName + " bird")}&per_page=1&client_id=${UNSPLASH_ACCESS_KEY}`);
  const data = await response.json();
  if (data.results && data.results.length > 0) {
    const image = data.results[0];
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

async function fetchBirdInfo(region, imageSource) {
  log(`Fetching bird info for region: ${region}, source: ${imageSource}`);
  
  const url = `https://api.ebird.org/v2/data/obs/${region}/recent?maxResults=20`;
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
          const randomIndex = Math.floor(Math.random() * data.length);
          const bird = data[randomIndex];
          log(`Bird found: ${bird.comName}`);
          let imageInfo;
          let audioInfo;
          
          try {
              if (imageSource === 'unsplash') {
                  imageInfo = await getUnsplashImage(bird.comName);
              } else {
                  imageInfo = await getMacaulayImage(bird.speciesCode);
              }
              
              audioInfo = await getMacaulayAudio(bird.speciesCode);
              
              const birdInfo = {
                  name: bird.comName,
                  scientificName: bird.sciName,
                  location: `${bird.subnational2Name}, ${bird.countryName}`,
                  ebirdUrl: `https://ebird.org/species/${bird.speciesCode}`,
                  imageUrl: imageInfo.imageUrl,
                  photographer: imageInfo.photographer,
                  photographerUrl: imageInfo.photographerUrl,
                  imageSource: imageSource,
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
      chrome.storage.sync.get(['region', 'imageSource', 'autoPlay'], async function(result) {
          const region = result.region || 'US';
          const imageSource = result.imageSource || 'macaulay';
          const autoPlay = result.autoPlay || false;
          log(`Using region: ${region}, image source: ${imageSource}, auto-play: ${autoPlay}`);
          try {
              const currentDate = new Date().toDateString();
              if (lastFetchDate !== currentDate) {
                  log(`Fetching new bird info`);
                  const birdInfo = await fetchBirdInfo(region, imageSource);
                  birdInfo.autoPlay = autoPlay;
                  lastFetchDate = currentDate;
                  chrome.storage.local.set({cachedBirdInfo: birdInfo, cacheDate: currentDate});
                  sendResponse(birdInfo);
              } else {
                  log(`Using cached bird info`);
                  chrome.storage.local.get(['cachedBirdInfo'], function(result) {
                      const cachedBirdInfo = result.cachedBirdInfo;
                      cachedBirdInfo.autoPlay = autoPlay;
                      sendResponse(cachedBirdInfo);
                  });
              }
          } catch (error) {
              console.error('Error fetching bird info:', error);
              log(`Error: ${error.message}`);
              sendResponse({error: error.message});
          }
      });
      return true;  // Indicates that the response is asynchronous
  } else if (request.action === 'settingsUpdated' || request.action === 'cacheDeleted') {
      log(`${request.action === 'settingsUpdated' ? 'Settings updated' : 'Cache deleted'}, resetting lastFetchDate`);
      lastFetchDate = null;
  }
});

chrome.storage.onChanged.addListener(function(changes, namespace) {
  if (namespace === 'sync' && (changes.region || changes.imageSource)) {
      log(`Settings changed, clearing cache`);
      chrome.storage.local.remove(['cachedBirdInfo', 'cacheDate'], function() {
          lastFetchDate = null;
      });
  }
});

log('Background script loaded');


