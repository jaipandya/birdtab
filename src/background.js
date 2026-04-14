import { CONFIG } from './config.js';
import { initSentry, captureException, addBreadcrumb, reportApiError } from './sentry.js';
import { log } from './logger.js';
import { getOrCreateVisitorId } from './shared.js';
import { isBrowserNewTabUrl } from './browserInfo.js';
import { needsMigration, runMigration, initializeFreshInstall } from './storageMigration.js';
import { getManifest, getRandomBird, clearManifestCache, fetchManifest } from './mediaClient.js';

// --- Event listeners registered FIRST ---
// In MV3, Chrome only delivers pending events after module evaluation completes.
// Registering listeners before heavy init (Sentry, etc.) ensures they are available
// as early as possible when the service worker is woken from a cold start.

let preloadInProgress = false;
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
      preloadNextBird('WLD')
        .catch(error => log(`Preload failed: ${error.message}`))
        .finally(() => { preloadInProgress = false; });
    }
    sendResponse({ ok: true });
    return true;
  } else if (request.action === 'deleteCache') {
    clearCache();
    chrome.storage.local.remove('preloadedBird');
    // Re-run bootstrap to simulate service worker cold start
    bootstrap({ forceRefresh: true });
    sendResponse({ message: 'Cache deleted' });
    return true;
  } else if (request.action === 'getBirdsByRegion') {
    (async () => {
      try {
        const manifest = await getManifest();
        const codes = manifest.regions?.WLD?.speciesCodes ?? [];
        const speciesByCode = new Map(manifest.species.map(s => [s.speciesCode, s]));
        const birds = codes.map(code => {
          const entry = speciesByCode.get(code);
          if (!entry) return null;
          return {
            speciesCode: entry.speciesCode,
            primaryComName: entry.primaryComName,
            scientificName: entry.scientificName,
            imageUrl: entry.image?.renditions?.default?.url ?? null,
            photographer: entry.image?.creatorName ?? null,
            photographerUrl: entry.image?.creatorUrl ?? null,
            imageLicense: entry.image?.license ?? null,
            imageLicenseUrl: entry.image?.licenseUrl ?? null,
            imageSource: entry.image?.source ?? null,
            imageSourceUrl: entry.image?.sourceUrl ?? null,
          };
        }).filter(Boolean);
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
      try {
        await fetchManifest();
        sendResponse({ success: true });
      } catch (error) {
        log(`Error fetching manifest: ${error.message}`);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  } else if (request.action === 'isManifestReady') {
    (async () => {
      try {
        const manifest = await getManifest();
        sendResponse({ ready: !!manifest });
      } catch {
        sendResponse({ ready: false });
      }
    })();
    return true;
  }
});

// --- Heavy initialization (deferred after event listeners) ---

initSentry('background');

log('Background script starting...');
addBreadcrumb('Background script started', 'lifecycle', 'info');
log(`Service worker started at: ${new Date(serviceWorkerStartTime).toISOString()}`);

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

    birdInfo.location = region;

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
  try {
    const birdInfo = await fetchBirdInfo(region);
    log('Bird info fetched successfully for preloading');

    // Store preloaded bird in chrome.storage.local so the content script
    // can read it directly without needing to message the service worker.
    // This avoids MV3 service worker lifecycle issues entirely.
    chrome.storage.local.set({ preloadedBird: birdInfo });

    const preloadPromises = [];

    if (birdInfo.imageUrl) {
      preloadPromises.push(
        fetch(birdInfo.imageUrl, { mode: 'no-cors' })
          .then(() => log('Image preloaded successfully'))
          .catch(error => log(`Error preloading image: ${error.message}`))
      );
    }

    if (birdInfo.mediaUrl) {
      preloadPromises.push(
        fetch(birdInfo.mediaUrl, { mode: 'no-cors' })
          .then(() => log('Audio preloaded successfully'))
          .catch(error => log(`Error preloading audio: ${error.message}`))
      );
    }

    await Promise.all(preloadPromises);
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

function clearCache() {
  clearManifestCache().then(() => log('Manifest cache cleared'));
  clearLegacyCacheKeys();
}

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.region) {
    log('Region changed, clearing cache');
    clearCache();
    chrome.storage.local.remove('preloadedBird');
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
  try {
    await getManifest({ forceRefresh });
    log('Manifest ready');
  } catch (error) {
    log(`Manifest fetch failed: ${error.message}`);
  }
  preloadNextBird('WLD');
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
    clearLegacyCacheKeys();
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
