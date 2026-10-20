import { CONFIG } from './config.js';
import { initSentry, captureException, addBreadcrumb, reportApiError, updateUserContext } from './sentry.js';
import { log } from './logger.js';
import { getOrCreateVisitorId } from './shared.js';
import { IS_FIREFOX, isBrowserNewTabUrl } from './browserInfo.js';
import { needsMigration, runMigration, initializeFreshInstall, ensureRegionSettingMigrated } from './storageMigration.js';
import {
  ensureMedia,
  refreshRelease,
  getRandomBird,
  getRegionBirds,
  getSelectedRegion,
  isManifestCached,
  clearManifestCache,
  resetMemoryCache,
  setErrorReporter,
  RELEASE_KEY,
} from './mediaClient.js';
import { trackRegionSwitch } from './regionSwitchTracker.js';
import { loadBirdNames, localizedName, searchableNames } from './birdNames.js';
import { cacheBirdMedia, cacheMediaFile, pruneMediaCache, clearMediaCache } from './mediaCache.js';

// --- Event listeners registered FIRST ---
// In MV3, Chrome only delivers pending events after module evaluation completes.
// Registering listeners before heavy init (Sentry, etc.) ensures they are available
// as early as possible when the service worker is woken from a cold start.

let preloadInProgress = false;
// Bumped on region change so a preload started for the old region is discarded
let preloadGeneration = 0;
let lastNewTabId = null;
let serviceWorkerStartTime = Date.now();

// Firefox doesn't deliver tabs.sendMessage to extension pages, so there the
// message goes to every BirdTab page and only the one in tabId acts on it.
function sendToNewTab(tabId, message) {
  const logFailure = (error) => log(`Error sending ${message.action} to tab ${tabId}: ${error.message}`);
  if (IS_FIREFOX) {
    chrome.runtime.sendMessage({ ...message, targetTabId: tabId }).catch(logFailure);
  } else {
    chrome.tabs.sendMessage(tabId, message, () => {
      if (chrome.runtime.lastError) {
        logFailure(chrome.runtime.lastError);
      }
    });
  }
}

function handleNewTab(tab) {
  if (lastNewTabId && lastNewTabId !== tab.id) {
    sendToNewTab(lastNewTabId, { action: "pauseAudio" });
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
      keepRecentMediaCached()
        .then(() => getSelectedRegion())
        .then(region => fillReadyQueue(region))
        .catch(error => log(`Preload failed: ${error.message}`))
        .finally(() => {
          preloadInProgress = false;
          // Check for a new media release in the background (at most once a day)
          refreshRelease();
        });
    }
    sendResponse({ ok: true });
    return true;
  } else if (request.action === 'deleteCache') {
    (async () => {
      await clearCache();
      await chrome.storage.local.remove(['preloadedBird', 'readyBirds']);
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
    // Settings window: fetch the region's manifest, then change the setting.
    // The storage.onChanged listener below preloads the next bird from it.
    // Progress and failures are mirrored in chrome.storage.session.
    // A switch superseded by a later choice answers { superseded: true }.
    trackRegionSwitch(request.region).then(sendResponse);
    return true;
  } else if (request.action === 'loadRegionIndex') {
    // Settings window has no stored region list: discover the release now.
    (async () => {
      const result = await refreshRelease({ force: true });
      const { [RELEASE_KEY]: stored } = await chrome.storage.local.get(RELEASE_KEY);
      sendResponse({ success: !!stored?.index, status: result.status });
    })();
    return true;
  }
});

