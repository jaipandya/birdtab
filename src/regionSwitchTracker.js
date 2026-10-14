/**
 * Region Switch Tracker (background)
 *
 * Runs region switches for the settings sidebar and mirrors their state in
 * chrome.storage.session under one key, so a settings panel opened (or
 * reopened) mid-download can show progress or a failure:
 *
 *   regionSwitchState = { code, state: 'loading'|'failed', received, expected, updatedAt, error? }
 *
 * The key is removed when a switch succeeds or another switch supersedes it.
 * Progress writes are throttled; while a switch is loading, a heartbeat also
 * refreshes updatedAt, so readers can tell a stopped service worker (no
 * update for REGION_SWITCH_STALE_MS) from a slow download, and the writes
 * keep the MV3 service worker alive.
 */

import { CONFIG } from './config.js';
import { log } from './logger.js';
import { switchRegion, getStoredIndex } from './mediaClient.js';

export const REGION_SWITCH_STATE_KEY = 'regionSwitchState';
// A 'loading' state not updated for this long means the switch stopped
export const REGION_SWITCH_STALE_MS = 30 * 1000;
const PROGRESS_WRITE_INTERVAL_MS = 250;
const HEARTBEAT_INTERVAL_MS = 10 * 1000;

const WORLD = CONFIG.MEDIA.DEFAULT_REGION;

function sessionArea() {
  return chrome.storage?.session ?? null;
}

function writeState(state) {
  const area = sessionArea();
  if (!area) return Promise.resolve();
  return area.set({ [REGION_SWITCH_STATE_KEY]: state }).catch(error => {
    log(`Could not store the region switch state: ${error.message}`);
  });
}

function clearState() {
  const area = sessionArea();
  if (!area) return Promise.resolve();
  return area.remove(REGION_SWITCH_STATE_KEY).catch(error => {
    log(`Could not clear the region switch state: ${error.message}`);
  });
}

// The switch this tracker reports: { code, token, promise }
let active = null;
let nextToken = 0;

/**
 * Switch region and keep regionSwitchState up to date.
 * @returns {Promise<{success: boolean, superseded?: boolean, region?: string, previousRegion?: string, error?: string}>}
 */
export function trackRegionSwitch(code) {
  // Same region already loading: share it (no second tracker)
  if (active && active.code === code) return active.promise;

  const token = ++nextToken;
  const isCurrent = () => active?.token === token;
  const current = { code, token };
  active = current;

  let state = null;
  let lastWriteAt = 0;
  let heartbeat = null;
  const stopHeartbeat = () => clearInterval(heartbeat);

  const write = () => {
    if (!isCurrent() || !state) return;
    lastWriteAt = Date.now();
    state = { ...state, updatedAt: lastWriteAt };
    writeState(state);
  };

  current.promise = (async () => {
    if (code === WORLD) {
      // Immediate; supersedes and clears whatever was loading
      await clearState();
    } else {
      const index = await getStoredIndex().catch(() => null);
      const bytes = index?.regions?.find(r => r.code === code)?.bytes;
      state = { code, state: 'loading', received: 0, expected: bytes > 0 ? bytes : null };
      write();
      heartbeat = setInterval(write, HEARTBEAT_INTERVAL_MS);
    }

    const onProgress = (received, expected) => {
      if (!state) return;
      state = { ...state, received, expected: expected ?? state.expected };
      // Throttled; a restarted attempt (received 0) always shows
      if (received === 0 || Date.now() - lastWriteAt >= PROGRESS_WRITE_INTERVAL_MS) write();
    };

    try {
      const result = await switchRegion(code, { onProgress });
      stopHeartbeat();
      if (result.superseded) {
        // The superseding switch owns the state now
        return { success: false, superseded: true, region: code };
      }
      if (isCurrent()) await clearState();
      return { success: true, ...result };
    } catch (error) {
      stopHeartbeat();
      if (isCurrent()) {
        await writeState({
          code,
          state: 'failed',
          received: state?.received ?? 0,
          expected: state?.expected ?? null,
          updatedAt: Date.now(),
          error: error.message,
        });
      }
      return { success: false, error: error.message };
    } finally {
      if (isCurrent()) active = null;
    }
  })();

  return current.promise;
}
