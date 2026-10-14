/**
 * Media client: release discovery, fallback, release and region switches,
 * cache pruning, schema/minExtensionVersion gating, and the upgrade from a
 * 2.0.x (schema 1) storage state.
 */

import {
  CURRENT_URL,
  LEGACY_URL,
  currentJson,
  indexJson,
  indexUrl,
  regionUrl,
  regionManifest,
  releaseRoutes,
  legacyManifest,
  schema1StorageState,
  installMocks,
  streamingResponse,
} from './fixtures/mediaRelease.js';

const R1 = 'm261020r01';
const R2 = 'm261101r01';
const HOUR = 60 * 60 * 1000;

let client;
let CONFIG;
let mocks;

function load({ storage, routes, version, fallbackRelease = null } = {}) {
  mocks = installMocks({ storage, routes, version });
  jest.resetModules();
  CONFIG = require('../config.js').CONFIG;
  CONFIG.MEDIA.RETRY_BASE_DELAY_MS = 0;
  CONFIG.MEDIA.FALLBACK_INDEX_URL = fallbackRelease ? indexUrl(fallbackRelease) : null;
  client = require('../mediaClient.js');
  return mocks;
}

/** Let pending promise chains (storage mocks, fetch) run. */
async function settle(until = () => false) {
  for (let i = 0; i < 200 && !until(); i++) {
    await Promise.resolve();
  }
}

/** Route whose body the test streams by hand: downloads[name] is set when fetched. */
function manualRoute(downloads, name, headers = {}) {
  return init => {
    downloads[name] = streamingResponse({ signal: init.signal, headers });
    return downloads[name].response;
  };
}

function storedKeys() {
  return Object.keys(mocks.data).filter(k => k.startsWith('media_')).sort();
}

describe('compareVersions', () => {
  beforeEach(() => load());

  test('compares dotted versions numerically', () => {
    expect(client.compareVersions('2.1.0', '2.10.0')).toBe(-1);
    expect(client.compareVersions('2.10.0', '2.9.9')).toBe(1);
    expect(client.compareVersions('2.1', '2.1.0')).toBe(0);
    expect(client.compareVersions('2.1.0', '2.1.0')).toBe(0);
  });

  test('isUsableReleaseDoc gates on schema and minExtensionVersion', () => {
    expect(client.isUsableReleaseDoc(currentJson(R1), '2.1.0')).toBe(true);
    expect(client.isUsableReleaseDoc(currentJson(R1, { minExtensionVersion: '2.10.0' }), '2.9.0')).toBe(false);
    expect(client.isUsableReleaseDoc(currentJson(R1, { schemaVersion: 3 }), '2.1.0')).toBe(false);
    expect(client.isUsableReleaseDoc(null)).toBe(false);
  });
});