chrome.runtime.onStartup.addListener(() => {
  // Browser start: check for a new media release if the daily check is due
  refreshRelease();
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

// Birds whose media is cached ahead of time, for the next new tabs
const READY_QUEUE_SIZE = 3;
// Recently shown birds whose photo stays cached, for tabs opened offline
const RECENT_HISTORY_KEPT = 10;
// Of those, how many keep their recording too. A recording is about 17 times
// the size of a photo (medians 1.7 MB and 100 KB), so older birds keep only
// the photo.
const RECENT_AUDIO_KEPT = 3;

async function getRecentHistory(limit) {
  const { viewHistory } = await chrome.storage.local.get('viewHistory');
  const history = Array.isArray(viewHistory?.value) ? viewHistory.value : [];
  return history.slice(-limit);
}

// Fills run one at a time: two at once would both see room in the queue and
// both add a bird. A request made during a fill runs once it ends (with the
// latest region asked for), so a region change still gets its own fill.
let fillRunning = null;
let fillPendingRegion = null;

/**
 * Top up readyBirds to READY_QUEUE_SIZE birds with cached media, in the order
 * the next tabs need it:
 *   1. the next bird's photo and recording
 *   2. the photos of the other queued birds (a bird joins the queue once its
 *      photo is cached)
 *   3. their recordings
 * Stops at the first photo that can't be cached (offline or failing network);
 * the next new tab tries again. A queued bird without a cached recording
 * still plays it from the network when online.
 */
function fillReadyQueue(region) {
  if (fillRunning) {
    fillPendingRegion = region;
    return fillRunning;
  }
  fillRunning = runReadyQueueFill(region).finally(() => {
    fillRunning = null;
    if (fillPendingRegion) {
      const next = fillPendingRegion;
      fillPendingRegion = null;
      fillReadyQueue(next);
    }
  });
  return fillRunning;
}

async function runReadyQueueFill(region) {
  const generation = preloadGeneration;
  const stale = () => generation !== preloadGeneration;
  addBreadcrumb(`Filling ready queue for region: ${region}`, 'http', 'info');

  try {
    // The bird queued first is the next tab's: give it its recording right away
    const { readyBirds: queued = [] } = await chrome.storage.local.get('readyBirds');
    if (queued[0]?.mediaUrl) await cacheMediaFile(queued[0].mediaUrl);

    for (let attempt = 0; attempt < READY_QUEUE_SIZE; attempt++) {
      if (stale()) return;
      const { readyBirds = [] } = await chrome.storage.local.get('readyBirds');
      if (readyBirds.length >= READY_QUEUE_SIZE) break;

      const recent = await getRecentHistory(RECENT_HISTORY_KEPT);
      const exclude = new Set([...readyBirds, ...recent].map(b => b.speciesCode));
      const birdInfo = await getRandomBird(region, exclude);
      if (!birdInfo) throw new Error('No bird found in manifest for region ' + region);
      birdInfo.location = birdInfo.location || region;

      const imageCached = await cacheMediaFile(birdInfo.imageUrl);
      if (stale()) {
        log('Region changed while filling the ready queue, stopping');
        return;
      }
      if (!imageCached) {
        log(`Could not cache the photo of ${birdInfo.name}, stopping the ready queue fill`);
        break;
      }

      const { readyBirds: latest = [] } = await chrome.storage.local.get('readyBirds');
      if (!latest.some(b => b.speciesCode === birdInfo.speciesCode)) {
        await chrome.storage.local.set({ readyBirds: [...latest, birdInfo] });
        log(`Queued ${birdInfo.name} with its photo cached`);
        if (latest.length === 0 && birdInfo.mediaUrl) await cacheMediaFile(birdInfo.mediaUrl);
      }
    }

    // Recordings of the rest of the queue, in the order they'll be shown
    const { readyBirds: final = [] } = await chrome.storage.local.get('readyBirds');
    for (const bird of final) {
      if (stale()) return;
      if (bird.mediaUrl && !(await cacheMediaFile(bird.mediaUrl))) break;
    }
  } catch (error) {
    log(`Error filling ready queue: ${error.message}`);
    reportApiError(error, {
      operation: 'fillReadyQueue',
      transientLevel: 'info',
      extra: { region },
    });
  }

  await pruneCachedMedia();
}

/**
 * Cache the media of the bird on screen, so it can be shown again offline.
 * Usually a cheap HTTP cache hit, as the page just loaded it.
 */
async function keepRecentMediaCached() {
  const [current] = await getRecentHistory(1);
  if (current) await cacheBirdMedia(current);
}

/**
 * Drop cached media no longer needed. Kept: everything of the ready queue and
 * a legacy preloaded bird, photos of the last RECENT_HISTORY_KEPT birds shown,
 * and recordings of the last RECENT_AUDIO_KEPT.
 */
async function pruneCachedMedia() {
  try {
    const { readyBirds = [], preloadedBird } = await chrome.storage.local.get(['readyBirds', 'preloadedBird']);
    const recent = await getRecentHistory(RECENT_HISTORY_KEPT);
    const upcoming = preloadedBird ? [...readyBirds, preloadedBird] : readyBirds;
    const keep = [
      ...upcoming.flatMap(b => [b.imageUrl, b.mediaUrl]),
      ...recent.map(b => b.imageUrl),
      ...recent.slice(-RECENT_AUDIO_KEPT).map(b => b.mediaUrl),
    ];
    const removed = await pruneMediaCache(keep);
    if (removed > 0) log(`Removed ${removed} media files from the cache`);
  } catch (error) {
    log(`Pruning media cache failed: ${error.message}`);
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
  await clearMediaCache();
  log('Manifest and media caches cleared');
}

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.region && changes.region.newValue &&
    changes.region.newValue !== changes.region.oldValue) {
    // The bird on screen stays; the next new tab uses the new region.
    const region = changes.region.newValue;
    log(`Region changed to ${region}, preloading the next bird from it`);
    preloadGeneration++;
    chrome.storage.local.remove(['preloadedBird', 'readyBirds'], () => fillReadyQueue(region));
    updateUserContext({ region });
  }

  // Storage cleared elsewhere (settings reset): forget in-memory manifests
  if (namespace === 'local' && Object.entries(changes).some(([key, change]) =>
    key.startsWith('media_') && change.newValue === undefined)) {
    resetMemoryCache();
  }

  // Quiet hours turned on or off, or their hours changed: the active tab pauses a call now inside them
  if (namespace === 'local' && (changes.quietHours || changes.quietHoursStart || changes.quietHoursEnd)) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs && tabs[0]) {
        chrome.storage.local.get(['quietHours'], ({ quietHours }) => {
          sendToNewTab(tabs[0].id, {
            action: "quietHoursChanged",
            quietHoursEnabled: quietHours ?? false
          });
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

  // Nothing stored or reachable: don't repeat the whole discovery through a
  // preload; the next new tab or SW start tries again.
  if (!ready) return;

  // A preloaded bird left by 2.0.x is still shown first
  fillReadyQueue(await getSelectedRegion());
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
    // Move to the latest media release now rather than waiting a day.
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

// The "bird" keyword in the address bar (manifest omnibox key, Chrome build): type "bird", a space
// and a bird's name. Names from the stored manifests are suggested as you type; Enter opens
// BirdTab on that bird (or a new bird when nothing matches), even when "Open BirdTab" has it
// step aside for Chrome's new tab page. Chrome does nothing on Enter with no text after the keyword.
if (chrome.omnibox) {
  // Chrome and Edge read the description as XML (<dim> for the scientific name); Firefox shows it as plain text
  const escapeXml = (text) => IS_FIREFOX ? String(text) : String(text).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  const dim = (text) => (IS_FIREFOX ? `· ${text}` : `<dim>${escapeXml(text)}</dim>`);
  const displayName = (bird) => localizedName(bird);

  let omniboxBirds = null;
  async function birdsForOmnibox() {
    if (!omniboxBirds) {
      const region = await getSelectedRegion();
      const lists = [await getRegionBirds(region).catch(() => [])];
      if (region !== 'WLD') lists.push(await getRegionBirds('WLD').catch(() => []));
      const seen = new Set();
      omniboxBirds = lists.flat().filter((b) => b && !seen.has(b.speciesCode) && seen.add(b.speciesCode));
    }
    return omniboxBirds;
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.region) omniboxBirds = null;
  });

  async function matchBirds(text, limit = 5) {
    const query = text.trim().toLowerCase();
    if (!query) return [];
    await loadBirdNames();
    const names = (b) => searchableNames(b).map((n) => n.toLowerCase());
    const birds = await birdsForOmnibox();
    const starts = birds.filter((b) => names(b).some((n) => n.startsWith(query) || n.includes(` ${query}`)));
    const contains = birds.filter((b) => !starts.includes(b) && names(b).some((n) => n.includes(query)));
    return [...starts, ...contains].slice(0, limit);
  }

  chrome.omnibox.setDefaultSuggestion({
    description: escapeXml(chrome.i18n.getMessage('omniboxSuggestion') || 'BirdTab: type a bird’s name, or anything for a new bird'),
  });
  chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
    try {
      const birds = await matchBirds(text);
      suggest(birds.map((b) => ({
        content: displayName(b),
        description: `${escapeXml(displayName(b))} ${dim(b.scientificName || '')}`,
      })));
    } catch (error) {
      log(`Omnibox suggestions failed: ${error.message}`);
    }
  });
  chrome.omnibox.onInputEntered.addListener(async (text, disposition) => {
    let bird = null;
    try {
      [bird] = await matchBirds(text, 1);
    } catch (error) {
      log(`Omnibox lookup failed: ${error.message}`);
    }
    // The new tab page shows a pending bird first (the same way History opens one)
    if (bird) await chrome.storage.local.set({ pendingBirdInfo: bird });
    const url = chrome.runtime.getURL('index.html?open');
    if (disposition === 'currentTab') {
      chrome.tabs.update({ url });
    } else {
      chrome.tabs.create({ url, active: disposition === 'newForegroundTab' });
    }
  });
}
