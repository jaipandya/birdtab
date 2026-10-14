/**
 * Background region switches mirrored in chrome.storage.session
 * (regionSwitchState): progress, throttling, failure, supersede, success.
 */

import {
  releaseRoutes,
  regionUrl,
  regionManifest,
  installMocks,
  streamingResponse,
} from './fixtures/mediaRelease.js';

const R1 = 'm261020r01';
const KEY = 'regionSwitchState';

let client;
let tracker;
let mocks;
let downloads;

async function settle(until = () => false) {
  for (let i = 0; i < 200 && !until(); i++) {
    await Promise.resolve();
  }
}

function manualRoute(name) {
  return init => {
    downloads[name] = streamingResponse({ signal: init.signal });
    return downloads[name].response;
  };
}

async function setup(region = 'WLD') {
  mocks = installMocks({ storage: { region }, routes: releaseRoutes(R1) });
  jest.resetModules();
  const { CONFIG } = require('../config.js');
  CONFIG.MEDIA.RETRY_BASE_DELAY_MS = 0;
  CONFIG.MEDIA.FALLBACK_INDEX_URL = null;
  client = require('../mediaClient.js');
  tracker = require('../regionSwitchTracker.js');
  await client.ensureMedia();
  downloads = {};
  mocks.routes[regionUrl(R1, 'IN')] = manualRoute('IN');
  mocks.routes[regionUrl(R1, 'US')] = manualRoute('US');
}

function sessionState() {
  return mocks.session.data[KEY];
}

afterEach(() => jest.useRealTimers());

test('writes loading progress against the index size, then clears it on success', async () => {
  await setup();
  jest.useFakeTimers({ now: 1000000 });

  const result = tracker.trackRegionSwitch('IN');
  await settle(() => downloads.IN);
  await settle();
  expect(sessionState()).toMatchObject({ code: 'IN', state: 'loading', received: 0, expected: 1000 });

  const body = JSON.stringify(regionManifest(R1, 'IN'));
  await jest.advanceTimersByTimeAsync(300);
  downloads.IN.push(body.slice(0, 420));
  await settle();
  expect(sessionState()).toMatchObject({ code: 'IN', state: 'loading', received: 420, expected: 1000, updatedAt: 1000300 });

  downloads.IN.push(body.slice(420));
  downloads.IN.end();

  await expect(result).resolves.toEqual({ success: true, region: 'IN', previousRegion: 'WLD' });
  expect(sessionState()).toBeUndefined();
  expect(mocks.data.region).toBe('IN');
});

test('progress writes are throttled to about four a second', async () => {
  await setup();
  jest.useFakeTimers({ now: 1000000 });

  tracker.trackRegionSwitch('IN');
  await settle(() => downloads.IN);
  mocks.session.set.mockClear();

  // 20 chunks within 100 ms: at most one write
  for (let i = 0; i < 20; i++) {
    downloads.IN.push(' ');
    await jest.advanceTimersByTimeAsync(5);
  }
  expect(mocks.session.set.mock.calls.length).toBeLessThanOrEqual(1);

  await jest.advanceTimersByTimeAsync(300);
  downloads.IN.push(' ');
  await settle();
  expect(sessionState().received).toBe(21);
});

test('a heartbeat refreshes updatedAt while no bytes arrive', async () => {
  await setup();
  jest.useFakeTimers({ now: 1000000 });

  tracker.trackRegionSwitch('IN');
  await settle(() => downloads.IN);
  const first = sessionState().updatedAt;

  await jest.advanceTimersByTimeAsync(10000);
  expect(sessionState().updatedAt).toBe(first + 10000);
});

test('a failure is stored with its error until the next switch', async () => {
  await setup();
  mocks.routes[regionUrl(R1, 'IN')] = 404;

  const result = await tracker.trackRegionSwitch('IN');

  expect(result).toEqual({ success: false, error: expect.stringContaining('HTTP 404') });
  expect(sessionState()).toMatchObject({ code: 'IN', state: 'failed', error: expect.stringContaining('404') });
  expect(mocks.data.region).toBe('WLD');

  // Picking World replaces the failure
  await expect(tracker.trackRegionSwitch('WLD')).resolves.toMatchObject({ success: true, region: 'WLD' });
  expect(sessionState()).toBeUndefined();
});

test('A then B: A answers superseded; the state follows B and is cleared when B is stored', async () => {
  await setup();

  const toIndia = tracker.trackRegionSwitch('IN');
  await settle(() => downloads.IN);
  const toUs = tracker.trackRegionSwitch('US');

  await expect(toIndia).resolves.toEqual({ success: false, superseded: true, region: 'IN' });
  expect(downloads.IN.aborted).toBe(true);
  await settle(() => downloads.US);
  expect(sessionState()).toMatchObject({ code: 'US', state: 'loading' });

  downloads.US.push(JSON.stringify(regionManifest(R1, 'US')));
  downloads.US.end();
  await expect(toUs).resolves.toMatchObject({ success: true, region: 'US' });
  expect(sessionState()).toBeUndefined();
  expect(mocks.data.region).toBe('US');
});

test('A then A: one switch, one fetch, the same answer', async () => {
  await setup();
  global.fetch.mockClear();

  const first = tracker.trackRegionSwitch('IN');
  await settle(() => downloads.IN);
  const second = tracker.trackRegionSwitch('IN');
  expect(second).toBe(first);

  downloads.IN.push(JSON.stringify(regionManifest(R1, 'IN')));
  downloads.IN.end();
  await expect(second).resolves.toMatchObject({ success: true, region: 'IN' });
  expect(mocks.fetchedUrls()).toEqual([regionUrl(R1, 'IN')]);
});

test('World cancels a pending switch and clears its state at once', async () => {
  await setup('US');

  const toIndia = tracker.trackRegionSwitch('IN');
  await settle(() => downloads.IN);
  expect(sessionState()).toMatchObject({ code: 'IN', state: 'loading' });

  await expect(tracker.trackRegionSwitch('WLD')).resolves.toMatchObject({ success: true, region: 'WLD' });
  await expect(toIndia).resolves.toMatchObject({ superseded: true });
  expect(sessionState()).toBeUndefined();
  expect(mocks.data.region).toBe('WLD');
});