describe('release discovery', () => {
  test('fresh install: follows current.json and stores index and World', async () => {
    load({ routes: releaseRoutes(R1) });

    const result = await client.ensureMedia();

    expect(result).toEqual({ ready: true, schema: 2, release: R1 });
    expect(storedKeys()).toEqual(['media_discovery', 'media_region_WLD', 'media_release']);
    expect(mocks.data.media_release.release).toBe(R1);
    expect(mocks.data.media_release.index.regions.map(r => r.code)).toEqual(['WLD', 'IN', 'US']);
    expect(mocks.fetchedUrls()).not.toContain(regionUrl(R1, 'IN'));
    expect(mocks.fetchedUrls()).not.toContain(LEGACY_URL);

    const bird = await client.getRandomBird('WLD');
    expect(bird.location).toBe('WLD');
    expect(mocks.data.media_region_WLD.regions.WLD.speciesCodes).toContain(bird.speciesCode);
  });

  test('fresh install with a selected country stores that region and World', async () => {
    load({ storage: { region: 'IN' }, routes: releaseRoutes(R1) });

    await client.ensureMedia();

    expect(storedKeys()).toEqual(['media_discovery', 'media_region_IN', 'media_region_WLD', 'media_release']);
    const bird = await client.getRandomBird('IN');
    expect(bird.location).toBe('IN');
    expect(regionManifest(R1, 'IN').regions.IN.speciesCodes).toContain(bird.speciesCode);
  });

  test('uses the built-in fallback index when current.json is missing', async () => {
    load({ routes: releaseRoutes(R1, ['WLD', 'IN'], { withCurrent: false }), fallbackRelease: R1 });

    const result = await client.ensureMedia();

    expect(result.release).toBe(R1);
    expect(mocks.data.media_release.indexUrl).toBe(indexUrl(R1));
  });

  test('uses the built-in fallback index when current.json is unreachable', async () => {
    const routes = releaseRoutes(R1, ['WLD'], { withCurrent: false });
    routes[CURRENT_URL] = new TypeError('Failed to fetch');
    load({ routes, fallbackRelease: R1 });

    const result = await client.ensureMedia();

    expect(result).toEqual({ ready: true, schema: 2, release: R1 });
    // retried with backoff: 1 attempt + 2 retries
    expect(mocks.fetchedUrls().filter(u => u === CURRENT_URL)).toHaveLength(3);
  });

  test('falls back to the schema 1 manifest when no schema 2 release is reachable', async () => {
    load({ routes: { [LEGACY_URL]: legacyManifest() } });

    const result = await client.ensureMedia();

    expect(result).toEqual({ ready: true, schema: 1, release: null });
    expect(mocks.data.media_manifest_meta.manifestUrl).toBe(LEGACY_URL);
    const bird = await client.getRandomBird('WLD');
    expect(bird.speciesCode).toMatch(/^oldbird/);
  });

  test('reports not ready when nothing at all is reachable', async () => {
    load({ routes: {} });
    const reporter = jest.fn();
    client.setErrorReporter(reporter);

    const result = await client.ensureMedia();

    expect(result.ready).toBe(false);
    await expect(client.getRandomBird('WLD')).rejects.toThrow('No bird manifest available');
    expect(reporter).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ operation: 'fetchLegacyManifest' }));
  });

  test('checks current.json at most once a day unless forced', async () => {
    load({ routes: releaseRoutes(R1) });
    await client.ensureMedia();
    global.fetch.mockClear();

    await client.ensureMedia();
    expect(global.fetch).not.toHaveBeenCalled();

    mocks.data.media_discovery.lastCheckedAt = Date.now() - 23 * HOUR;
    await client.ensureMedia();
    expect(global.fetch).not.toHaveBeenCalled();

    mocks.data.media_discovery.lastCheckedAt = Date.now() - 25 * HOUR;
    await client.ensureMedia();
    expect(mocks.fetchedUrls()).toEqual([CURRENT_URL]);

    global.fetch.mockClear();
    await client.refreshRelease({ force: true });
    expect(mocks.fetchedUrls()).toEqual([CURRENT_URL]);
  });

  test('concurrent refreshes share one request', async () => {
    load({ routes: releaseRoutes(R1) });
    await Promise.all([client.refreshRelease(), client.refreshRelease(), client.ensureMedia()]);
    expect(mocks.fetchedUrls().filter(u => u === CURRENT_URL)).toHaveLength(1);
  });
});

