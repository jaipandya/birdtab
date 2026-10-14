import { CONFIG } from './config.js';
import { initSentry, captureException, addBreadcrumb, reportApiError, updateUserContext } from './sentry.js';
import { log } from './logger.js';
import { getOrCreateVisitorId } from './shared.js';
import { isBrowserNewTabUrl } from './browserInfo.js';
import { needsMigration, runMigration, initializeFreshInstall, ensureRegionSettingMigrated } from './storageMigration.js';
import {
  ensureMedia,
  refreshRelease,
  getRandomBird,
  getRegionBirds,
  getSelectedRegion,
  switchRegion,
  isManifestCached,
  clearManifestCache,
  resetMemoryCache,
  setErrorReporter,
  RELEASE_KEY,
} from './mediaClient.js';

// --- Event listeners registered FIRST ---
// In MV3, Chrome only delivers pending events after module evaluation completes.
// Registering listeners before heavy init (Sentry, etc.) ensures they are available
// as early as possible when the service worker is woken from a cold start.

let preloadInProgress = false;
// Bumped on region change so a preload started for the old region is discarded
let preloadGeneration = 0;
let lastNewTabId = null;
let serviceWorkerStartTime = Date.now();

function handleNewTab(tab) {
  if (lastNewTabId && lastNewTabId !== tab.id) {
    chrome.tabs.sendMessage(lastNewTabId, { action: "pauseAudio" }, () => {
      if (chrome.runtime.lastError) {
        log(`Error sending message to tab ${lastNewTabId}: ${chrome.runtime.lastError.message}`);
      }
    });
  }
  lastNewTabId = tab.id;
}

chrome.tabs.onCreated.addListener(handleNewTab);

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && isBrowserNewTabUrl(tab.url)) {
    handleNewTab(tab);
  }
});

