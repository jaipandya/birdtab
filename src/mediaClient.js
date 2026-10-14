/**
 * Media Client Module
 *
 * Discovers, fetches, caches, and queries the bird media manifests on
 * Cloudflare R2 (format: crawlers/RELEASE_FORMAT.md, schema 2).
 *
 *   current.json                         pointer to the live release
 *   releases/<release>/index.json        regions in the release
 *   releases/<release>/regions/<C>.json  one manifest per region (WLD = World)
 *
 * Storage (chrome.storage.local):
 *   media_release          { release, indexUrl, index, storedAt } of the current release
 *   media_region_<CODE>    region manifests of the current release (World and the selected region only)
 *   media_discovery        { lastCheckedAt, lastFailureAt } of the current.json check
 *   media_manifest(_meta)  schema 1 World manifest from 2.0.x, kept until media_region_WLD is stored
 *
 * A release switch writes the new index and its region manifests in one
 * storage.set, so readers see either the old release or the new one.
 * Readers use stored data; the network is only used in the background, or
 * when nothing at all is stored (fresh install, cleared cache).
 */

import { CONFIG } from './config.js';
import { log } from './logger.js';

const MEDIA = CONFIG.MEDIA;
const WORLD = MEDIA.DEFAULT_REGION;

export const LEGACY_MANIFEST_KEY = 'media_manifest';
export const LEGACY_MANIFEST_META_KEY = 'media_manifest_meta';
export const RELEASE_KEY = 'media_release';
export const DISCOVERY_KEY = 'media_discovery';
export const REGION_KEY_PREFIX = 'media_region_';

export function regionStorageKey(code) {
  return `${REGION_KEY_PREFIX}${code}`;
}

// In-memory cache: storage key -> { manifest, speciesIndex }
const memoryCache = new Map();
let refreshInProgress = null;
let exclusiveQueue = Promise.resolve();
let errorReporter = null;

/**
 * Register a function that reports failed fetches (e.g. to Sentry).
 * Kept out of this module so it has no Sentry dependency.
 * @param {(error: Error, context: {operation: string, extra: Object}) => void} reporter
 */
export function setErrorReporter(reporter) {
  errorReporter = reporter;
}

function reportError(error, operation, extra = {}) {
  log(`${operation} failed: ${error.message}`);
  if (errorReporter) {
    try {
      errorReporter(error, { operation, extra });
    } catch {
      // Reporting must never break the caller
    }
  }
}

/**
 * Run fn after every previously queued exclusive operation has settled,
 * so release switches and region switches never interleave.
 */
function exclusive(fn) {
  const run = exclusiveQueue.then(fn, fn);
  exclusiveQueue = run.catch(() => {});
  return run;
}

// --- Storage helpers -------------------------------------------------------

function storageGet(keys) {
  return new Promise(resolve => {
    chrome.storage.local.get(keys, result => resolve(result || {}));
  });
}