describe('release switch', () => {
  async function installR1(region = 'WLD') {
    load({ storage: { region }, routes: releaseRoutes(R1) });
    await client.ensureMedia();
    mocks.data.media_discovery.lastCheckedAt = 0;
  }

  function publishR2(codes = ['WLD', 'IN', 'US']) {
    Object.assign(mocks.routes, releaseRoutes(R2, codes));
  }

  test('switches only after the new index and region manifests are stored', async () => {
    await installR1('IN');
    publishR2();

    const result = await client.refreshRelease();

    expect(result).toEqual({ status: 'switched', release: R2 });
    expect(mocks.data.media_release.release).toBe(R2);
    expect(mocks.data.media_region_WLD.meta.release).toBe(R2);
    expect(mocks.data.media_region_IN.meta.release).toBe(R2);
    expect(storedKeys()).toEqual(['media_discovery', 'media_region_IN', 'media_region_WLD', 'media_release']);

    // index and manifests were written together
    const switchWrite = mocks.local.set.mock.calls.map(c => c[0]).find(items => items.media_release?.release === R2);
    expect(Object.keys(switchWrite).sort()).toEqual(['media_region_IN', 'media_region_WLD', 'media_release']);
  });

  test('keeps the current release when a region manifest of the new one fails', async () => {
    await installR1('IN');
    publishR2();
    mocks.routes[regionUrl(R2, 'IN')] = 500;
    const reporter = jest.fn();
    client.setErrorReporter(reporter);

    const result = await client.refreshRelease();

    expect(result.status).toBe('failed');
    expect(mocks.data.media_release.release).toBe(R1);
    expect(mocks.data.media_region_WLD.meta.release).toBe(R1);
    expect(mocks.data.media_region_IN.meta.release).toBe(R1);
    expect(mocks.data.media_discovery.lastFailureAt).toEqual(expect.any(Number));
    expect(reporter).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ operation: 'installRelease' }));
    // 500 is retried
    expect(mocks.fetchedUrls().filter(u => u === regionUrl(R2, 'IN'))).toHaveLength(3);
  });

  test('retries a failed switch after the failure backoff, not a day', async () => {
    await installR1();
    publishR2();
    mocks.routes[regionUrl(R2, 'WLD')] = 503;
    await client.refreshRelease();
    global.fetch.mockClear();

    await client.refreshRelease();
    expect(global.fetch).not.toHaveBeenCalled();

    mocks.data.media_discovery.lastFailureAt = Date.now() - 16 * 60 * 1000;
    mocks.routes[regionUrl(R2, 'WLD')] = regionManifest(R2, 'WLD');
    const result = await client.refreshRelease();
    expect(result.status).toBe('switched');
  });

  test('ignores a release that needs a newer extension', async () => {
    await installR1();
    publishR2();
    mocks.routes[CURRENT_URL] = currentJson(R2, { minExtensionVersion: '2.10.0' });

    const result = await client.refreshRelease();

    expect(result).toEqual({ status: 'unchanged', release: R1 });
    expect(mocks.fetchedUrls()).not.toContain(indexUrl(R2));
  });

  test('ignores a release with an unknown schema version', async () => {
    await installR1();
    publishR2();
    mocks.routes[CURRENT_URL] = currentJson(R2, { schemaVersion: 3 });

    expect((await client.refreshRelease()).release).toBe(R1);
    expect(mocks.data.media_release.release).toBe(R1);
  });

  test('ignores an index whose minExtensionVersion is too new', async () => {
    await installR1();
    publishR2();
    mocks.routes[indexUrl(R2)] = indexJson(R2, ['WLD'], { minExtensionVersion: '3.0.0' });

    const result = await client.refreshRelease();

    expect(result.status).toBe('failed');
    expect(mocks.data.media_release.release).toBe(R1);
  });

  test('follows current.json back to an earlier release (rollback)', async () => {
    load({ routes: releaseRoutes(R2) });
    await client.ensureMedia();
    Object.assign(mocks.routes, releaseRoutes(R1));
    mocks.data.media_discovery.lastCheckedAt = 0;

    const result = await client.refreshRelease();

    expect(result).toEqual({ status: 'switched', release: R1 });
  });

  test('moves the user to World when their region is not in the new release', async () => {
    await installR1('US');
    publishR2(['WLD', 'IN']);

    await client.refreshRelease();

    expect(mocks.data.region).toBe('WLD');
    expect(storedKeys()).toEqual(['media_discovery', 'media_region_WLD', 'media_release']);
  });
});

