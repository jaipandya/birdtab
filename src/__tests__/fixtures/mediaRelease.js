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
 * routes: { url: json | number (HTTP status) | Error | (() => json|number|Error) }
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

  global.chrome = {
    runtime: {
      lastError: undefined,
      getManifest: () => ({ version }),
      sendMessage: jest.fn(),
    },
    storage: {
      local,
      sync: { get: jest.fn(), set: jest.fn() },
      onChanged: { addListener: jest.fn(fn => changeListeners.push(fn)), removeListener: jest.fn() },
    },
    i18n: {
      getMessage: jest.fn(key => key),
      getUILanguage: jest.fn(() => 'en'),
    },
  };

  const liveRoutes = { ...routes };
  global.fetch = jest.fn(async url => {
    let route = liveRoutes[url];
    if (typeof route === 'function') route = route();
    if (route === undefined) route = 404;
    if (route instanceof Error) throw route;
    if (typeof route === 'number') {
      return { ok: false, status: route, json: async () => ({}) };
    }
    const body = JSON.parse(JSON.stringify(route));
    return { ok: true, status: 200, json: async () => body };
  });

  return { data, local, routes: liveRoutes, fetchedUrls: () => global.fetch.mock.calls.map(c => c[0]) };
}
