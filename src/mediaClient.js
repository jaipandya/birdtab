/**
 * Media Client Module
 *
 * Fetches, caches, and queries the bird media manifest from Cloudflare R2.
 * The manifest contains all species data, media URLs, and attribution metadata.
 * Once fetched, the manifest is stored permanently in chrome.storage.local
 * and only refetched on extension update or region change.
 */

import { CONFIG } from './config.js';
import { log } from './logger.js';

const MANIFEST_STORAGE_KEY = 'media_manifest';
const MANIFEST_META_KEY = 'media_manifest_meta';

let cachedManifest = null;
let speciesIndex = null;
let fetchInProgress = null;

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

function buildSpeciesIndex(manifest) {
  return new Map(manifest.species.map(entry => [entry.speciesCode, entry]));
}

/**
 * Load the manifest from chrome.storage.local into memory.
 * Returns null if not cached.
 */
async function loadCachedManifest() {
  return new Promise(resolve => {
    chrome.storage.local.get([MANIFEST_STORAGE_KEY, MANIFEST_META_KEY], result => {
      const manifest = result[MANIFEST_STORAGE_KEY];
      const meta = result[MANIFEST_META_KEY];
      if (manifest && meta) {
        resolve({ manifest, meta });
      } else {
        resolve(null);
      }
    });
  });
}

/**
 * Save the manifest to chrome.storage.local.
 */
async function saveManifestToStorage(manifest) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({
      [MANIFEST_STORAGE_KEY]: manifest,
      [MANIFEST_META_KEY]: {
        version: manifest.meta?.version,
        manifestUrl: CONFIG.MANIFEST_URL,
        cachedAt: Date.now(),
      }
    }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Fetch the manifest from R2, store it, and return it.
 * Deduplicates concurrent fetch calls.
 */
export async function fetchManifest() {
  if (fetchInProgress) {
    return fetchInProgress;
  }

  fetchInProgress = (async () => {
    try {
      log(`Fetching manifest from ${CONFIG.MANIFEST_URL}`);
      const response = await fetch(CONFIG.MANIFEST_URL);
      if (!response.ok) {
        throw new Error(`Manifest fetch failed: HTTP ${response.status}`);
      }

      const manifest = await response.json();
      log(`Manifest fetched: ${manifest.meta?.speciesCount} species, version ${manifest.meta?.version}`);

      await saveManifestToStorage(manifest);
      cachedManifest = manifest;
      speciesIndex = buildSpeciesIndex(manifest);

      return manifest;
    } finally {
      fetchInProgress = null;
    }
  })();

  return fetchInProgress;
}

/**
 * Get the manifest, using the in-memory cache, then chrome.storage.local,
 * then falling back to a network fetch.
 *
 * @param {Object} options
 * @param {boolean} options.forceRefresh - Skip caches and fetch from network
 * @returns {Promise<Object>} The manifest object
 */
export async function getManifest({ forceRefresh = false } = {}) {
  if (!forceRefresh && cachedManifest) {
    return cachedManifest;
  }

  if (!forceRefresh) {
    const stored = await loadCachedManifest();
    if (stored && stored.meta?.manifestUrl === CONFIG.MANIFEST_URL) {
      cachedManifest = stored.manifest;
      speciesIndex = buildSpeciesIndex(cachedManifest);
      log(`Manifest loaded from storage: ${cachedManifest.meta?.speciesCount} species`);
      return cachedManifest;
    }
  }

  return fetchManifest();
}

/**
 * Check whether the manifest is already cached (in storage or memory).
 * Does not trigger a network fetch.
 */
export async function isManifestCached() {
  if (cachedManifest) return true;
  const stored = await loadCachedManifest();
  return !!(stored && stored.meta?.manifestUrl === CONFIG.MANIFEST_URL);
}

/**
 * Get the ordered species code list for a region.
 */
export function getRegionSpeciesCodes(manifest, region = 'WLD') {
  return manifest.regions?.[region]?.speciesCodes ?? [];
}

/**
 * Get a random bird from the manifest for a given region,
 * adapted into the flat birdInfo shape.
 *
 * @param {string} region - Region code (default 'WLD')
 * @param {Set<string>} excludeCodes - Species codes to exclude (e.g., recently shown)
 * @returns {Promise<Object|null>} birdInfo object or null
 */
export async function getRandomBird(region = 'WLD', excludeCodes = null) {
  const manifest = await getManifest();
  if (!speciesIndex) {
    speciesIndex = buildSpeciesIndex(manifest);
  }

  let codes = getRegionSpeciesCodes(manifest, region);
  if (codes.length === 0) return null;

  if (excludeCodes && excludeCodes.size > 0) {
    const filtered = codes.filter(c => !excludeCodes.has(c));
    if (filtered.length > 0) codes = filtered;
  }

  const randomCode = codes[Math.floor(Math.random() * codes.length)];
  const entry = speciesIndex.get(randomCode);
  if (!entry) return null;

  return adaptSpeciesToBirdInfo(entry);
}

/**
 * Get a specific bird by species code, adapted into birdInfo shape.
 */
export async function getBirdByCode(speciesCode) {
  const manifest = await getManifest();
  if (!speciesIndex) {
    speciesIndex = buildSpeciesIndex(manifest);
  }
  const entry = speciesIndex.get(speciesCode);
  return entry ? adaptSpeciesToBirdInfo(entry) : null;
}

/**
 * Get all species for a region as birdInfo objects.
 * Useful for quiz mode.
 */
export async function getRegionBirds(region = 'WLD') {
  const manifest = await getManifest();
  if (!speciesIndex) {
    speciesIndex = buildSpeciesIndex(manifest);
  }

  const codes = getRegionSpeciesCodes(manifest, region);
  return codes
    .map(code => speciesIndex.get(code))
    .filter(Boolean)
    .map(adaptSpeciesToBirdInfo);
}

/**
 * Clear the manifest from in-memory and storage caches.
 * Called on region change or explicit cache clear.
 */
export async function clearManifestCache() {
  cachedManifest = null;
  speciesIndex = null;
  fetchInProgress = null;
  return new Promise(resolve => {
    chrome.storage.local.remove([MANIFEST_STORAGE_KEY, MANIFEST_META_KEY], resolve);
  });
}
