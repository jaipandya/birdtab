/**
 * Photo fallback: a new tab always shows a bird with a photo.
 *
 * The bird picked for a tab usually has its photo cached already (the ready
 * queue, background.js). When it doesn't (the queue ran dry, a region switch,
 * the cache was evicted), its photo starts downloading and the tab waits up to
 * PHOTO_DECIDE_MS (less than the loading overlay's delay) to see how that goes:
 *   - the server answers, or hasn't yet (a slow connection): the picked bird is
 *     drawn now and its photo appears when the download ends, however long
 *     that takes. A download that has started is never cut off.
 *   - the request fails (offline, media.birdtab.app unreachable, an error or a
 *     captive portal page instead of the photo): the tab shows a bird seen
 *     recently whose photo is cached, else one that ships with the extension.
 *     Offline with no cached photo, the picked bird stays: the page says it's
 *     offline and loads the photo by itself on reconnecting.
 *
 * The bird shown instead isn't new: it isn't added to History, Your Birds or
 * the bird held for the hour/day, so nothing is counted twice and the held bird
 * comes back once the photos load again.
 *
 * After a failed request, later tabs skip straight to a fallback for a short
 * while instead of each trying the network. So they do after media hangs (no
 * answer within PHOTO_ANSWER_TIMEOUT_MS) twice in that while; once could be
 * the connection.
 */

import { downloadMediaFile, isMediaCached } from './mediaCache.js';
import { getHistory } from './historyModal.js';
import { getBundledBird } from './mediaClient.js';
import { log } from './logger.js';

// How long a tab waits to learn whether the photo is coming: under the loading
// overlay's 1 s delay (loadingIndicators.js), so the page is never covered
export const PHOTO_DECIDE_MS = 600;
// No answer from the server by then: media is hanging, not just slow
export const PHOTO_ANSWER_TIMEOUT_MS = 8000;
// How long tabs skip the download after it failed
export const MEDIA_UNREACHABLE_MS = 2 * 60 * 1000;
// Recently shown birds to look through for a cached photo
const RECENT_BIRDS_LOOKED_AT = 20;

const STATE_KEY = 'photoFallback';

// Session storage (memory, cleared when the browser closes) where there is one
function stateArea() {
  return chrome.storage.session || chrome.storage.local;
}

async function readState() {
  try {
    const { [STATE_KEY]: state } = await stateArea().get(STATE_KEY);
    return state || {};
  } catch {
    return {};
  }
}

async function writeState(update) {
  try {
    const state = await readState();
    await stateArea().set({ [STATE_KEY]: { ...state, ...update } });
  } catch {
    // Only a missed shortcut: the next tab tries the network again
  }
}

/** Whether media failed in the last MEDIA_UNREACHABLE_MS. */
export async function isMediaUnreachable(now = Date.now()) {
  const { unreachableUntil = 0 } = await readState();
  return unreachableUntil > now;
}

/**
 * Remember how a download went, for the next tabs: a failed request or a
 * second hang marks media unreachable for a while; a photo that arrived
 * clears a hang.
 */
async function recordOutcome(result, answered) {
  const now = Date.now();
  if (result === 'cached') {
    await writeState({ hungAt: 0 });
  } else if (result === 'no-answer') {
    const { hungAt = 0 } = await readState();
    await writeState(now - hungAt < MEDIA_UNREACHABLE_MS
      ? { unreachableUntil: now + MEDIA_UNREACHABLE_MS, hungAt: 0 }
      : { hungAt: now });
  } else if (!answered && ['network', 'http', 'not-media'].includes(result)) {
    await writeState({ unreachableUntil: now + MEDIA_UNREACHABLE_MS });
  }
  // A download that broke off after the server answered is the connection,
  // not media being down: nothing to remember
}

/**
 * Start downloading a photo into the cache, retrying once at once if the
 * request fails (a dropped connection, a network change). Given up only if
 * the server doesn't answer within PHOTO_ANSWER_TIMEOUT_MS.
 * @returns {{ answered: Promise<string>, done: Promise<string> }}
 *   answered: 'answered' as soon as the photo is coming (or is cached), else
 *   how the download failed; done: the download's end, 'cached' or how it
 *   failed ('no-answer' when it timed out)
 */
function startPhotoDownload(url) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const signal = controller?.signal;
  let settleAnswer;
  const answered = new Promise(resolve => { settleAnswer = resolve; });
  let gotAnswer = false;
  let timedOut = false;
  const timer = controller && setTimeout(() => {
    if (gotAnswer) return;
    timedOut = true;
    controller.abort();
  }, PHOTO_ANSWER_TIMEOUT_MS);
  const onAnswer = (status) => {
    if (status !== 'answered' && status !== 'cached') return;
    gotAnswer = true;
    if (timer) clearTimeout(timer);
    settleAnswer('answered');
  };

  const done = (async () => {
    let result = await downloadMediaFile(url, { signal, onAnswer });
    if (result === 'network' && !gotAnswer && !signal?.aborted) {
      result = await downloadMediaFile(url, { signal, onAnswer });
    }
    if (timer) clearTimeout(timer);
    if (result === 'aborted' && timedOut) result = 'no-answer';
    settleAnswer(result); // no-op once answered
    await recordOutcome(result, gotAnswer);
    return result;
  })();
  return { answered, done };
}

