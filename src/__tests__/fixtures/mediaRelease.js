/**
 * Fixtures shaped like crawlers/RELEASE_FORMAT.md (schema 2) and the schema 1
 * World manifest 2.0.x stores, plus an in-memory chrome.storage / fetch mock.
 */

export const BASE = 'https://media.birdtab.app';
export const CURRENT_URL = `${BASE}/current.json`;
export const LEGACY_URL = `${BASE}/m260416r01/manifests/manifest.json`;

const REGION_NAMES = { WLD: 'World', IN: 'India', US: 'United States', XX: 'High Seas' };

export const REGION_SPECIES = {
  WLD: ['rocpig', 'barswa', 'greegr', 'houspa', 'ruddtu', 'whimbr'],
  IN: ['houspa', 'lesfla1', 'indrob1', 'commyn', 'rocpig', 'barswa'],
  US: ['amerob', 'norcar', 'blujay', 'rocpig', 'barswa', 'houspa'],
  XX: ['wanalb', 'sooshe'],
};

export function indexUrl(release) {
  return `${BASE}/releases/${release}/index.json`;
}

export function regionUrl(release, code) {
  return `${BASE}/releases/${release}/regions/${code}.json`;
}

export function speciesEntry(code, release = 'm261020r01') {
  return {
    speciesCode: code,
    primaryComName: `Bird ${code}`,
    primaryComName_fr: null,
    primaryComName_cn: null,
    scientificName: `Avis ${code}`,
    description: `About ${code}`,
    conservationStatus: 'LC',
    ebirdUrl: `https://ebird.org/species/${code}`,
    image: {
      source: 'wikimedia',
      creatorName: 'Photographer',
      license: 'CC BY 4.0',
      renditions: {
        default: { url: `${BASE}/assets/images/${release}-${code}.avif`, width: 2400, height: 1600, format: 'avif', resized: true },
      },
    },
    audio: {
      source: 'xeno-canto',
      creatorName: 'Recordist',
      license: 'CC BY 4.0',
      renditions: {
        default: { url: `${BASE}/assets/audio/${release}-${code}.opus`, format: 'opus', durationSeconds: 20, durationFormatted: '0:20', converted: true },
      },
    },
  };
}

export function currentJson(release, { schemaVersion = 2, minExtensionVersion = '2.1.0' } = {}) {
  return {
    schemaVersion,
    release,
    indexUrl: indexUrl(release),
    minExtensionVersion,
    publishedAt: '2026-10-20T10:00:00.000Z',
  };
}

export function indexJson(release, codes = ['WLD', 'IN', 'US'], { schemaVersion = 2, minExtensionVersion = '2.1.0' } = {}) {
  return {
    schemaVersion,
    release,
    minExtensionVersion,
    generatedAt: '2026-10-20T09:00:00.000Z',
    defaultRegion: 'WLD',
    regions: codes.map(code => ({
      code,
      name: REGION_NAMES[code] || code,
      speciesCount: REGION_SPECIES[code]?.length ?? 1,
      url: regionUrl(release, code),
      bytes: 1000,
    })),
  };
}

export function regionManifest(release, code) {
  const codes = REGION_SPECIES[code];
  return {
    meta: {
      schemaVersion: 2, release, region: code, regionName: REGION_NAMES[code] || code,
      speciesCount: codes.length, generatedAt: '2026-10-20T09:00:00.000Z', imageFormat: 'avif', audioFormat: 'opus',
    },
    regions: { [code]: { name: REGION_NAMES[code] || code, speciesCount: codes.length, speciesCodes: codes } },
    species: codes.map(c => speciesEntry(c, release)),
  };
}

/** Routes for a published release: current.json (optional), index, region files. */
export function releaseRoutes(release, codes = ['WLD', 'IN', 'US'], { withCurrent = true } = {}) {
  const routes = {
    [indexUrl(release)]: indexJson(release, codes),
  };
  codes.forEach(code => { routes[regionUrl(release, code)] = regionManifest(release, code); });
  if (withCurrent) routes[CURRENT_URL] = currentJson(release);
  return routes;
}

/** A names file's URL: content-addressed in a real release, so `version` stands for its hash. */
export function namesUrl(locale, version = 1) {
  return `${BASE}/assets/names/${locale}-${version}.json`;
}

/** A names file (crawlers/src/lib/bird-names.ts) naming every fixture species "<locale> <code>". */
export function namesFile(locale, version = 1) {
  const codes = [...new Set(Object.values(REGION_SPECIES).flat())].sort();
  const names = Object.fromEntries(codes.map(code => [code, `${locale} ${code}${version > 1 ? ` v${version}` : ''}`]));
  return { schemaVersion: 1, locale, taxonomy: 'eBird/Clements v2025 (30 Oct 2025)', source: 'eBird', count: codes.length, names };
}

/**
 * Add names files to a release's routes and index: { de: 1, zh_TW: 2 } lists those locales,
 * each file at that version.
 */
export function withNames(routes, release, versions) {
  const index = routes[indexUrl(release)];
  index.names = {};
  for (const [locale, version] of Object.entries(versions)) {
    const file = namesFile(locale, version);
    index.names[locale] = { url: namesUrl(locale, version), bytes: JSON.stringify(file).length, count: file.count };
    routes[namesUrl(locale, version)] = file;
  }
  return routes;
}

export function legacyManifest() {
  const codes = ['oldbird1', 'oldbird2', 'oldbird3'];
  return {
    meta: { version: '2026-04-16', speciesCount: codes.length },
    regions: { WLD: { name: 'World', speciesCodes: codes } },
    species: codes.map(c => speciesEntry(c, 'm260416r01')),
  };
}

