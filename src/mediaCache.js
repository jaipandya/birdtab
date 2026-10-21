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

/**
 * A response that isn't the media file itself: a captive portal or proxy page
 * reached through a redirect, or an HTML/JSON error page. Media files are
 * served directly (no redirect) as image/* or audio/*.
 */
function isNotMedia(response) {
  if (response.redirected) return true;
  const type = response.headers.get('content-type') || '';
  return /^text\/|html|json/i.test(type);
}

/**
 * Download one file into the cache.
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {Function} [options.onAnswer] - called once the server has answered
 *   with the file ('answered', the body still downloading), when it's already
 *   cached ('cached'), or with the failure below
 * @returns {Promise<'cached'|'network'|'http'|'not-media'|'aborted'|'unavailable'>}
 *   'network' when the request failed (offline, DNS, TLS, refused, dropped);
 *   'http' for an error status; 'not-media' for a page that isn't the file;
 *   'unavailable' when the cache couldn't take it (storage full)
 */
async function cacheUrl(cache, url, { signal, onAnswer = () => {} } = {}) {
  if (isPackaged(url) || await cache.match(url)) {
    onAnswer('cached');
    return 'cached';
  }
  let response;
  try {
    // CORS mode (the default): an opaque no-cors response can't be read back as a blob
    response = await fetch(url, signal ? { signal } : undefined);
  } catch (error) {
    const status = error?.name === 'AbortError' ? 'aborted' : 'network';
    onAnswer(status);
    return status;
  }
  const status = !response.ok ? 'http' : isNotMedia(response) ? 'not-media' : 'answered';
  onAnswer(status);
  if (status !== 'answered') return status;
  try {
    // Reads the body: fails if the connection drops or the signal aborts
    await cache.put(url, response);
  } catch (error) {
    if (error?.name === 'AbortError') return 'aborted';
    if (error?.name === 'QuotaExceededError') return 'unavailable';
    return 'network';
  }
  return 'cached';
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
    return !!cache && await cacheUrl(cache, url) === 'cached';
  } catch (error) {
    log(`Caching ${url} failed: ${error.message}`);
    return false;
  }
}

/**
 * Download one media file into the cache, saying why when it can't.
 * @param {string} url
 * @param {{ signal?: AbortSignal, onAnswer?: Function }} [options] - see cacheUrl
 * @returns {Promise<'cached'|'network'|'http'|'not-media'|'aborted'|'unavailable'>}
 *   'unavailable' also when there's no Cache Storage
 */
export async function downloadMediaFile(url, { signal, onAnswer = () => {} } = {}) {
  try {
    const cache = url ? await openCache() : null;
    if (!cache) {
      onAnswer('unavailable');
      return 'unavailable';
    }
    return await cacheUrl(cache, url, { signal, onAnswer });
  } catch (error) {
    log(`Caching ${url} failed: ${error.message}`);
    onAnswer('unavailable');
    return 'unavailable';
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
    result.image = await cacheUrl(cache, bird.imageUrl) === 'cached';
    if (result.image && bird.mediaUrl) {
      result.audio = await cacheUrl(cache, bird.mediaUrl) === 'cached';
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
 * Drop a cached file that turned out unusable (a photo that won't decode), and
 * the blob URL handed out for it, so the next try goes to the network.
 * @param {string} url
 * @returns {Promise<boolean>} whether a cached copy was removed
 */
export async function forgetCachedMedia(url) {
  if (!url || isPackaged(url)) return false;
  if (objectUrls.has(url)) {
    URL.revokeObjectURL(objectUrls.get(url));
    objectUrls.delete(url);
  }
  try {
    const cache = await openCache();
    return !!cache && await cache.delete(url);
  } catch {
    return false;
  }
}

/**
 * Release the blob URLs handed out so far (when the page moves to a new bird).
 */
export function revokeMediaUrls() {
  objectUrls.forEach(objectUrl => URL.revokeObjectURL(objectUrl));
  objectUrls.clear();
}