function storageSet(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      if (chrome.runtime?.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

function storageRemove(keys) {
  return new Promise(resolve => {
    if (!keys.length) {
      resolve();
      return;
    }
    chrome.storage.local.remove(keys, () => resolve());
  });
}

async function getStoredRegionKeys() {
  // getKeys() (Chrome 130+) avoids reading every manifest just to list keys
  const keys = typeof chrome.storage.local.getKeys === 'function'
    ? await chrome.storage.local.getKeys()
    : Object.keys(await storageGet(null));
  return keys.filter(key => key.startsWith(REGION_KEY_PREFIX));
}

// --- Versions and validation -----------------------------------------------

/**
 * Dotted numeric compare: compareVersions('2.1.0', '2.10.0') === -1.
 * Missing or non-numeric parts count as 0.
 */
export function compareVersions(a, b) {
  const pa = String(a ?? '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b ?? '').split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export function getExtensionVersion() {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return '0.0.0';
  }
}

/**
 * True when a current.json or index.json document is one this extension can
 * read: a schema version it knows and a minExtensionVersion it satisfies.
 */
export function isUsableReleaseDoc(doc, extensionVersion = getExtensionVersion()) {
  if (!doc || typeof doc !== 'object') return false;
  if (doc.schemaVersion !== MEDIA.SCHEMA_VERSION) return false;
  if (doc.minExtensionVersion && compareVersions(extensionVersion, doc.minExtensionVersion) < 0) return false;
  return true;
}

function isValidIndex(index) {
  return isUsableReleaseDoc(index)
    && typeof index.release === 'string'
    && Array.isArray(index.regions)
    && index.regions.some(r => r?.code === WORLD && typeof r.url === 'string');
}

function isValidRegionManifest(manifest, code, release = null) {
  return !!manifest
    && manifest.meta?.schemaVersion === MEDIA.SCHEMA_VERSION
    && (!release || !manifest.meta?.release || manifest.meta.release === release)
    && Array.isArray(manifest.species)
    && Array.isArray(manifest.regions?.[code]?.speciesCodes);
}

function isValidLegacyManifest(manifest) {
  return !!manifest && Array.isArray(manifest.species) && Array.isArray(manifest.regions?.[WORLD]?.speciesCodes);
}

// --- Network ---------------------------------------------------------------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch JSON with a timeout per attempt and retries with exponential backoff.
 * 4xx responses other than 408/429 are not retried. Errors carry the flags
 * sentry.js classifyError() reads (statusCode, isNetworkError, isServerError, isTimeout).
 */
export async function fetchJson(url, {
  timeoutMs = MEDIA.FETCH_TIMEOUT_MS,
  retries = MEDIA.FETCH_RETRIES,
  baseDelayMs = MEDIA.RETRY_BASE_DELAY_MS,
} = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await sleep(delay + Math.floor(Math.random() * baseDelayMs * 0.25));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} for ${url}`);
        error.statusCode = response.status;
        error.isServerError = response.status >= 500;
        throw error;
      }
      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        lastError = new Error(`Timeout after ${timeoutMs}ms for ${url}`);
        lastError.isNetworkError = true;
        lastError.isTimeout = true;
      } else {
        lastError = error;
        if (!error.statusCode && error instanceof TypeError) {
          error.isNetworkError = true;
        }
      }
      const status = lastError.statusCode;
      const retryable = !status || status >= 500 || status === 408 || status === 429;
      log(`Fetch attempt ${attempt + 1} failed for ${url}: ${lastError.message}`);
      if (!retryable) break;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError;
}

async function fetchRegionManifest(index, code) {
  const entry = index.regions.find(r => r.code === code);
  if (!entry) {
    throw new Error(`Region ${code} is not in release ${index.release}`);
  }
  const manifest = await fetchJson(entry.url);
  if (!isValidRegionManifest(manifest, code, index.release)) {
    throw new Error(`Invalid region manifest for ${code} in release ${index.release}`);
  }
  log(`Region manifest ${code} fetched: ${manifest.species.length} species`);
  return manifest;
}

async function fetchLegacyManifest() {
  const url = MEDIA.LEGACY_MANIFEST_URL;
  log(`Fetching schema 1 manifest from ${url}`);
  const manifest = await fetchJson(url);
  if (!isValidLegacyManifest(manifest)) {
    throw new Error('Invalid schema 1 manifest');
  }
  await storageSet({
    [LEGACY_MANIFEST_KEY]: manifest,
    [LEGACY_MANIFEST_META_KEY]: {
      version: manifest.meta?.version,
      manifestUrl: url,
      cachedAt: Date.now(),
    }
  });
  memoryCache.delete(LEGACY_MANIFEST_KEY);
  return manifest;
}

// --- Release discovery ------------------------------------------------------

/**
 * Remove region manifests other than keepCodes, and the schema 1 manifest
 * once the World region manifest is stored (upgrade from 2.0.x).
 */
async function pruneStorage(keepCodes) {
  const keepKeys = new Set(keepCodes.map(regionStorageKey));
  const regionKeys = await getStoredRegionKeys();
  const toRemove = regionKeys.filter(key => !keepKeys.has(key));

  const worldKey = regionStorageKey(WORLD);
  const { [RELEASE_KEY]: stored, [LEGACY_MANIFEST_META_KEY]: legacyMeta } =
    await storageGet([RELEASE_KEY, LEGACY_MANIFEST_META_KEY]);
  if (stored && legacyMeta && regionKeys.includes(worldKey)) {
    const { [worldKey]: world } = await storageGet([worldKey]);
    if (isValidRegionManifest(world, WORLD, stored.release)) {
      toRemove.push(LEGACY_MANIFEST_KEY, LEGACY_MANIFEST_META_KEY);
    }
  }

  if (toRemove.length > 0) {
    await storageRemove(toRemove);
    toRemove.forEach(key => memoryCache.delete(key));
    log(`Pruned media storage: ${toRemove.join(', ')}`);
  }
}

async function recordDiscovery(update) {
  const { [DISCOVERY_KEY]: current = {} } = await storageGet([DISCOVERY_KEY]);
  await storageSet({ [DISCOVERY_KEY]: { ...current, ...update } });
}

/**
 * Fetch an index and the region manifests the user needs, then switch to that
 * release with one storage write. Old release data is removed afterwards.
 */
async function installRelease(indexUrl, selectedRegion) {
  const index = await fetchJson(indexUrl);
  if (!isValidIndex(index)) {
    throw new Error(`Unusable release index at ${indexUrl}`);
  }

  const hasSelected = index.regions.some(r => r.code === selectedRegion);
  const region = hasSelected ? selectedRegion : WORLD;
  const needed = region === WORLD ? [WORLD] : [WORLD, region];

  const manifests = await Promise.all(needed.map(code => fetchRegionManifest(index, code)));

  const items = {
    [RELEASE_KEY]: {
      schemaVersion: index.schemaVersion,
      release: index.release,
      indexUrl,
      index,
      storedAt: Date.now(),
    },
  };
  needed.forEach((code, i) => {
    items[regionStorageKey(code)] = manifests[i];
  });
  if (region !== selectedRegion) {
    // The selected region is not in this release; fall back to the default.
    log(`Region ${selectedRegion} is not in release ${index.release}, using ${WORLD}`);
    items.region = WORLD;
  }

  await storageSet(items);
  needed.forEach(code => memoryCache.delete(regionStorageKey(code)));
  await pruneStorage(needed);

  log(`Switched to release ${index.release} (stored regions: ${needed.join(', ')})`);
  return index.release;
}

/**
 * Make sure the stored release has the World and selected region manifests
 * (keys can go missing, e.g. a region switch cut short by a browser exit).
 */
async function repairStoredRelease(stored, selectedRegion) {
  const codes = [WORLD];
  if (selectedRegion !== WORLD && stored.index.regions.some(r => r.code === selectedRegion)) {
    codes.push(selectedRegion);
  }
  const present = await storageGet(codes.map(regionStorageKey));
  const missing = codes.filter(code => !isValidRegionManifest(present[regionStorageKey(code)], code, stored.release));
  if (missing.length === 0) return;

  log(`Fetching missing region manifests for ${stored.release}: ${missing.join(', ')}`);
  const manifests = await Promise.all(missing.map(code => fetchRegionManifest(stored.index, code)));
  const items = {};
  missing.forEach((code, i) => {
    items[regionStorageKey(code)] = manifests[i];
    memoryCache.delete(regionStorageKey(code));
  });
  await storageSet(items);
}

async function runDiscovery({ force = false } = {}) {
  const now = Date.now();
  const {
    [RELEASE_KEY]: stored,
    [LEGACY_MANIFEST_META_KEY]: legacyMeta,
    [DISCOVERY_KEY]: discovery = {},
    region: storedRegion,
  } = await storageGet([RELEASE_KEY, LEGACY_MANIFEST_META_KEY, DISCOVERY_KEY, 'region']);
  const selectedRegion = storedRegion || WORLD;
  const hasStoredData = !!(stored || legacyMeta);

  // With something to show, check at most every 6 hours (sooner after a failed switch).
  if (!force && hasStoredData) {
    const checkedRecently = discovery.lastCheckedAt && now - discovery.lastCheckedAt < MEDIA.REFRESH_INTERVAL_MS;
    const failedRecently = discovery.lastFailureAt && now - discovery.lastFailureAt < MEDIA.FAILURE_BACKOFF_MS;
    const lastAttemptFailed = discovery.lastFailureAt && discovery.lastFailureAt >= (discovery.lastCheckedAt || 0);
    if (lastAttemptFailed ? failedRecently : checkedRecently) {
      return { status: 'fresh', release: stored?.release ?? null };
    }
  }

  // 1. Where is the live release?
  let indexUrl = null;
  let pointer = null;
  try {
    pointer = await fetchJson(MEDIA.CURRENT_URL);
    if (isUsableReleaseDoc(pointer) && typeof pointer.indexUrl === 'string') {
      indexUrl = pointer.indexUrl;
    } else {
      log(`current.json names a release this version can't use (${pointer?.release}); ignoring it`);
    }
  } catch (error) {
    // A 404 is expected until the first schema 2 release is published; the
    // fallback index or the schema 1 manifest covers it. Report anything else.
    if (error.statusCode !== 404) {
      reportError(error, 'fetchCurrentRelease', { url: MEDIA.CURRENT_URL });
    } else {
      log('current.json not found; using the built-in release');
    }
  }

  // current.json is the authority: follow it to any release it names that
  // differs from the stored one (a rollback names an older release).
  if (stored && (!indexUrl || indexUrl === stored.indexUrl || pointer?.release === stored.release)) {
    await recordDiscovery({ lastCheckedAt: now });
    return { status: 'unchanged', release: stored.release };
  }

  if (!indexUrl) {
    indexUrl = MEDIA.FALLBACK_INDEX_URL;
  }
  if (!indexUrl) {
    await recordDiscovery({ lastCheckedAt: now });
    return { status: 'unavailable', release: null };
  }

  // 2. Fetch the release and switch once it is fully stored.
  try {
    const release = await installRelease(indexUrl, selectedRegion);
    await recordDiscovery({ lastCheckedAt: now, lastFailureAt: null });
    return { status: 'switched', release };
  } catch (error) {
    reportError(error, 'installRelease', { indexUrl, region: selectedRegion, previousRelease: stored?.release ?? null });
    await recordDiscovery({ lastFailureAt: now });
    return { status: 'failed', release: stored?.release ?? null, error };
  }
}

