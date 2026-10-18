/**
 * "Change the bird" (CONFIG.FEATURES.birdRotation): a new bird on every
 * new tab (default), or the same bird for an hour, or for the day.
 *
 * A held bird is shown again as-is: it isn't taken from the ready queue, added
 * to History again or counted again in the life list. Refresh (a reload) and
 * picking a bird from History always change it.
 */

import CONFIG from './config.js';

export const BIRD_ROTATION_MODES = ['every', 'hourly', 'daily'];

const HOUR_MS = 60 * 60 * 1000;

function isFreshNewTab() {
  const nav = performance.getEntriesByType?.('navigation')?.[0];
  return !nav || nav.type === 'navigate';
}

export function isHoldExpired(mode, shownAt, now = Date.now()) {
  if (!shownAt) return true;
  if (mode === 'hourly') return now - shownAt >= HOUR_MS;
  if (mode === 'daily') return new Date(shownAt).toDateString() !== new Date(now).toDateString();
  return true;
}

/**
 * The bird to show again on this tab, or null for a new one.
 * @returns {Promise<Object|null>} birdInfo
 */
export async function getHeldBird() {
  if (!CONFIG.FEATURES.birdRotation || !isFreshNewTab()) return null;
  const { birdRotation = 'every', currentBird, autoPlay = false } =
    await chrome.storage.local.get(['birdRotation', 'currentBird', 'autoPlay']);
  if (birdRotation === 'every' || !currentBird?.bird) return null;
  if (isHoldExpired(birdRotation, currentBird.shownAt)) return null;
  return { ...currentBird.bird, autoPlay };
}

/** Remember the bird shown on this tab, so the next tabs can hold it. */
export async function rememberShownBird(bird) {
  if (!CONFIG.FEATURES.birdRotation || !bird) return;
  await chrome.storage.local.set({ currentBird: { bird, shownAt: Date.now() } });
}
