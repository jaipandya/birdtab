/**
 * Bird names in the UI language: which names file a browser language gets, how a name is
 * picked, and how mediaClient keeps the stored names in step with releases and languages.
 */

import {
  installMocks,
  namesFile,
  namesUrl,
  releaseRoutes,
  withNames,
} from './fixtures/mediaRelease.js';

const R1 = 'm261020r01';
const R2 = 'm261101r01';

let names;
let client;
let mocks;

/** Fresh modules with a browser in `language`. */
function load({ language = 'en', storage, routes } = {}) {
  mocks = installMocks({ storage, routes });
  chrome.i18n.getUILanguage.mockImplementation(() => language);
  jest.resetModules();
  require('../config.js').CONFIG.MEDIA.RETRY_BASE_DELAY_MS = 0;
  names = require('../birdNames.js');
  client = require('../mediaClient.js');
  return mocks;
}

const bird = (extra = {}) => ({
  speciesCode: 'barswa',
  name: 'Barn Swallow',
  primaryComName: 'Barn Swallow',
  scientificName: 'Hirundo rustica',
  primaryComName_fr: null,
  primaryComName_cn: null,
  ...extra,
});

describe('namesLocaleFor', () => {
  beforeEach(() => load());

  test.each([
    ['zh-TW', 'zh_TW'],
    ['zh_TW', 'zh_TW'],
    ['zh-Hant', 'zh_TW'],
    ['zh-Hant-TW', 'zh_TW'],
    ['zh-HK', 'zh_HK'],
    ['zh-MO', 'zh_HK'],
    ['zh-Hant-HK', 'zh_HK'],
    ['zh-Hans-HK', 'zh_CN'],
    ['zh-CN', 'zh_CN'],
    ['zh-SG', 'zh_CN'],
    ['zh', 'zh_CN'],
    ['pt-BR', 'pt_BR'],
    ['pt-PT', 'pt_PT'],
    ['pt_PT', 'pt_PT'],
    ['pt-AO', null],
    ['pt', null],
    ['de', 'de'],
    ['de-AT', 'de'],
    ['es-419', 'es'],
    ['fr-CA', 'fr'],
    ['ja', 'ja'],
    ['pl', 'pl'],
    ['ru', 'ru'],
    ['ar', 'ar'],
    ['en', null],
    ['en-GB', null],
    ['ko', null],
    ['', null],
    [undefined, null],
  ])('%s → %s', (language, expected) => {
    expect(names.namesLocaleFor(language)).toBe(expected);
  });

  test('defaults to the browser language', () => {
    load({ language: 'zh-TW' });
    expect(names.namesLocaleFor()).toBe('zh_TW');
  });
});

describe('pickNamesEntry', () => {
  beforeEach(() => load());
  const index = { names: { de: { url: 'de.json', bytes: 10 }, zh_TW: { url: 'tw.json' } } };

  test('the entry for the language, with its locale', () => {
    expect(names.pickNamesEntry(index, 'de-CH')).toEqual({ url: 'de.json', bytes: 10, locale: 'de' });
    expect(names.pickNamesEntry(index, 'zh-TW')).toEqual({ url: 'tw.json', locale: 'zh_TW' });
  });

  test('Hong Kong takes its own file, else Taiwan\'s', () => {
    expect(names.pickNamesEntry(index, 'zh-HK')).toEqual({ url: 'tw.json', locale: 'zh_TW' });
    expect(names.pickNamesEntry({ names: { ...index.names, zh_HK: { url: 'hk.json' } } }, 'zh-HK').locale).toBe('zh_HK');
  });

  test('null for English, a missing language, or a release without names', () => {
    expect(names.pickNamesEntry(index, 'en')).toBeNull();
    expect(names.pickNamesEntry(index, 'fr')).toBeNull();
    expect(names.pickNamesEntry({ regions: [] }, 'de')).toBeNull();
    expect(names.pickNamesEntry(null, 'de')).toBeNull();
    expect(names.pickNamesEntry({ names: { de: { bytes: 1 } } }, 'de')).toBeNull();
  });

  test('isValidNamesFile checks the locale and the names object', () => {
    expect(names.isValidNamesFile(namesFile('de'), 'de')).toBe(true);
    expect(names.isValidNamesFile(namesFile('de'), 'fr')).toBe(false);
    expect(names.isValidNamesFile({ locale: 'de', names: [] }, 'de')).toBe(false);
    expect(names.isValidNamesFile(null, 'de')).toBe(false);
  });
});