/**
 * Check current.json (at most every 6 hours unless forced) and switch to a
 * newly published release in the background. Never throws.
 * @returns {Promise<{status: string, release: string|null}>}
 */
export function refreshRelease({ force = false } = {}) {
  if (refreshInProgress) return refreshInProgress;
  refreshInProgress = exclusive(() => runDiscovery({ force }))
    .catch(error => {
      reportError(error, 'refreshRelease');
      return { status: 'failed', release: null, error };
    })
    .finally(() => { refreshInProgress = null; });
  return refreshInProgress;
}

/**
 * Which manifest data is stored. Reads the World manifest (chrome.storage
 * has no "has key"), so this is for the background, not the new-tab path.
 */
async function getStoredMediaState() {
  const { [RELEASE_KEY]: stored } = await storageGet([RELEASE_KEY]);
  if (stored) {
    const worldKey = regionStorageKey(WORLD);
    const { [worldKey]: world } = await storageGet([worldKey]);
    if (isValidRegionManifest(world, WORLD, stored.release)) {
      return { schema: 2, release: stored.release };
    }
  }
  const { [LEGACY_MANIFEST_KEY]: legacy } = await storageGet([LEGACY_MANIFEST_KEY]);
  if (isValidLegacyManifest(legacy)) {
    return { schema: 1, release: null };
  }
  return { schema: null, release: null };
}

