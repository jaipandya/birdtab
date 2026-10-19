/**
 * The birds you've seen (CONFIG.FEATURES.yourBirds)
 *
 * Every species BirdTab has shown, once each, with when it was first and last
 * seen: the list behind "Your Birds". Each species has its own key in
 * chrome.storage.local ('seen:<code>': { bird, firstSeen, lastSeen }), so a new
 * tab reads and writes one small entry however long the list grows. It's filled
 * from the viewing history the first time, so nobody starts at zero.
 *
 * The viewing history (historyModal.js) stays underneath for the page's own use:
 * the offline fallback and not repeating recent birds.
 */

import CONFIG from './config.js';
import { getHistory, clearHistory } from './historyModal.js';

const PREFIX = 'seen:';
const BACKFILLED_KEY = 'seenBirdsBackfilled';
// How many different birds: kept as a number so a new tab never has to list every key
// (storage.getKeys() is Chrome 130+ / Firefox 143+; without it listing reads all of storage)
const COUNT_KEY = 'seenBirdsCount';

const keyFor = (code) => `${PREFIX}${code}`;

async function allSeenKeys() {
  const keys = typeof chrome.storage.local.getKeys === 'function'
    ? await chrome.storage.local.getKeys()
    : Object.keys(await chrome.storage.local.get(null));
  return keys.filter(key => key.startsWith(PREFIX));
}

async function backfill() {
  const { [BACKFILLED_KEY]: done } = await chrome.storage.local.get([BACKFILLED_KEY]);
  if (done) return;
  const entries = {};
  for (const bird of await getHistory()) {
    if (!bird?.speciesCode) continue;
    const key = keyFor(bird.speciesCode);
    const seenAt = bird.timestamp || Date.now();
    const { timestamp, ...info } = bird;
    entries[key] = entries[key]
      ? { ...entries[key], bird: info, lastSeen: seenAt }
      : { bird: info, firstSeen: seenAt, lastSeen: seenAt };
  }
  await chrome.storage.local.set({ ...entries, [BACKFILLED_KEY]: true, [COUNT_KEY]: Object.keys(entries).length });
}

/**
 * Note that a bird was shown.
 * @returns {Promise<number|null>} how many different birds have been seen, when this one is new; else null
 */
export async function recordSighting(bird) {
  if (!CONFIG.FEATURES.yourBirds || !bird?.speciesCode) return null;
  await backfill();
  const key = keyFor(bird.speciesCode);
  const { [key]: entry, [COUNT_KEY]: count = 0 } = await chrome.storage.local.get([key, COUNT_KEY]);
  const now = Date.now();
  const { autoPlay, ...info } = bird;
  const update = { [key]: { bird: info, firstSeen: entry?.firstSeen ?? now, lastSeen: now } };
  if (!entry) update[COUNT_KEY] = count + 1;
  await chrome.storage.local.set(update);
  return entry ? null : count + 1;
}

/**
 * Every bird seen, most recently seen first.
 * @returns {Promise<Array<{ bird: Object, firstSeen: number, lastSeen: number }>>}
 */
export async function getSeenBirds() {
  await backfill();
  const keys = await allSeenKeys();
  if (keys.length === 0) return [];
  const entries = await chrome.storage.local.get(keys);
  const birds = Object.values(entries)
    .filter(entry => entry?.bird?.speciesCode)
    .sort((a, b) => b.lastSeen - a.lastSeen);
  // Keep the running count true to the list
  await chrome.storage.local.set({ [COUNT_KEY]: birds.length });
  return birds;
}

/** Empty the list (and the viewing history under it). Favourites aren't touched. */
export async function clearSeenBirds() {
  await chrome.storage.local.remove(await allSeenKeys());
  await clearHistory();
  await chrome.storage.local.set({ [BACKFILLED_KEY]: true, [COUNT_KEY]: 0 });
}

// A quiet note when the count reaches a round number. No streaks.
const MILESTONES = new Set([10, 25, 50, 100, 150, 200, 300, 400, 500, 750, 1000]);

export function showSeenMilestone(count, { force = false } = {}) {
  if (!force && !MILESTONES.has(count)) return;
  const note = document.createElement('div');
  note.className = 'life-list-milestone';
  note.setAttribute('role', 'status');
  note.textContent = chrome.i18n.getMessage('yourBirdsMilestone', [String(count)]) || `${count} different birds seen!`;
  document.body.appendChild(note);
  setTimeout(() => note.classList.add('fade-out'), 5000);
  setTimeout(() => note.remove(), 5600);
}