describe('localizedName', () => {
  test('English for an English browser, whatever is stored', async () => {
    load({ language: 'en-US', storage: { media_names: { locale: 'de', url: 'x', names: { barswa: 'Rauchschwalbe' } } } });
    await names.loadBirdNames();
    expect(names.localizedName(bird({ primaryComName_fr: 'Hirondelle rustique' }))).toBe('Barn Swallow');
  });

  test('the stored names come first, by species code', async () => {
    load({ language: 'zh-TW', storage: { media_names: { locale: 'zh_TW', url: 'x', names: { barswa: '家燕' } } } });
    await names.loadBirdNames();
    expect(names.localizedName(bird({ primaryComName_cn: '家燕(简)', names: { zh_TW: '別的' } }))).toBe('家燕');
  });

  test('then the bird\'s own names, then the manifest\'s French or Simplified Chinese, then English', async () => {
    load({ language: 'zh-TW', storage: { media_names: { locale: 'zh_TW', url: 'x', names: { other: '別的' } } } });
    await names.loadBirdNames();
    expect(names.localizedName(bird({ names: { zh_TW: '家燕', zh_CN: '家燕简' } }))).toBe('家燕');
    expect(names.localizedName(bird({ primaryComName_cn: '家燕简' }))).toBe('家燕简');
    expect(names.localizedName(bird())).toBe('Barn Swallow');
    expect(names.localizedName(bird(), 'fr')).toBe('Barn Swallow');
    expect(names.localizedName(bird({ primaryComName_fr: 'Hirondelle rustique' }), 'fr-FR')).toBe('Hirondelle rustique');
  });

  test('stored names in another language are ignored (the browser\'s language changed)', async () => {
    load({ language: 'fr', storage: { media_names: { locale: 'de', url: 'x', names: { barswa: 'Rauchschwalbe' } } } });
    await names.loadBirdNames();
    expect(names.localizedName(bird({ primaryComName_fr: 'Hirondelle rustique' }))).toBe('Hirondelle rustique');
  });

  test('Hong Kong uses Taiwan\'s names when it has no file of its own', async () => {
    load({ language: 'zh-HK', storage: { media_names: { locale: 'zh_TW', url: 'x', names: { barswa: '家燕' } } } });
    await names.loadBirdNames();
    expect(names.localizedName(bird())).toBe('家燕');
    expect(names.localizedName(bird({ speciesCode: 'none', names: { zh_TW: '台灣名' } }))).toBe('台灣名');
  });

  test('works before the names are read, and for nothing', () => {
    load({ language: 'de' });
    expect(names.localizedName(bird({ names: { de: 'Rauchschwalbe' } }))).toBe('Rauchschwalbe');
    expect(names.localizedName(bird())).toBe('Barn Swallow');
    expect(names.localizedName({ speciesCode: 'x1', primaryComName: 'Bird X' })).toBe('Bird X');
    expect(names.localizedName(null)).toBe('');
  });

  test('searchableNames: the localized, English and scientific names, once each', async () => {
    load({ language: 'de', storage: { media_names: { locale: 'de', url: 'x', names: { barswa: 'Rauchschwalbe' } } } });
    await names.loadBirdNames();
    expect(names.searchableNames(bird())).toEqual(['Rauchschwalbe', 'Barn Swallow', 'Hirundo rustica']);
    expect(names.searchableNames(bird(), 'en')).toEqual(['Barn Swallow', 'Hirundo rustica']);
  });
});