/**
 * Make sure some usable manifest is stored, preferring schema 2:
 *   1. drop the schema 1 manifest if the World region manifest is stored (upgrade from 2.0.x)
 *   2. refresh the release (throttled unless forced)
 *   3. fetch region manifests the stored release is missing
 *   4. if no schema 2 data is reachable and nothing is stored, fetch the schema 1 manifest
 * Never throws.
 *
 * @returns {Promise<{ready: boolean, schema: 1|2|null, release: string|null}>}
 */
export async function ensureMedia({ force = false } = {}) {
  const region = await getSelectedRegion();
  await exclusive(() => pruneStorage([WORLD, region])).catch(error => reportError(error, 'pruneStorage'));
  await refreshRelease({ force });

  return exclusive(async () => {
    const { [RELEASE_KEY]: stored, region: currentRegion } = await storageGet([RELEASE_KEY, 'region']);
    if (stored) {
      try {
        await repairStoredRelease(stored, currentRegion || WORLD);
        await pruneStorage([WORLD, currentRegion || WORLD]);
      } catch (error) {
        reportError(error, 'repairStoredRelease', { release: stored.release, region: currentRegion });
      }
    }

    const state = await getStoredMediaState();
    if (state.schema) {
      return { ready: true, ...state };
    }

    try {
      await fetchLegacyManifest();
      return { ready: true, schema: 1, release: null };
    } catch (error) {
      reportError(error, 'fetchLegacyManifest', { url: MEDIA.LEGACY_MANIFEST_URL });
      return { ready: false, schema: null, release: null };
    }
  }).catch(error => {
    reportError(error, 'ensureMedia');
    return { ready: false, schema: null, release: null };
  });
}

