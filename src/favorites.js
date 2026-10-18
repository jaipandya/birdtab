/**
 * Favourite birds (CONFIG.FEATURES.favorites)
 *
 * The list of species codes is in chrome.storage.sync ('favoriteSpecies', newest
 * first), so favourites follow the user to their other computers. Sync allows
 * 8 KB per item: about 700 codes, far more than anyone keeps. The bird's details
 * (photo, credits) are cached in chrome.storage.local ('favoriteBirds'); on a
 * computer without them, the stored manifests fill in what they can.
 */

import CONFIG from './config.js';
import { getBirdByCode, getSelectedRegion } from './mediaClient.js';
import { log } from './logger.js';

const SYNC_KEY = 'favoriteSpecies';
const LOCAL_KEY = 'favoriteBirds';
const MAX_FAVORITES = 500;

async function getCodes() {
  try {
    const { [SYNC_KEY]: codes } = await chrome.storage.sync.get([SYNC_KEY]);
    return Array.isArray(codes) ? codes : [];
  } catch {
    return [];
  }
}

export async function isFavorite(speciesCode) {
  if (!CONFIG.FEATURES.favorites || !speciesCode) return false;
  return (await getCodes()).includes(speciesCode);
}

/**
 * Add or remove a bird.
 * @returns {Promise<boolean>} whether it is a favourite now
 */
export async function toggleFavorite(bird) {
  const code = bird?.speciesCode;
  if (!code) return false;
  const codes = await getCodes();
  const { [LOCAL_KEY]: details = {} } = await chrome.storage.local.get([LOCAL_KEY]);
  let favorite;
  if (codes.includes(code)) {
    codes.splice(codes.indexOf(code), 1);
    delete details[code];
    favorite = false;
  } else {
    codes.unshift(code);
    codes.length = Math.min(codes.length, MAX_FAVORITES);
    details[code] = { ...bird, favoritedAt: Date.now() };
    favorite = true;
  }
  await chrome.storage.sync.set({ [SYNC_KEY]: codes });
  await chrome.storage.local.set({ [LOCAL_KEY]: details });
  return favorite;
}

/**
 * Favourite birds, newest first, as birdInfo. A bird known only by its code
 * (favourited on another computer, not in any stored manifest) comes back with
 * just `speciesCode` and `name`.
 */
export async function getFavorites() {
  const codes = await getCodes();
  if (codes.length === 0) return [];
  const { [LOCAL_KEY]: details = {} } = await chrome.storage.local.get([LOCAL_KEY]);
  let region = null;
  const birds = [];
  for (const code of codes) {
    if (details[code]) {
      birds.push(details[code]);
      continue;
    }
    try {
      region = region || await getSelectedRegion();
      const bird = await getBirdByCode(code, region) || await getBirdByCode(code);
      birds.push(bird || { speciesCode: code, name: code });
    } catch (error) {
      log(`Favourite ${code} not in stored manifests: ${error.message}`);
      birds.push({ speciesCode: code, name: code });
    }
  }
  return birds;
}

/** Remove every favourite (on all the user's computers: the list is synced). */
export async function clearFavorites() {
  await chrome.storage.sync.set({ [SYNC_KEY]: [] });
  await chrome.storage.local.remove([LOCAL_KEY]);
}