describe('loadBirdNames', () => {
  test('reads storage once, then again after the names change', async () => {
    const m = load({ language: 'de', storage: { media_names: { locale: 'de', url: 'a', names: { barswa: 'Rauchschwalbe' } } } });
    await names.loadBirdNames();
    await names.loadBirdNames();
    expect(m.local.get.mock.calls.filter(c => JSON.stringify(c[0]) === '["media_names"]')).toHaveLength(1);

    m.data.media_names = { locale: 'de', url: 'b', names: { barswa: 'Schwalbe' } };
    m.emitChange({ media_names: { newValue: m.data.media_names } }, 'local');
    await names.loadBirdNames();
    expect(names.localizedName(bird())).toBe('Schwalbe');

    // Other keys and areas don't drop the names
    m.emitChange({ region: { newValue: 'US' } }, 'local');
    m.emitChange({ media_names: { newValue: null } }, 'session');
    await names.loadBirdNames();
    expect(m.local.get.mock.calls.filter(c => JSON.stringify(c[0]) === '["media_names"]')).toHaveLength(2);
  });

  test('nothing stored, or storage failing, gives no names rather than an error', async () => {
    load({ language: 'de' });
    await expect(names.loadBirdNames()).resolves.toEqual({ locale: null, names: {} });
    names.resetBirdNames();
    chrome.storage.local.get.mockImplementation(() => { throw new Error('gone'); });
    await expect(names.loadBirdNames()).resolves.toEqual({ locale: null, names: {} });
  });
});