// Message listener — registered before initSentry() so it's available immediately
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'preloadNext') {
    if (!preloadInProgress) {
      preloadInProgress = true;
      getSelectedRegion()
        .then(region => preloadNextBird(region))
        .catch(error => log(`Preload failed: ${error.message}`))
        .finally(() => {
          preloadInProgress = false;
          // Check for a new media release in the background (at most every 6 hours)
          refreshRelease();
        });
    }
    sendResponse({ ok: true });
    return true;
  } else if (request.action === 'deleteCache') {
    (async () => {
      await clearCache();
      await chrome.storage.local.remove('preloadedBird');
      // Re-run bootstrap to simulate service worker cold start
      bootstrap({ forceRefresh: true });
    })();
    sendResponse({ message: 'Cache deleted' });
    return true;
  } else if (request.action === 'getBirdsByRegion') {
    (async () => {
      try {
        const region = request.region || await getSelectedRegion();
        const birds = (await getRegionBirds(region)).map(bird => ({
          speciesCode: bird.speciesCode,
          primaryComName: bird.primaryComName,
          scientificName: bird.scientificName,
          imageUrl: bird.imageUrl,
          photographer: bird.photographer,
          photographerUrl: bird.photographerUrl,
          imageLicense: bird.imageLicense,
          imageLicenseUrl: bird.imageLicenseUrl,
          imageSource: bird.imageSource,
          imageSourceUrl: bird.imageSourceUrl,
        }));
        sendResponse({ success: true, birds });
      } catch (error) {
        captureException(error, {
          tags: { operation: 'getBirdsByRegion', source: 'messageListener' },
          extra: { region: request.region }
        });
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  } else if (request.action === 'fetchManifest') {
    (async () => {
      const { ready } = await ensureMedia();
      if (!ready) {
        log('No bird manifest could be fetched');
      }
      sendResponse({ success: ready });
    })();
    return true;
  } else if (request.action === 'isManifestReady') {
    (async () => {
      try {
        sendResponse({ ready: await isManifestCached() });
      } catch {
        sendResponse({ ready: false });
      }
    })();
    return true;
  } else if (request.action === 'switchRegion') {
    // Settings sidebar: fetch the region's manifest, then change the setting.
    // The storage.onChanged listener below preloads the next bird from it.
    (async () => {
      try {
        const result = await switchRegion(request.region);
        sendResponse({ success: true, ...result });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  } else if (request.action === 'loadRegionIndex') {
    // Settings sidebar has no stored region list: discover the release now.
    (async () => {
      const result = await refreshRelease({ force: true });
      const { [RELEASE_KEY]: stored } = await chrome.storage.local.get(RELEASE_KEY);
      sendResponse({ success: !!stored?.index, status: result.status });
    })();
    return true;
  }
});

chrome.runtime.onStartup.addListener(() => {
  // Browser start: check for a new media release regardless of the 6-hour gate
  refreshRelease({ force: true });
});

// --- Heavy initialization (deferred after event listeners) ---

initSentry('background');

log('Background script starting...');
addBreadcrumb('Background script started', 'lifecycle', 'info');
log(`Service worker started at: ${new Date(serviceWorkerStartTime).toISOString()}`);

// Media fetch failures go to Sentry (transient network issues at info level)
setErrorReporter((error, { operation, extra }) => {
  reportApiError(error, { operation, component: 'mediaClient', transientLevel: 'info', extra });
});

self.addEventListener('unhandledrejection', (event) => {
  log(`Unhandled promise rejection: ${event.reason}`);
  captureException(event.reason, {
    tags: { type: 'unhandledRejection' }
  });
});

async function fetchBirdInfo(region) {
  log(`Fetching bird info for region: ${region}`);
  const startTime = Date.now();
  addBreadcrumb(`Fetching bird info for region: ${region}`, 'http', 'info');

  try {
    const birdInfo = await getRandomBird(region);
    if (!birdInfo) {
      throw new Error('No bird found in manifest for region ' + region);
    }

    birdInfo.location = birdInfo.location || region;

    log(`Bird info compiled: ${birdInfo.name} (${birdInfo.speciesCode})`);
    const duration = Date.now() - startTime;
    addBreadcrumb('Bird info fetched successfully', 'http', 'info', {
      duration,
      region,
      speciesCode: birdInfo.speciesCode,
    });

    return birdInfo;
  } catch (error) {
    log(`Error in fetchBirdInfo: ${error.message}`);
    const duration = Date.now() - startTime;
    addBreadcrumb('Bird info fetch failed', 'http', 'error', { duration, region });

    const cachedBirdInfo = await getRandomCachedBirdInfo();
    if (cachedBirdInfo) {
      addBreadcrumb('Using cached bird info as fallback', 'fallback', 'warning');
      log(`Falling back to cached bird: ${cachedBirdInfo.name}`);
      return cachedBirdInfo;
    }

    captureException(error, {
      tags: { operation: 'fetchBirdInfo' },
      extra: { region, duration }
    });

    throw new Error('NETWORK_ERROR_NO_CACHE');
  }
}

async function getRandomCachedBirdInfo() {
  return new Promise(resolve => {
    chrome.storage.local.get('viewHistory', result => {
      const history = result.viewHistory;
      if (Array.isArray(history) && history.length > 0) {
        const bird = history[Math.floor(Math.random() * history.length)];
        if (bird && bird.name) {
          log(`Found cached bird from history: ${bird.name}`);
          resolve(bird);
          return;
        }
      }
      resolve(null);
    });
  });
}

async function preloadNextBird(region) {
  const generation = preloadGeneration;
  try {
    const birdInfo = await fetchBirdInfo(region);
    log('Bird info fetched successfully for preloading');

    if (generation !== preloadGeneration) {
      log('Region changed during preload, discarding bird');
      return;
    }

    // Store preloaded bird in chrome.storage.local so the content script
    // can read it directly without needing to message the service worker.
    // This avoids MV3 service worker lifecycle issues entirely.
    chrome.storage.local.set({ preloadedBird: birdInfo });

    // Prefetch image first (critical), then audio (lower priority).
    // Sequential to avoid bandwidth contention between the two.
    if (birdInfo.imageUrl) {
      try {
        await fetch(birdInfo.imageUrl, { mode: 'no-cors' });
        log('Next bird image preloaded');
      } catch (error) {
        log(`Error preloading image: ${error.message}`);
      }
    }

    if (birdInfo.mediaUrl) {
      try {
        await fetch(birdInfo.mediaUrl, { mode: 'no-cors' });
        log('Next bird audio preloaded');
      } catch (error) {
        log(`Error preloading audio: ${error.message}`);
      }
    }

    log('Next bird preloaded');
  } catch (error) {
    log(`Error preloading next bird: ${error.message}`);
    reportApiError(error, {
      operation: 'preloadNextBird',
      transientLevel: 'info',
      extra: { region },
    });
  }
}

function clearLegacyCacheKeys() {
  chrome.storage.local.get(null, items => {
    const keysToRemove = Object.keys(items).filter(key =>
      key.startsWith('image_') || key.startsWith('audio_') || key.startsWith('birds_')
    );
    if (keysToRemove.length > 0) {
      chrome.storage.local.remove(keysToRemove, () => log(`Cleared ${keysToRemove.length} legacy cache keys`));
    }
  });
}

async function clearCache() {
  clearLegacyCacheKeys();
  await clearManifestCache();
  log('Manifest cache cleared');
}

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.region && changes.region.newValue &&
    changes.region.newValue !== changes.region.oldValue) {
    // The bird on screen stays; the next new tab uses the new region.
    const region = changes.region.newValue;
    log(`Region changed to ${region}, preloading the next bird from it`);
    preloadGeneration++;
    chrome.storage.local.remove('preloadedBird', () => preloadNextBird(region));
    updateUserContext({ region });
  }

  // Storage cleared elsewhere (settings reset): forget in-memory manifests
  if (namespace === 'local' && Object.entries(changes).some(([key, change]) =>
    key.startsWith('media_') && change.newValue === undefined)) {
    resetMemoryCache();
  }

  if (namespace === 'local' && changes.quietHours) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs && tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: "quietHoursChanged",
          quietHoursEnabled: changes.quietHours.newValue
        }, () => {
          if (chrome.runtime.lastError) {
            log(`Error sending quietHoursChanged: ${chrome.runtime.lastError.message}`);
          }
        });
      }
    });
  }
});