/** The local storage a 2.0.3 user has before updating. */
export function schema1StorageState() {
  const manifest = legacyManifest();
  return {
    region: 'WLD',
    autoPlay: true,
    storageMigrationVersion: 1,
    media_manifest: manifest,
    media_manifest_meta: { version: manifest.meta.version, manifestUrl: LEGACY_URL, cachedAt: 1 },
    preloadedBird: { name: 'Bird oldbird2', speciesCode: 'oldbird2', imageUrl: `${BASE}/m260416r01/images/oldbird2.avif`, location: 'WLD' },
  };
}

/**
 * Install global chrome and fetch mocks.
 * routes: { url: json | number (HTTP status) | Error | ((init) => json|number|Error|streamingResponse) }
 */
export function installMocks({ storage = {}, routes = {}, version = '2.1.0' } = {}) {
  const data = JSON.parse(JSON.stringify(storage));
  const pick = keys => {
    if (keys === null || keys === undefined) return { ...data };
    const list = typeof keys === 'string' ? [keys] : keys;
    const out = {};
    list.forEach(k => { if (data[k] !== undefined) out[k] = data[k]; });
    return out;
  };
  const respond = (value, callback) => {
    if (callback) {
      callback(value);
      return undefined;
    }
    return Promise.resolve(value);
  };
  const changeListeners = [];

  const local = {
    data,
    get: jest.fn((keys, callback) => respond(JSON.parse(JSON.stringify(pick(keys))), callback)),
    set: jest.fn((items, callback) => {
      Object.assign(data, JSON.parse(JSON.stringify(items)));
      return respond(undefined, callback);
    }),
    remove: jest.fn((keys, callback) => {
      (typeof keys === 'string' ? [keys] : keys).forEach(k => delete data[k]);
      return respond(undefined, callback);
    }),
    getKeys: jest.fn(() => Promise.resolve(Object.keys(data))),
  };

  // chrome.storage.session: promise API, fires storage.onChanged('session')
  const sessionData = {};
  const emitChange = (changes, area) => changeListeners.slice().forEach(fn => fn(changes, area));
  const session = {
    data: sessionData,
    get: jest.fn(keys => {
      const list = keys === null || keys === undefined ? Object.keys(sessionData) : (typeof keys === 'string' ? [keys] : keys);
      const out = {};
      list.forEach(k => { if (sessionData[k] !== undefined) out[k] = JSON.parse(JSON.stringify(sessionData[k])); });
      return Promise.resolve(out);
    }),
    set: jest.fn(items => {
      const changes = {};
      Object.entries(JSON.parse(JSON.stringify(items))).forEach(([k, v]) => {
        changes[k] = { oldValue: sessionData[k], newValue: v };
        sessionData[k] = v;
      });
      emitChange(changes, 'session');
      return Promise.resolve();
    }),
    remove: jest.fn(keys => {
      const changes = {};
      (typeof keys === 'string' ? [keys] : keys).forEach(k => {
        if (sessionData[k] !== undefined) changes[k] = { oldValue: sessionData[k], newValue: undefined };
        delete sessionData[k];
      });
      if (Object.keys(changes).length) emitChange(changes, 'session');
      return Promise.resolve();
    }),
  };

  global.chrome = {
    runtime: {
      lastError: undefined,
      getManifest: () => ({ version }),
      sendMessage: jest.fn(),
    },
    storage: {
      local,
      session,
      sync: { get: jest.fn(), set: jest.fn() },
      onChanged: { addListener: jest.fn(fn => changeListeners.push(fn)), removeListener: jest.fn() },
    },
    i18n: {
      getMessage: jest.fn(key => key),
      getUILanguage: jest.fn(() => 'en'),
    },
  };

  const liveRoutes = { ...routes };
  global.fetch = jest.fn(async (url, init = {}) => {
    let route = liveRoutes[url];
    if (typeof route === 'function') route = await route(init);
    if (route?.isMockResponse) return route;
    if (route === undefined) route = 404;
    if (route instanceof Error) throw route;
    if (typeof route === 'number') {
      return { ok: false, status: route, json: async () => ({}) };
    }
    const body = JSON.parse(JSON.stringify(route));
    return { ok: true, status: 200, json: async () => body };
  });

  return {
    data, local, session, emitChange, routes: liveRoutes,
    fetchedUrls: () => global.fetch.mock.calls.map(c => c[0]),
  };
}

/**
 * A response whose body arrives when the test says so (streamed through
 * body.getReader()). Aborting the request's signal fails the read.
 *   const download = streamingResponse({ signal, headers: { 'content-length': '100' } });
 *   download.push('{"a":'); download.push('1}'); download.end();
 */
export function streamingResponse({ signal = null, headers = {}, status = 200 } = {}) {
  const queue = [];
  const waiting = [];
  let ended = false;
  let failure = null;
  const fail = error => {
    failure = error;
    waiting.splice(0).forEach(w => w.reject(error));
  };
  signal?.addEventListener('abort', () => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    fail(error);
  });
  const reader = {
    read: () => new Promise((resolve, reject) => {
      if (failure) reject(failure);
      else if (queue.length) resolve({ done: false, value: queue.shift() });
      else if (ended) resolve({ done: true, value: undefined });
      else waiting.push({ resolve, reject });
    }),
  };
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    response: {
      isMockResponse: true,
      ok: status >= 200 && status < 300,
      status,
      headers: { get: name => lower[name.toLowerCase()] ?? null },
      body: { getReader: () => reader },
    },
    push(text) {
      const value = new TextEncoder().encode(text);
      const waiter = waiting.shift();
      if (waiter) waiter.resolve({ done: false, value });
      else queue.push(value);
    },
    end() {
      ended = true;
      waiting.splice(0).forEach(w => w.resolve({ done: true, value: undefined }));
    },
    fail,
    get aborted() { return !!signal?.aborted; },
  };
}