describe('mediaClient keeps the names', () => {
  const storedNames = () => mocks.data.media_names;

  test('a fresh install stores the names with the release, in the same write', async () => {
    load({ language: 'zh-TW', routes: withNames(releaseRoutes(R1), R1, { de: 1, zh_TW: 1 }) });

    await client.ensureMedia();

    expect(storedNames()).toMatchObject({ locale: 'zh_TW', url: namesUrl('zh_TW'), names: { barswa: 'zh_TW barswa' } });
    expect(mocks.fetchedUrls()).not.toContain(namesUrl('de'));
    const write = mocks.local.set.mock.calls.map(c => c[0]).find(items => items.media_release);
    expect(Object.keys(write).sort()).toEqual(['media_names', 'media_region_WLD', 'media_release']);

    await names.loadBirdNames();
    const shown = await client.getRandomBird('WLD');
    expect(names.localizedName(shown)).toBe(`zh_TW ${shown.speciesCode}`);
  });

  test('an English browser downloads no names', async () => {
    load({ language: 'en-GB', routes: withNames(releaseRoutes(R1), R1, { de: 1 }) });
    await client.ensureMedia();
    expect(storedNames()).toBeUndefined();
    expect(mocks.fetchedUrls().some(u => u.includes('/assets/names/'))).toBe(false);
  });

  test('Hong Kong gets Taiwan\'s file when there is no Hong Kong one', async () => {
    load({ language: 'zh-HK', routes: withNames(releaseRoutes(R1), R1, { zh_TW: 1 }) });
    await client.ensureMedia();
    expect(storedNames().locale).toBe('zh_TW');
  });

  test('a failed names download never holds up the release, and waits before trying again', async () => {
    const routes = withNames(releaseRoutes(R1), R1, { de: 1 });
    routes[namesUrl('de')] = 500;
    load({ language: 'de', routes });
    const reporter = jest.fn();
    client.setErrorReporter(reporter);

    const result = await client.ensureMedia();

    expect(result).toEqual({ ready: true, schema: 2, release: R1 });
    expect(mocks.data.media_release.release).toBe(R1);
    expect(storedNames()).toBeUndefined();
    expect(mocks.data.media_discovery).toMatchObject({ namesFailedUrl: namesUrl('de'), namesFailedAt: expect.any(Number) });
    expect(reporter).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ operation: 'fetchNames' }));

    // The next start within the backoff doesn't try again
    mocks.routes[namesUrl('de')] = namesFile('de');
    global.fetch.mockClear();
    await client.ensureMedia();
    expect(mocks.fetchedUrls()).not.toContain(namesUrl('de'));

    // After it, the start fetches the names for the stored release
    mocks.data.media_discovery.namesFailedAt = Date.now() - 16 * 60 * 1000;
    await client.ensureMedia();
    expect(storedNames().url).toBe(namesUrl('de'));
  });

  test('a cache clear (forced) tries again at once', async () => {
    const routes = withNames(releaseRoutes(R1), R1, { de: 1 });
    routes[namesUrl('de')] = 503;
    load({ language: 'de', routes });
    await client.ensureMedia();
    mocks.routes[namesUrl('de')] = namesFile('de');
    await client.ensureMedia({ force: true });
    expect(storedNames().locale).toBe('de');
  });

  test('a file that isn\'t the language asked for is not stored', async () => {
    const routes = withNames(releaseRoutes(R1), R1, { de: 1 });
    routes[namesUrl('de')] = namesFile('fr');
    load({ language: 'de', routes });
    const reporter = jest.fn();
    client.setErrorReporter(reporter);
    await client.ensureMedia();
    expect(storedNames()).toBeUndefined();
    expect(reporter).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Invalid de names file') }), expect.anything());
  });

  async function installR1(versions = { de: 1 }) {
    load({ language: 'de', routes: withNames(releaseRoutes(R1), R1, versions) });
    await client.ensureMedia();
    mocks.data.media_discovery.lastCheckedAt = 0;
    global.fetch.mockClear();
  }

  test('a new release with the same names file doesn\'t download it again', async () => {
    await installR1();
    Object.assign(mocks.routes, withNames(releaseRoutes(R2), R2, { de: 1 }));
    expect((await client.refreshRelease()).status).toBe('switched');
    expect(mocks.fetchedUrls()).not.toContain(namesUrl('de'));
    expect(storedNames().url).toBe(namesUrl('de'));
  });

  test('a new release with changed names downloads them with the release', async () => {
    await installR1();
    Object.assign(mocks.routes, withNames(releaseRoutes(R2), R2, { de: 2 }));
    await client.refreshRelease();
    expect(storedNames()).toMatchObject({ url: namesUrl('de', 2), names: { barswa: 'de barswa v2' } });
  });

  test('an older release without names (a rollback) keeps the stored ones', async () => {
    await installR1();
    Object.assign(mocks.routes, releaseRoutes(R2));
    expect((await client.refreshRelease()).status).toBe('switched');
    await client.ensureMedia();
    expect(storedNames().locale).toBe('de');
  });

  test('the browser\'s language changed: the next start swaps the names', async () => {
    await installR1({ de: 1, fr: 1 });
    chrome.i18n.getUILanguage.mockImplementation(() => 'fr-FR');
    await client.ensureMedia();
    expect(storedNames()).toMatchObject({ locale: 'fr', url: namesUrl('fr') });
  });

  test('…to English, or to a language the release has no names for: they\'re removed', async () => {
    await installR1();
    chrome.i18n.getUILanguage.mockImplementation(() => 'en');
    await client.ensureMedia();
    expect(storedNames()).toBeUndefined();

    await installR1();
    chrome.i18n.getUILanguage.mockImplementation(() => 'ja');
    await client.ensureMedia();
    expect(storedNames()).toBeUndefined();
  });

  test('a new release removes names in a language it has none for', async () => {
    await installR1();
    chrome.i18n.getUILanguage.mockImplementation(() => 'ja');
    Object.assign(mocks.routes, withNames(releaseRoutes(R2), R2, { fr: 1 }));
    await client.refreshRelease();
    expect(storedNames()).toBeUndefined();
  });

  test('clearManifestCache removes them', async () => {
    await installR1();
    await client.clearManifestCache();
    expect(storedNames()).toBeUndefined();
  });

  test('every bundled bird is named in every language with a names file', () => {
    load({ language: 'zh-TW' });
    const bundled = require('../data/bundledBirds.json').species;
    for (const species of bundled) {
      expect(Object.keys(species.names).sort()).toEqual(['ar', 'de', 'es', 'fr', 'ja', 'pl', 'pt_BR', 'pt_PT', 'ru', 'zh_CN', 'zh_HK', 'zh_TW']);
    }
    const shown = client.getBundledBird();
    expect(names.localizedName(shown)).toBe(bundled.find(s => s.speciesCode === shown.speciesCode).names.zh_TW);
  });
});