/**
 * Bootstrap sequence: fetch the manifest and preload a bird.
 * Runs on service worker cold start and after cache clear.
 */
async function bootstrap({ forceRefresh = false } = {}) {
  await ensureRegionSettingMigrated();
  const { ready, schema, release } = await ensureMedia({ force: forceRefresh });
  log(ready ? `Manifest ready (schema ${schema}${release ? `, release ${release}` : ''})` : 'No manifest available yet');

  // Keep a 2.0.x preloaded bird (or one from this session) for the next tab
  const { preloadedBird } = await chrome.storage.local.get('preloadedBird');
  if (!preloadedBird) {
    preloadNextBird(await getSelectedRegion());
  }
}

// Run bootstrap eagerly on service worker start
bootstrap();

function checkOnboarding() {
  chrome.storage.sync.get(['onboardingComplete'], function (result) {
    if (!result.onboardingComplete) {
      chrome.tabs.create({ url: 'onboarding.html' });
    }
  });
}

chrome.runtime.onInstalled.addListener(async function (details) {
  if (details.reason === 'update') {
    if (await needsMigration()) {
      await runMigration();
    }
    await ensureRegionSettingMigrated();
    clearLegacyCacheKeys();
    // Move to the latest media release now rather than waiting 6 hours.
    // The schema 1 manifest from 2.0.x stays in use until this has stored World.
    refreshRelease({ force: true });
  }

  if (details.reason === 'install') {
    await initializeFreshInstall();
    chrome.storage.local.set({
      installTime: Date.now(),
      newTabCount: 0
    });
  }

  checkOnboarding();
  setPersonalizedUninstallURL();
});

async function generateSignature(data, secret) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const dataToSign = encoder.encode(data);

  const key = await crypto.subtle.importKey(
    'raw', keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, dataToSign);
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function setPersonalizedUninstallURL() {
  try {
    const visitorId = await getOrCreateVisitorId();
    const timestamp = Date.now();
    const dataToSign = `${visitorId}:${timestamp}`;
    const signature = await generateSignature(dataToSign, CONFIG.UNINSTALL_SECRET);
    const uninstallUrl = `${CONFIG.UNINSTALL_URL}?id=${encodeURIComponent(visitorId)}&ts=${timestamp}&sig=${signature}`;

    chrome.runtime.setUninstallURL(uninstallUrl, () => {
      if (chrome.runtime.lastError) {
        log('Error setting uninstall URL: ' + chrome.runtime.lastError.message);
      } else {
        log('Uninstall URL set successfully with signed visitor ID');
      }
    });
  } catch (error) {
    log('Error creating personalized uninstall URL: ' + error.message);
    captureException(error);
    chrome.runtime.setUninstallURL(CONFIG.UNINSTALL_URL, () => {
      if (chrome.runtime.lastError) {
        log('Error setting fallback uninstall URL: ' + chrome.runtime.lastError.message);
      }
    });
  }
}

log('Background script loaded');