/**
 * A recently shown bird whose photo is cached, other than the given species.
 * When there's a choice, not the bird of the last tab or the last fallback
 * either, so tabs during an outage don't keep repeating one bird.
 */
async function pickCachedRecentBird(excludeCode, lastFallbackCode) {
  const recent = (await getHistory()).slice(-RECENT_BIRDS_LOOKED_AT);
  const lastShownCode = recent[recent.length - 1]?.speciesCode;
  const byCode = new Map();
  for (const entry of recent) {
    if (!entry?.speciesCode || !entry.imageUrl || entry.speciesCode === excludeCode) continue;
    byCode.set(entry.speciesCode, entry); // the latest entry for each species
  }
  const cached = [];
  for (const entry of byCode.values()) {
    if (await isMediaCached(entry.imageUrl)) cached.push(entry);
  }
  if (cached.length === 0) return null;
  const fresh = cached.filter(entry =>
    entry.speciesCode !== lastFallbackCode && entry.speciesCode !== lastShownCode);
  const pool = fresh.length > 0 ? fresh : cached;
  const { timestamp, ...bird } = pool[Math.floor(Math.random() * pool.length)];
  return bird;
}

async function pickBundledBird(excludeCode, lastFallbackCode) {
  const recentCodes = new Set((await getHistory()).slice(-10).map(b => b.speciesCode));
  [excludeCode, lastFallbackCode].forEach(code => code && recentCodes.add(code));
  return getBundledBird(recentCodes);
}

/**
 * The bird a new tab shows: the one picked, or another with a cached photo
 * when the picked bird's photo can't be had.
 *
 * @param {Object|null} bird - the bird picked for this tab (null: none stored yet)
 * @param {Object} [options]
 * @param {boolean} [options.chosen] - picked by the user (History, Your Birds):
 *   shown as it is, with the usual notice if its photo doesn't load
 * @returns {Promise<{ bird: Object|null, fallback: null|'offline'|'unreachable',
 *   mediaUnreachable: boolean, photo: Promise<string>|null }>}
 *   fallback: why another bird is shown (null when it's the one picked);
 *   mediaUnreachable: media can't be downloaded right now (offline or a recent
 *   failure), so uncached recordings won't play; photo: the picked bird's photo
 *   download still under way ('cached' when it's in, else how it failed), to
 *   show the photo from once it ends
 */
export async function resolveShownBird(bird, { chosen = false } = {}) {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  try {
    const unreachable = offline || await isMediaUnreachable();
    // Nothing stored yet (the caller shows a bundled bird): offline, a recent
    // bird with its photo cached is better than another bundled one
    if (!bird) {
      const recent = offline ? await pickCachedRecentBird(null, null) : null;
      return { bird: recent, fallback: recent ? 'offline' : null, mediaUnreachable: unreachable, photo: null };
    }
    if (chosen || !bird.imageUrl || await isMediaCached(bird.imageUrl)) {
      return { bird, fallback: null, mediaUnreachable: unreachable, photo: null };
    }

    let reason;
    if (offline) {
      reason = 'offline';
    } else if (unreachable) {
      reason = 'unreachable';
    } else {
      const download = startPhotoDownload(bird.imageUrl);
      let decideTimer;
      const first = await Promise.race([
        download.answered,
        new Promise(resolve => { decideTimer = setTimeout(() => resolve('waiting'), PHOTO_DECIDE_MS); }),
      ]);
      clearTimeout(decideTimer);
      // Coming, or slow to answer, or no cache to put it in: draw the picked
      // bird now, its photo follows
      if (first === 'answered' || first === 'waiting' || first === 'unavailable') {
        return { bird, fallback: null, mediaUnreachable: false, photo: download.done };
      }
      await download.done; // its outcome is remembered for the next tabs
      reason = 'unreachable';
    }

    const { lastFallbackCode } = await readState();
    const recent = await pickCachedRecentBird(bird.speciesCode, lastFallbackCode);
    // Offline is the one outage with a known end: rather than a bundled bird,
    // keep the picked one, whose photo appears by itself once back online
    // (the page's offline notice). Often just a laptop waking up.
    if (!recent && reason === 'offline') {
      return { bird, fallback: null, mediaUnreachable: true, photo: null };
    }
    const fallback = recent || await pickBundledBird(bird.speciesCode, lastFallbackCode);
    await writeState({ lastFallbackCode: fallback.speciesCode });
    log(`Photo of ${bird.name} unavailable (${reason}), showing ${fallback.name} instead`);
    return { bird: fallback, fallback: reason, mediaUnreachable: true, photo: null };
  } catch (error) {
    // Never keep a tab from showing its bird
    log(`Photo fallback failed: ${error.message}`);
    return { bird, fallback: null, mediaUnreachable: offline, photo: null };
  }
}
