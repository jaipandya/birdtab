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

  test('checks current.json at most every 6 hours unless forced', async () => {
    load({ routes: releaseRoutes(R1) });
    await client.ensureMedia();
    global.fetch.mockClear();

    await client.ensureMedia();
    expect(global.fetch).not.toHaveBeenCalled();

    mocks.data.media_discovery.lastCheckedAt = Date.now() - 7 * HOUR;
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

  test('retries a failed switch after the failure backoff, not 6 hours', async () => {
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