describe('region switch', () => {
  async function setup(region = 'WLD') {
    load({ storage: { region }, routes: releaseRoutes(R1) });
    await client.ensureMedia();
  }

  test('stores the region manifest before changing the setting, and prunes others', async () => {
    await setup('US');
    expect(storedKeys()).toContain('media_region_US');

    const result = await client.switchRegion('IN');

    expect(result).toEqual({ region: 'IN', previousRegion: 'US' });
    expect(mocks.data.region).toBe('IN');
    expect(storedKeys()).toEqual(['media_discovery', 'media_region_IN', 'media_region_WLD', 'media_release']);
    const write = mocks.local.set.mock.calls.map(c => c[0]).find(items => items.region === 'IN');
    expect(Object.keys(write).sort()).toEqual(['media_region_IN', 'region']);
  });

  test('keeps the previous region when the manifest fetch fails', async () => {
    await setup('WLD');
    mocks.routes[regionUrl(R1, 'IN')] = new TypeError('Failed to fetch');
    const reporter = jest.fn();
    client.setErrorReporter(reporter);

    await expect(client.switchRegion('IN')).rejects.toThrow();

    expect(mocks.data.region).toBe('WLD');
    expect(storedKeys()).toEqual(['media_discovery', 'media_region_WLD', 'media_release']);
    expect(reporter).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ operation: 'switchRegion' }));
  });

  test('switching to World drops the country manifest', async () => {
    await setup('IN');
    await client.switchRegion('WLD');
    expect(mocks.data.region).toBe('WLD');
    expect(storedKeys()).toEqual(['media_discovery', 'media_region_WLD', 'media_release']);
  });

  test('rejects a region that is not in the stored index', async () => {
    await setup('WLD');
    await expect(client.switchRegion('FR')).rejects.toThrow('not in the stored release');
    expect(mocks.data.region).toBe('WLD');
  });

  test('picking another region aborts the pending download; it resolves as superseded', async () => {
    await setup('WLD');
    const downloads = {};
    mocks.routes[regionUrl(R1, 'IN')] = manualRoute(downloads, 'IN');
    const reporter = jest.fn();
    client.setErrorReporter(reporter);

    const toIndia = client.switchRegion('IN');
    await settle(() => downloads.IN);
    expect(client.getPendingRegionSwitch()).toBe('IN');
    const toUs = client.switchRegion('US');

    await expect(toIndia).resolves.toEqual({ superseded: true, region: 'IN' });
    expect(downloads.IN.aborted).toBe(true);
    await expect(toUs).resolves.toEqual({ region: 'US', previousRegion: 'WLD' });
    expect(mocks.data.region).toBe('US');
    expect(storedKeys()).toEqual(['media_discovery', 'media_region_US', 'media_region_WLD', 'media_release']);
    expect(reporter).not.toHaveBeenCalled();
    expect(client.getPendingRegionSwitch()).toBeNull();
  });

  test('picking the region already loading returns the same switch (one fetch)', async () => {
    await setup('WLD');
    const downloads = {};
    mocks.routes[regionUrl(R1, 'IN')] = manualRoute(downloads, 'IN');
    global.fetch.mockClear();

    const first = client.switchRegion('IN');
    await settle(() => downloads.IN);
    const second = client.switchRegion('IN');
    expect(second).toBe(first);

    downloads.IN.push(JSON.stringify(regionManifest(R1, 'IN')));
    downloads.IN.end();
    await expect(first).resolves.toEqual({ region: 'IN', previousRegion: 'WLD' });
    expect(mocks.fetchedUrls()).toEqual([regionUrl(R1, 'IN')]);
    expect(mocks.data.region).toBe('IN');
  });

  test('picking World is immediate and cancels the pending switch', async () => {
    await setup('US');
    const downloads = {};
    mocks.routes[regionUrl(R1, 'IN')] = manualRoute(downloads, 'IN');

    const toIndia = client.switchRegion('IN');
    await settle(() => downloads.IN);
    const toWorld = client.switchRegion('WLD');

    await expect(toWorld).resolves.toEqual({ region: 'WLD', previousRegion: 'US' });
    await expect(toIndia).resolves.toMatchObject({ superseded: true });
    expect(downloads.IN.aborted).toBe(true);
    expect(mocks.data.region).toBe('WLD');
    expect(storedKeys()).toEqual(['media_discovery', 'media_region_WLD', 'media_release']);
  });

  test('a download finished just before being superseded writes nothing', async () => {
    await setup('WLD');
    // Hold the lock so the finished IN download waits to write
    let releaseLock;
    const downloads = {};
    mocks.routes[regionUrl(R1, 'IN')] = manualRoute(downloads, 'IN');
    mocks.data.media_discovery.lastCheckedAt = 0;
    mocks.routes[CURRENT_URL] = () => new Promise(resolve => { releaseLock = () => resolve(currentJson(R1)); });

    const refresh = client.refreshRelease();
    await settle(() => releaseLock);
    const toIndia = client.switchRegion('IN');
    await settle(() => downloads.IN);
    downloads.IN.push(JSON.stringify(regionManifest(R1, 'IN')));
    downloads.IN.end();
    await settle();
    const toWorld = client.switchRegion('WLD');
    releaseLock();
    await refresh;

    await expect(toIndia).resolves.toMatchObject({ superseded: true });
    await toWorld;
    expect(mocks.data.region).toBe('WLD');
    expect(mocks.data.media_region_IN).toBeUndefined();
    expect(mocks.local.set.mock.calls.some(([items]) => items.region === 'IN')).toBe(false);
  });

  test('a release switch during the download: the region is fetched again for the new release', async () => {
    await setup('WLD');
    const downloads = {};
    mocks.routes[regionUrl(R1, 'IN')] = manualRoute(downloads, 'IN');

    const toIndia = client.switchRegion('IN');
    await settle(() => downloads.IN);

    // R2 is published and installed while IN (R1) downloads: not blocked by the switch
    Object.assign(mocks.routes, releaseRoutes(R2));
    mocks.data.media_discovery.lastCheckedAt = 0;
    await expect(client.refreshRelease()).resolves.toEqual({ status: 'switched', release: R2 });

    downloads.IN.push(JSON.stringify(regionManifest(R1, 'IN')));
    downloads.IN.end();

    await expect(toIndia).resolves.toEqual({ region: 'IN', previousRegion: 'WLD' });
    expect(mocks.data.media_release.release).toBe(R2);
    expect(mocks.data.media_region_IN.meta.release).toBe(R2);
    expect(mocks.fetchedUrls()).toContain(regionUrl(R2, 'IN'));
  });

  test('a failed download writes nothing', async () => {
    await setup('WLD');
    mocks.routes[regionUrl(R1, 'IN')] = new TypeError('Failed to fetch');
    await expect(client.switchRegion('IN')).rejects.toThrow('Failed to fetch');
    expect(mocks.data.region).toBe('WLD');
    expect(mocks.local.set.mock.calls.some(([items]) => items.region === 'IN')).toBe(false);
  });

  test('reports progress against the index size', async () => {
    await setup('WLD');
    const downloads = {};
    mocks.routes[regionUrl(R1, 'IN')] = manualRoute(downloads, 'IN', { 'content-encoding': 'gzip', 'content-length': '10' });
    const onProgress = jest.fn();

    const toIndia = client.switchRegion('IN', { onProgress });
    await settle(() => downloads.IN);
    const body = JSON.stringify(regionManifest(R1, 'IN'));
    downloads.IN.push(body.slice(0, 400));
    await settle();
    expect(onProgress).toHaveBeenLastCalledWith(400, 1000);
    downloads.IN.push(body.slice(400));
    downloads.IN.end();
    await toIndia;
  });

  test('getRegionBirds returns the region list in order', async () => {
    await setup('IN');
    const birds = await client.getRegionBirds('IN');
    expect(birds.map(b => b.speciesCode)).toEqual(regionManifest(R1, 'IN').regions.IN.speciesCodes);
  });
});