// --- Region selection -------------------------------------------------------

export async function getSelectedRegion() {
  const { region } = await storageGet(['region']);
  return region || WORLD;
}

/**
 * The stored release index (for the region list), or null. No network.
 */
export async function getStoredIndex() {
  const { [RELEASE_KEY]: stored } = await storageGet([RELEASE_KEY]);
  return stored?.index ?? null;
}

/**
 * Switch the selected region: fetch its manifest for the current release,
 * store it together with the new `region` setting, and drop other non-World
 * region manifests. On failure nothing changes and the error is thrown.
 *
 * @param {string} code - Region code from the index
 * @returns {Promise<{region: string, previousRegion: string}>}
 */
export function switchRegion(code) {
  return exclusive(async () => {
    const { [RELEASE_KEY]: stored, region: previous } = await storageGet([RELEASE_KEY, 'region']);
    const previousRegion = previous || WORLD;

    if (code === WORLD) {
      await storageSet({ region: WORLD });
      await pruneStorage([WORLD]);
      return { region: WORLD, previousRegion };
    }

    if (!stored?.index?.regions?.some(r => r.code === code)) {
      throw new Error(`Region ${code} is not in the stored release`);
    }

    const key = regionStorageKey(code);
    const { [key]: existing } = await storageGet([key]);
    const items = { region: code };
    if (!isValidRegionManifest(existing, code, stored.release)) {
      try {
        items[key] = await fetchRegionManifest(stored.index, code);
      } catch (error) {
        reportError(error, 'switchRegion', { region: code, previousRegion, release: stored.release });
        throw error;
      }
    }

    await storageSet(items);
    memoryCache.delete(key);
    await pruneStorage([WORLD, code]);
    log(`Region switched from ${previousRegion} to ${code}`);
    return { region: code, previousRegion };
  });
}

// --- Reading manifests ------------------------------------------------------

function buildSpeciesIndex(manifest) {
  return new Map(manifest.species.map(entry => [entry.speciesCode, entry]));
}

async function loadFromStorage(key, isValid) {
  const cached = memoryCache.get(key);
  if (cached) return cached;
  const { [key]: manifest } = await storageGet([key]);
  if (!isValid(manifest)) return null;
  const entry = { manifest, speciesIndex: buildSpeciesIndex(manifest) };
  memoryCache.set(key, entry);
  return entry;
}

/**
 * The best stored manifest for a region: that region, then World, then the
 * schema 1 manifest. No network.
 * @returns {Promise<{manifest: Object, speciesIndex: Map, region: string}|null>}
 */
