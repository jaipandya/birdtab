/**
 * Media Cache Module
 *
 * Keeps the image and audio of upcoming and recently shown birds in Cache
 * Storage, so new tabs still show a bird when the network is gone. Media files
 * are named by a hash of their bytes and served as immutable, so a cached copy
 * never goes stale.
 *
 * The service worker fills the cache. Extension pages aren't controlled by a
 * service worker, so <img>/<audio> never consult Cache Storage on their own:
 * pages read a cached file here and show it through a blob URL.
 *
 * Chrome can evict the cache under storage pressure, so callers treat "is it
 * cached?" as something to check, not something to remember.
 */

import { log } from './logger.js';

const CACHE_NAME = 'birdtab-media-v1';

// Files packaged with the extension (bundled birds) have relative or
// chrome-extension URLs: always available, and Cache Storage can't hold them
function isPackaged(url) {
  return !/^https?:\/\//.test(url);
}

function hasCacheStorage() {
  return typeof caches !== 'undefined';
}

async function openCache() {
  return hasCacheStorage() ? caches.open(CACHE_NAME) : null;
}

/**
 * Whether a media file is in the cache.
 * @param {string} url
 * @returns {Promise<boolean>}
 */
export async function isMediaCached(url) {
  if (!url) return false;
  if (isPackaged(url)) return true;
  try {
    const cache = await openCache();
    return !!(cache && await cache.match(url));
  } catch {
    return false;
  }
}

async function cacheUrl(cache, url) {
  if (isPackaged(url)) return true;
  if (await cache.match(url)) return true;
  // CORS mode (the default): an opaque no-cors response can't be read back as a blob
  const response = await fetch(url);
  if (!response.ok) return false;
  await cache.put(url, response);
  return true;
}

/**
 * Download one media file into the cache (no-op when it's already there).
 * @param {string} url
 * @returns {Promise<boolean>} whether the file is now cached
 */
export async function cacheMediaFile(url) {
  if (!url) return false;
  try {
    const cache = await openCache();
    return !!cache && await cacheUrl(cache, url);
  } catch (error) {
    log(`Caching ${url} failed: ${error.message}`);
    return false;
  }
}

/**
 * Download a bird's image, then its audio, into the cache. The audio is only
 * fetched once the image is in, so a failing network gives up quickly.
 * @param {Object} bird - birdInfo with imageUrl and optional mediaUrl
 * @returns {Promise<{image: boolean, audio: boolean}>} what is now cached
 */
export async function cacheBirdMedia(bird) {
  const result = { image: false, audio: false };
  if (!bird?.imageUrl) return result;
  try {
    const cache = await openCache();
    if (!cache) return result;
    result.image = await cacheUrl(cache, bird.imageUrl);
    if (result.image && bird.mediaUrl) {
      result.audio = await cacheUrl(cache, bird.mediaUrl);
    }
  } catch (error) {
    log(`Caching media for ${bird.speciesCode} failed: ${error.message}`);
  }
  return result;
}

/**
 * Remove every cached file whose URL isn't in keepUrls.
 * @param {Array<string>} keepUrls
 * @returns {Promise<number>} number of files removed
 */
export async function pruneMediaCache(keepUrls) {
  const cache = await openCache();
  if (!cache) return 0;
  const keep = new Set(keepUrls.filter(Boolean));
  let removed = 0;
  for (const request of await cache.keys()) {
    if (!keep.has(request.url)) {
      await cache.delete(request);
      removed++;
    }
  }
  return removed;
}

/**
 * Delete the whole media cache.
 */
export async function clearMediaCache() {
  if (hasCacheStorage()) {
    await caches.delete(CACHE_NAME);
  }
}

// Page side: original URL -> blob URL handed out for it
const objectUrls = new Map();

/**
 * The URL a page should load a media file from: a blob URL of the cached copy
 * when there is one, else the original URL.
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function resolveMediaUrl(url) {
  if (!url || isPackaged(url)) return url;
  if (objectUrls.has(url)) return objectUrls.get(url);
  try {
    const cache = await openCache();
    const response = cache && await cache.match(url);
    if (!response) return url;
    const objectUrl = URL.createObjectURL(await response.blob());
    objectUrls.set(url, objectUrl);
    return objectUrl;
  } catch {
    return url;
  }
}

/**
 * Release the blob URLs handed out so far (when the page moves to a new bird).
 */
export function revokeMediaUrls() {
  objectUrls.forEach(objectUrl => URL.revokeObjectURL(objectUrl));
  objectUrls.clear();
}