describe('upgrade from 2.0.x (schema 1 storage)', () => {
  test('shows the 2.0.x preloaded bird without touching the network', async () => {
    const state = schema1StorageState();
    load({ storage: state, routes: releaseRoutes(R1) });

    const bird = await client.takeStoredBird();

    expect(bird).toEqual(state.preloadedBird);
    expect(mocks.data.preloadedBird).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('uses the schema 1 manifest until the World region manifest is stored', async () => {
    const state = schema1StorageState();
    delete state.preloadedBird;
    load({ storage: state, routes: releaseRoutes(R1) });

    const before = await client.takeStoredBird();
    expect(before.speciesCode).toMatch(/^oldbird/);
    expect((await client.getRandomBird('WLD')).speciesCode).toMatch(/^oldbird/);
    expect(global.fetch).not.toHaveBeenCalled();

    await client.ensureMedia();

    expect(mocks.data.media_manifest).toBeUndefined();
    expect(mocks.data.media_manifest_meta).toBeUndefined();
    expect(mocks.data.region).toBe('WLD');
    expect(mocks.data.autoPlay).toBe(true);
    const after = await client.getRandomBird('WLD');
    expect(after.speciesCode).not.toMatch(/^oldbird/);
  });

  test('keeps the schema 1 manifest when no schema 2 release is reachable', async () => {
    load({ storage: schema1StorageState(), routes: {} });

    const result = await client.ensureMedia();

    expect(result).toEqual({ ready: true, schema: 1, release: null });
    expect(mocks.data.media_manifest).toBeDefined();
    expect(mocks.fetchedUrls()).not.toContain(LEGACY_URL);
  });

  test('keeps the schema 1 manifest when the switch fails halfway', async () => {
    const routes = releaseRoutes(R1);
    routes[regionUrl(R1, 'WLD')] = 500;
    load({ storage: schema1StorageState(), routes });

    await client.ensureMedia();

    expect(mocks.data.media_manifest).toBeDefined();
    expect(mocks.data.media_release).toBeUndefined();
  });

  test('a later start removes the schema 1 keys lazily', async () => {
    const state = schema1StorageState();
    load({ storage: state, routes: releaseRoutes(R1) });
    // Simulate a switch stored by an earlier run that stopped before pruning
    mocks.data.media_release = { schemaVersion: 2, release: R1, indexUrl: indexUrl(R1), index: indexJson(R1), storedAt: 1 };
    mocks.data.media_region_WLD = regionManifest(R1, 'WLD');
    mocks.data.media_discovery = { lastCheckedAt: Date.now() };

    await client.ensureMedia();

    expect(mocks.data.media_manifest).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('takeStoredBird', () => {
  test('picks from the selected region, then World', async () => {
    load({ storage: { region: 'IN' }, routes: releaseRoutes(R1) });
    await client.ensureMedia();

    const bird = await client.takeStoredBird();
    expect(bird.location).toBe('IN');

    delete mocks.data.media_region_IN;
    const fallback = await client.takeStoredBird();
    expect(fallback.location).toBe('WLD');
  });

  test('returns null when nothing is stored', async () => {
    load();
    expect(await client.takeStoredBird()).toBeNull();
  });

  test('repairs a missing selected region manifest on the next start', async () => {
    load({ storage: { region: 'IN' }, routes: releaseRoutes(R1) });
    await client.ensureMedia();
    delete mocks.data.media_region_IN;
    global.fetch.mockClear();

    await client.ensureMedia();

    expect(mocks.fetchedUrls()).toEqual([regionUrl(R1, 'IN')]);
    expect(mocks.data.media_region_IN.meta.release).toBe(R1);
  });
});

describe('fetchJson', () => {
  test('retries server errors, then succeeds', async () => {
    load();
    let calls = 0;
    global.fetch = jest.fn(async () => {
      calls += 1;
      return calls < 3 ? { ok: false, status: 502 } : { ok: true, status: 200, json: async () => ({ ok: 1 }) };
    });
    await expect(client.fetchJson('https://x/a.json', { baseDelayMs: 0 })).resolves.toEqual({ ok: 1 });
    expect(calls).toBe(3);
  });

  test('does not retry a 404 and marks the status', async () => {
    load();
    global.fetch = jest.fn(async () => ({ ok: false, status: 404 }));
    await expect(client.fetchJson('https://x/a.json', { baseDelayMs: 0 })).rejects.toMatchObject({ statusCode: 404 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('times out a hanging request', async () => {
    load();
    global.fetch = jest.fn((url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }));
    await expect(client.fetchJson('https://x/a.json', { timeoutMs: 10, retries: 1, baseDelayMs: 0 }))
      .rejects.toMatchObject({ isTimeout: true, isNetworkError: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  describe('streamed bodies', () => {
    const URL = 'https://x/region.json';
    let downloads;

    beforeEach(() => {
      jest.useFakeTimers();
      downloads = {};
      load({ routes: {} });
    });
    afterEach(() => jest.useRealTimers());

    function route(headers) {
      let n = 0;
      mocks.routes[URL] = init => manualRoute(downloads, `attempt${++n}`, headers)(init);
    }

    test('a slow download that keeps receiving bytes is never cut off', async () => {
      route();
      const onProgress = jest.fn();
      const result = client.fetchJson(URL, { onProgress, expectedBytes: 12 });
      await settle(() => downloads.attempt1);

      // 60 s in total, 10 s between chunks: past every 15 s timeout, never stalled
      const body = '{"birds":42}';
      for (const chunk of body.match(/.{1,2}/g)) {
        await jest.advanceTimersByTimeAsync(10000);
        downloads.attempt1.push(chunk);
      }
      downloads.attempt1.end();

      await expect(result).resolves.toEqual({ birds: 42 });
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(onProgress).toHaveBeenLastCalledWith(12, 12);
    });

    test('a stalled download is aborted after the stall timeout and retried', async () => {
      route();
      const result = client.fetchJson(URL, { retries: 1, baseDelayMs: 0 });
      await settle(() => downloads.attempt1);
      downloads.attempt1.push('{"bir');

      await jest.advanceTimersByTimeAsync(14999);
      expect(downloads.attempt1.aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      expect(downloads.attempt1.aborted).toBe(true);

      await jest.advanceTimersByTimeAsync(10); // backoff
      await settle(() => downloads.attempt2);
      downloads.attempt2.push('{"birds":1}');
      downloads.attempt2.end();
      await expect(result).resolves.toEqual({ birds: 1 });
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('a stall that outlasts the retries fails as a timeout', async () => {
      route();
      const result = client.fetchJson(URL, { retries: 0 });
      const assertion = expect(result).rejects.toMatchObject({ isTimeout: true, isNetworkError: true, isStall: true });
      await settle(() => downloads.attempt1);
      await jest.advanceTimersByTimeAsync(15000);
      await assertion;
    });

    test('no response headers within the response timeout: retried', async () => {
      let calls = 0;
      mocks.routes[URL] = init => {
        calls += 1;
        if (calls === 1) {
          return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          }));
        }
        return { ok: 1 };
      };
      const result = client.fetchJson(URL, { retries: 1, baseDelayMs: 0 });
      await jest.advanceTimersByTimeAsync(14999);
      expect(calls).toBe(1);
      await jest.advanceTimersByTimeAsync(1);
      await jest.advanceTimersByTimeAsync(10); // backoff
      await expect(result).resolves.toEqual({ ok: 1 });
      expect(calls).toBe(2);
    });

    test('an external abort rejects as aborted and is not retried', async () => {
      route();
      const controller = new AbortController();
      const result = client.fetchJson(URL, { signal: controller.signal, retries: 2, baseDelayMs: 0 });
      await settle(() => downloads.attempt1);
      downloads.attempt1.push('{"bi');

      controller.abort();

      await expect(result).rejects.toMatchObject({ isAborted: true });
      expect(downloads.attempt1.aborted).toBe(true);
      await jest.advanceTimersByTimeAsync(60000);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('an abort during the retry backoff stops at once', async () => {
      mocks.routes[URL] = 503;
      const controller = new AbortController();
      const result = client.fetchJson(URL, { signal: controller.signal, retries: 2, baseDelayMs: 1000 });
      const assertion = expect(result).rejects.toMatchObject({ isAborted: true });
      await settle(() => global.fetch.mock.calls.length === 1);
      controller.abort();
      await assertion;
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('expected size: Content-Length only when the response is not content-encoded', async () => {
      route({ 'content-length': '11' });
      const plain = jest.fn();
      const first = client.fetchJson(URL, { onProgress: plain });
      await settle(() => downloads.attempt1);
      downloads.attempt1.push('{"a":12345}');
      downloads.attempt1.end();
      await first;
      expect(plain).toHaveBeenLastCalledWith(11, 11);

      route({ 'content-length': '5', 'content-encoding': 'br' });
      downloads = {};
      const compressed = jest.fn();
      const second = client.fetchJson(URL, { onProgress: compressed });
      await settle(() => downloads.attempt1);
      downloads.attempt1.push('{"a":12345}');
      downloads.attempt1.end();
      await second;
      expect(compressed).toHaveBeenLastCalledWith(11, null);
    });

    test('a parse error is not retried', async () => {
      route();
      const result = client.fetchJson(URL, { retries: 2, baseDelayMs: 0 });
      const assertion = expect(result).rejects.toThrow(SyntaxError);
      await settle(() => downloads.attempt1);
      downloads.attempt1.push('{"truncated');
      downloads.attempt1.end();
      await assertion;
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('shared in-flight fetches', () => {
    const URL = 'https://x/region.json';
    let downloads;

    beforeEach(() => {
      downloads = {};
      load({ routes: {} });
      mocks.routes[URL] = manualRoute(downloads, 'one');
    });

    test('concurrent fetches of one URL share a request and its progress', async () => {
      const progressA = jest.fn();
      const progressB = jest.fn();
      const a = client.fetchJson(URL, { onProgress: progressA, expectedBytes: 10 });
      await settle(() => downloads.one);
      downloads.one.push('{"x":');
      await settle(() => progressA.mock.calls.length === 2);
      const b = client.fetchJson(URL, { onProgress: progressB, expectedBytes: 10 });
      downloads.one.push('1}');
      downloads.one.end();

      await expect(a).resolves.toEqual({ x: 1 });
      await expect(b).resolves.toEqual({ x: 1 });
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(progressA).toHaveBeenLastCalledWith(7, 10);
      // joined late: told the progress so far, then the rest
      expect(progressB.mock.calls[0]).toEqual([5, 10]);
      expect(progressB).toHaveBeenLastCalledWith(7, 10);
    });

    test('one caller aborting leaves the request to the others; the last one cancels it', async () => {
      const first = new AbortController();
      const second = new AbortController();
      const a = client.fetchJson(URL, { signal: first.signal });
      const b = client.fetchJson(URL, { signal: second.signal });
      const c = client.fetchJson(URL);
      await settle(() => downloads.one);

      first.abort();
      await expect(a).rejects.toMatchObject({ isAborted: true });
      expect(downloads.one.aborted).toBe(false);

      downloads.one.push('{"x":2}');
      downloads.one.end();
      await expect(b).resolves.toEqual({ x: 2 });
      await expect(c).resolves.toEqual({ x: 2 });

      // A new fetch starts fresh; aborting its only caller cancels the request
      const solo = new AbortController();
      const d = client.fetchJson(URL, { signal: solo.signal });
      await settle(() => global.fetch.mock.calls.length === 2);
      solo.abort();
      await expect(d).rejects.toMatchObject({ isAborted: true });
      expect(downloads.one.aborted).toBe(true);
    });
  });
});

describe('region setting on upgrade', () => {
  function loadMigration(storage) {
    mocks = installMocks({ storage });
    jest.resetModules();
    return require('../storageMigration.js');
  }

  test('a 2.0.x user on World keeps their settings and no region write happens', async () => {
    const { ensureRegionSettingMigrated } = loadMigration(schema1StorageState());

    await ensureRegionSettingMigrated();

    expect(mocks.data.region).toBe('WLD');
    expect(mocks.data.autoPlay).toBe(true);
    expect(mocks.data.regionSettingVersion).toBe(1);
    expect(mocks.local.set.mock.calls.some(([items]) => 'region' in items)).toBe(false);
  });

  test('a leftover pre-2.0 region is reset to World once', async () => {
    const { ensureRegionSettingMigrated } = loadMigration({ ...schema1StorageState(), region: 'US' });

    await ensureRegionSettingMigrated();
    expect(mocks.data.region).toBe('WLD');

    mocks.data.region = 'IN'; // chosen later in 2.1
    jest.resetModules();
    await require('../storageMigration.js').ensureRegionSettingMigrated();
    expect(mocks.data.region).toBe('IN');
  });
});