async function loadStoredManifest(region) {
  const candidates = region && region !== WORLD ? [region, WORLD] : [WORLD];
  for (const code of candidates) {
    const entry = await loadFromStorage(regionStorageKey(code), m => isValidRegionManifest(m, code));
    if (entry) return { ...entry, region: code };
  }
  const legacy = await loadFromStorage(LEGACY_MANIFEST_KEY, isValidLegacyManifest);
  if (legacy) return { ...legacy, region: WORLD };
  return null;
}

async function loadManifest(region) {
  const stored = await loadStoredManifest(region);
  if (stored) return stored;

  // Nothing stored (fresh install or cleared cache): fetch now.
  const { ready } = await ensureMedia({ force: true });
  const fetched = ready ? await loadStoredManifest(region) : null;
  if (!fetched) {
    throw new Error('No bird manifest available');
  }
  return fetched;
}

/**
 * Get the manifest used for a region: stored data first, the network only
 * when nothing is stored.
 */
export async function getManifest(region = WORLD) {
  const { manifest } = await loadManifest(region);
  return manifest;
}

/**
 * Whether some usable manifest is stored. No network.
 */
export async function isManifestCached() {
  const { schema } = await getStoredMediaState();
  return !!schema;
}

/**
 * Get the ordered species code list for a region.
 */
export function getRegionSpeciesCodes(manifest, region = WORLD) {
  return manifest.regions?.[region]?.speciesCodes ?? [];
}

/**
 * Pick a random bird from a manifest: from `region` if the manifest has it,
 * else World (a schema 1 manifest only has World).
 * @returns {Object|null} birdInfo with `location` set to the region used
 */
export function pickRandomBird(manifest, region = WORLD, excludeCodes = null, speciesIndex = null) {
  if (!manifest?.regions || !Array.isArray(manifest.species)) return null;
  const usedRegion = manifest.regions[region] ? region : WORLD;
  let codes = getRegionSpeciesCodes(manifest, usedRegion);
  if (codes.length === 0) return null;

  if (excludeCodes && excludeCodes.size > 0) {
    const filtered = codes.filter(c => !excludeCodes.has(c));
    if (filtered.length > 0) codes = filtered;
  }

  const randomCode = codes[Math.floor(Math.random() * codes.length)];
  const entry = speciesIndex
    ? speciesIndex.get(randomCode)
    : manifest.species.find(s => s.speciesCode === randomCode);
  const bird = adaptSpeciesToBirdInfo(entry);
  if (bird) bird.location = usedRegion;
  return bird;
}

/**
 * Get a random bird for a region, adapted into the flat birdInfo shape.
 *
 * @param {string} region - Region code (default 'WLD')
 * @param {Set<string>} excludeCodes - Species codes to exclude (e.g., recently shown)
 * @returns {Promise<Object|null>} birdInfo object or null
 */
export async function getRandomBird(region = WORLD, excludeCodes = null) {
  const { manifest, speciesIndex, region: usedRegion } = await loadManifest(region);
  return pickRandomBird(manifest, usedRegion, excludeCodes, speciesIndex);
}

/**
 * Get a specific bird by species code, adapted into birdInfo shape.
 */
export async function getBirdByCode(speciesCode, region = WORLD) {
  const { speciesIndex } = await loadManifest(region);
  const entry = speciesIndex.get(speciesCode);
  return entry ? adaptSpeciesToBirdInfo(entry) : null;
}

/**
 * Get all species for a region as birdInfo objects (quiz mode).
 */
export async function getRegionBirds(region = WORLD) {
  const { manifest, speciesIndex, region: usedRegion } = await loadManifest(region);
  return getRegionSpeciesCodes(manifest, usedRegion)
    .map(code => speciesIndex.get(code))
    .filter(Boolean)
    .map(adaptSpeciesToBirdInfo);
}

/**
 * The bird for a new tab, from storage only (never the network):
 *   1. preloadedBird, picked by the background (removed once taken; a 2.0.x
 *      preloadedBird has the same shape and shows too)
 *   2. a random bird from the selected region's manifest, then World's,
 *      then the schema 1 manifest from 2.0.x
 * Manifests are read one key at a time and only when no preloaded bird waits.
 * @returns {Promise<Object|null>} birdInfo, or null when nothing is stored
 */
