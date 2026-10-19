/**
 * Bird names in the UI language
 *
 * Each media release lists one names file per language (index.names; format in
 * crawlers/RELEASE_FORMAT.md). mediaClient.js stores the one for this browser in
 * chrome.storage.local:
 *
 *   media_names   { locale, url, names: { <speciesCode>: <name> }, storedAt }
 *
 * Names are looked up by species code when a bird is shown, so they apply to birds
 * stored before too (Your Birds, history, favourites, the ready queue). Before a names
 * file is stored, a bird's own names are used: `names` on the bundled birds, then the
 * French and Simplified Chinese names every manifest entry has.
 *
 * No network here: mediaClient.js does the fetching.
 */

export const NAMES_KEY = 'media_names';

// The extension's languages with a names file, besides Chinese (English uses the manifests' names)
const NAMED_LANGUAGES = ['ar', 'de', 'es', 'fr', 'ja', 'pl', 'ru'];

function uiLanguage() {
  try {
    return chrome.i18n.getUILanguage() || '';
  } catch {
    return '';
  }
}

/**
 * The names file for a UI language, following the locale the browser picks for the page
 * (_locales/<ll>_<RR>, then <ll>, then English), so names are in the language of the page.
 * Chinese goes by script: Traditional for Taiwan (zh_TW), Hong Kong and Macau (zh_HK,
 * Hong Kong's names first), Simplified otherwise.
 * @param {string} language - e.g. 'zh-TW', 'pt-BR', 'de-AT', 'en-US'
 * @returns {string|null} 'zh_TW', 'pt_BR', 'de', … or null for English and languages BirdTab isn't in
 */
export function namesLocaleFor(language = uiLanguage()) {
  const [lang = '', ...rest] = String(language || '').replace(/_/g, '-').toLowerCase().split('-');
  if (lang === 'zh') {
    if (rest.includes('hans')) return 'zh_CN';
    if (rest.includes('hk') || rest.includes('mo')) return 'zh_HK';
    if (rest.includes('tw') || rest.includes('hant')) return 'zh_TW';
    return 'zh_CN';
  }
  // Brazil and Portugal; a bare "pt" gets the English page (there's no _locales/pt)
  if (lang === 'pt') return rest.includes('br') ? 'pt_BR' : rest.includes('pt') ? 'pt_PT' : null;
  return NAMED_LANGUAGES.includes(lang) ? lang : null;
}

/** Names files that suit a locale, best first: Hong Kong falls back to Taiwan's. */
export function namesFilesFor(locale) {
  if (!locale) return [];
  return locale === 'zh_HK' ? ['zh_HK', 'zh_TW'] : [locale];
}

/**
 * The index's names file for this browser, or null (English, or a release without names).
 * @returns {{locale: string, url: string, bytes?: number, count?: number}|null}
 */
export function pickNamesEntry(index, language = uiLanguage()) {
  const names = index?.names;
  if (!names || typeof names !== 'object') return null;
  for (const locale of namesFilesFor(namesLocaleFor(language))) {
    const entry = names[locale];
    if (entry && typeof entry.url === 'string') return { ...entry, locale };
  }
  return null;
}

export function isValidNamesFile(file, locale) {
  return !!file
    && typeof file === 'object'
    && file.locale === locale
    && !!file.names
    && typeof file.names === 'object'
    && !Array.isArray(file.names);
}

// --- Reading the stored names -----------------------------------------------

let loaded = null; // { locale, names } once read
let loading = null;
let listening = false;

function listenForChanges() {
  if (listening) return;
  listening = true;
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[NAMES_KEY]) {
        loaded = null;
        loading = null;
      }
    });
  } catch {
    // No storage events here (tests): names are read once
  }
}

/**
 * Read the stored names into memory (once per page, again after they change).
 * Start it early and await it before showing a name. Never rejects.
 * @returns {Promise<{locale: string, names: Object}|null>}
 */
export function loadBirdNames() {
  listenForChanges();
  if (loaded) return Promise.resolve(loaded);
  if (!loading) {
    loading = new Promise(resolve => {
      try {
        chrome.storage.local.get([NAMES_KEY], result => {
          const stored = result?.[NAMES_KEY];
          loaded = stored && stored.names && typeof stored.names === 'object'
            ? { locale: stored.locale, names: stored.names }
            : { locale: null, names: {} };
          resolve(loaded);
        });
      } catch {
        loaded = { locale: null, names: {} };
        resolve(loaded);
      }
    });
  }
  return loading;
}

/** Forget the names read into memory (tests, cache clear). */
export function resetBirdNames() {
  loaded = null;
  loading = null;
}

function legacyName(bird, locale) {
  if (locale === 'fr') return bird.primaryComName_fr;
  // The manifests' only Chinese name is Simplified: better than English for any Chinese reader
  if (locale.startsWith('zh_')) return bird.primaryComName_cn;
  return null;
}

/**
 * The bird's name in the UI language, falling back to English. Uses the names read by
 * loadBirdNames(), so await that first.
 * @param {Object} bird - birdInfo (speciesCode, name/primaryComName, …)
 * @param {string} [language] - UI language, for tests
 */
export function localizedName(bird, language = uiLanguage()) {
  if (!bird) return '';
  const english = bird.name || bird.primaryComName || bird.speciesCode || '';
  const locale = namesLocaleFor(language);
  if (!locale) return english;
  const files = namesFilesFor(locale);
  const fromFile = loaded && files.includes(loaded.locale) ? loaded.names[bird.speciesCode] : null;
  const own = files.map(f => bird.names?.[f]).find(Boolean);
  return fromFile || own || legacyName(bird, locale) || english;
}

/** Every name a bird can be found by: the UI language's, English and scientific. */
export function searchableNames(bird, language = uiLanguage()) {
  return [...new Set([localizedName(bird, language), bird.name, bird.primaryComName, bird.scientificName]
    .filter(Boolean))];
}