export async function takeStoredBird() {
  const { preloadedBird, region } = await storageGet(['preloadedBird', 'region']);
  if (preloadedBird) {
    chrome.storage.local.remove('preloadedBird');
    return preloadedBird;
  }

  const selectedRegion = region || WORLD;
  const keys = [regionStorageKey(selectedRegion), regionStorageKey(WORLD), LEGACY_MANIFEST_KEY]
    .filter((key, i, all) => all.indexOf(key) === i);
  for (const key of keys) {
    const { [key]: manifest } = await storageGet([key]);
    const bird = manifest ? pickRandomBird(manifest, selectedRegion) : null;
    if (bird) return bird;
  }
  return null;
}

/**
 * Forget in-memory manifests (e.g. after storage was cleared elsewhere).
 */
export function resetMemoryCache() {
  memoryCache.clear();
}

/**
 * Clear all manifests and discovery state from memory and storage.
 * Called on explicit cache clear.
 */
export async function clearManifestCache() {
  resetMemoryCache();
  const regionKeys = await getStoredRegionKeys();
  await storageRemove([
    LEGACY_MANIFEST_KEY,
    LEGACY_MANIFEST_META_KEY,
    RELEASE_KEY,
    DISCOVERY_KEY,
    ...regionKeys,
  ]);
}

/**
 * Adapt a manifest species entry into the flat birdInfo shape
 * that script.js and the rest of the extension expect.
 */
export function adaptSpeciesToBirdInfo(entry) {
  if (!entry) return null;

  return {
    name: entry.primaryComName,
    primaryComName: entry.primaryComName,
    primaryComName_fr: entry.primaryComName_fr ?? null,
    primaryComName_cn: entry.primaryComName_cn ?? null,
    scientificName: entry.scientificName,
    description: entry.description ?? null,
    conservationStatus: entry.conservationStatus ?? null,
    speciesCode: entry.speciesCode,
    ebirdUrl: entry.ebirdUrl,

    imageUrl: entry.image?.renditions?.default?.url ?? null,
    photographer: entry.image?.creatorName ?? null,
    photographerUrl: entry.image?.creatorUrl ?? null,

    mediaUrl: entry.audio?.renditions?.default?.url ?? null,
    recordist: entry.audio?.creatorName ?? null,
    recordistUrl: entry.audio?.creatorUrl ?? null,

    imageSource: entry.image?.source ?? null,
    imageSourceKey: entry.image?.sourceKey ?? null,
    imageSourceUrl: entry.image?.sourceUrl ?? null,
    imageLicense: entry.image?.license ?? null,
    imageLicenseUrl: entry.image?.licenseUrl ?? null,
    imageTitle: entry.image?.title ?? null,
    imageCaption: entry.image?.caption ?? null,
    imageLocation: entry.image?.location ?? null,
    imageLatitude: entry.image?.latitude ?? null,
    imageLongitude: entry.image?.longitude ?? null,
    imageDate: entry.image?.capturedAt ?? null,
    imageResized: entry.image?.renditions?.default?.resized ?? false,

    audioSource: entry.audio?.source ?? null,
    audioSourceKey: entry.audio?.sourceKey ?? null,
    audioSourceUrl: entry.audio?.sourceUrl ?? null,
    audioLicense: entry.audio?.license ?? null,
    audioLicenseUrl: entry.audio?.licenseUrl ?? null,
    audioTitle: entry.audio?.title ?? null,
    audioSoundType: entry.audio?.soundType ?? null,
    audioLocation: entry.audio?.location ?? null,
    audioLatitude: entry.audio?.latitude ?? null,
    audioLongitude: entry.audio?.longitude ?? null,
    audioDate: entry.audio?.recordedAt ?? null,
    audioConvertedFormat: entry.audio?.renditions?.default?.format ?? null,
    audioDurationSeconds: entry.audio?.renditions?.default?.durationSeconds ?? null,
    audioDurationFormatted: entry.audio?.renditions?.default?.durationFormatted ?? null,
  };
}
