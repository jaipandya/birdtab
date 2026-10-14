/**
 * Region Selector
 *
 * Fills the settings region <select> from the stored release index and
 * switches regions through the background service worker.
 *
 * - The list comes from storage (works offline). With no stored index it
 *   shows a short loading state and asks the background to discover the release.
 * - Choosing a region keeps the current bird on screen and shows
 *   "Loading birds for India…" until the region's manifest is stored.
 *   On failure the previous region stays selected, with a retry.
 */

import CONFIG from './config.js';
import { getMessage, getUILanguage } from './i18n.js';
import { log } from './logger.js';
import { RELEASE_KEY } from './mediaClient.js';

const WORLD = CONFIG.MEDIA.DEFAULT_REGION;
const HIGH_SEAS = 'XX';
// Codes eBird uses that are not ISO 3166 countries (or mean something else
// in CLDR, e.g. CS); show the index name for these.
const NON_ISO_REGION_CODES = new Set([HIGH_SEAS, 'AC', 'CP', 'CS', 'XK']);
// Loading text appears only if something takes longer than this
const LOADING_TEXT_DELAY_MS = 300;

function safeUILanguage() {
  try {
    return getUILanguage() || 'en';
  } catch {
    return 'en';
  }
}

/**
 * Localized name of a region: World and High Seas from i18n, ISO 3166 codes
 * via Intl.DisplayNames in the UI language, else the index's English name.
 */
export function getRegionDisplayName(region, uiLanguage = safeUILanguage()) {
  if (region.code === WORLD) {
    return getMessage('regionWorld');
  }
  if (region.code === HIGH_SEAS) {
    return getMessage('regionHighSeas');
  }
  if (/^[A-Z]{2}$/.test(region.code) && !NON_ISO_REGION_CODES.has(region.code)) {
    try {
      const displayNames = new Intl.DisplayNames([uiLanguage, 'en'], { type: 'region', fallback: 'none' });
      const localized = displayNames.of(region.code);
      if (localized) return localized;
    } catch {
      // Unsupported language tag or code; use the index name
    }
  }
  return region.name || region.code;
}

/**
 * Option label: the region's localized name.
 */
export function getRegionLabel(region, uiLanguage = safeUILanguage()) {
  return getRegionDisplayName(region, uiLanguage);
}

/**
 * Options for the dropdown: World first, then by localized name.
 * @returns {Array<{code: string, name: string, label: string}>}
 */
export function buildRegionOptions(regions, uiLanguage = safeUILanguage()) {
  let collator;
  try {
    collator = new Intl.Collator(uiLanguage);
  } catch {
    collator = new Intl.Collator();
  }

  const options = (regions || [])
    .filter(region => region && typeof region.code === 'string')
    .map(region => ({
      code: region.code,
      name: getRegionDisplayName(region, uiLanguage),
      label: getRegionLabel(region, uiLanguage),
    }));

  const world = options.filter(o => o.code === WORLD);
  const rest = options
    .filter(o => o.code !== WORLD)
    .sort((a, b) => collator.compare(a.name, b.name));
  return [...world, ...rest];
}

function sendMessage(message) {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { success: false });
        }
      });
    } catch (error) {
      resolve({ success: false, error: error.message });
    }
  });
}

export class RegionSelector {
  /**
   * @param {Object} options
   * @param {HTMLSelectElement} options.select
   * @param {HTMLElement} options.status - live region for loading/failure text
   * @param {(region: string) => void} [options.onRegionChanged] - after a successful switch
   */
  constructor({ select, status, onRegionChanged = () => {} }) {
    this.select = select;
    this.status = status;
    this.onRegionChanged = onRegionChanged;
    this.currentRegion = WORLD;
    this.options = [];
    this.indexLoaded = false;
    this.busy = false;
    this.loadingTimer = null;

    this.select.addEventListener('change', () => this.switchTo(this.select.value));
  }

  /**
   * Read the stored list and region; fetch the list in the background if none is stored.
   */
  async load() {
    const { [RELEASE_KEY]: stored, region } = await chrome.storage.local.get([RELEASE_KEY, 'region']);
    if (!this.busy) {
      this.currentRegion = region || WORLD;
    }

    if (stored?.index?.regions?.length) {
      this.render(stored.index.regions);
      if (!this.busy) this.clearStatus();
      return;
    }

    // No stored list yet: World alone until the index arrives
    this.render([{ code: WORLD }]);
    await this.fetchIndex();
  }

  async fetchIndex() {
    this.select.disabled = true;
    this.showStatusLater(getMessage('regionLoadingList'));

    const response = await sendMessage({ action: 'loadRegionIndex' });
    this.select.disabled = false;

    if (response.success) {
      const { [RELEASE_KEY]: stored } = await chrome.storage.local.get([RELEASE_KEY]);
      if (stored?.index?.regions?.length) {
        this.render(stored.index.regions);
        this.clearStatus();
        return;
      }
    }

    log(`Region list unavailable: ${response.error || response.status || 'no index'}`);
    this.showStatus(getMessage('regionListFailed'), () => this.fetchIndex());
  }

  render(regions) {
    this.options = buildRegionOptions(regions);
    this.indexLoaded = this.options.length > 1;
    const fragment = document.createDocumentFragment();
    for (const option of this.options) {
      const el = document.createElement('option');
      el.value = option.code;
      el.textContent = option.label;
      fragment.appendChild(el);
    }
    // A selected region missing from the list (shouldn't happen) still shows
    if (!this.options.some(o => o.code === this.currentRegion)) {
      const el = document.createElement('option');
      el.value = this.currentRegion;
      el.textContent = this.currentRegion;
      fragment.appendChild(el);
    }
    this.select.replaceChildren(fragment);
    this.select.value = this.currentRegion;
  }

  nameOf(code) {
    return this.options.find(o => o.code === code)?.name || code;
  }

  async switchTo(code) {
    if (this.busy) return;
    if (code === this.currentRegion) {
      this.clearStatus();
      return;
    }

    const previous = this.currentRegion;
    this.busy = true;
    this.select.disabled = true;
    this.select.value = code;
    this.showStatusLater(getMessage('regionLoadingBirds', [this.nameOf(code)]), 0);

    const response = await sendMessage({ action: 'switchRegion', region: code });

    this.busy = false;
    this.select.disabled = false;

    if (response.success) {
      this.currentRegion = code;
      this.select.value = code;
      this.clearStatus();
      this.onRegionChanged(code);
      return;
    }

    log(`Region switch to ${code} failed: ${response.error}`);
    this.select.value = previous;
    this.showStatus(
      getMessage('regionSwitchFailed', [this.nameOf(code), this.nameOf(previous)]),
      () => this.switchTo(code)
    );
  }

  showStatusLater(text, delay = LOADING_TEXT_DELAY_MS) {
    clearTimeout(this.loadingTimer);
    if (delay <= 0) {
      this.showStatus(text);
      return;
    }
    this.loadingTimer = setTimeout(() => this.showStatus(text), delay);
  }

  showStatus(text, retry = null) {
    clearTimeout(this.loadingTimer);
    this.status.replaceChildren();
    const message = document.createElement('span');
    message.textContent = text;
    this.status.appendChild(message);
    this.status.classList.toggle('region-status-error', !!retry);

    if (retry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'region-retry-button';
      button.textContent = getMessage('tryAgain');
      button.addEventListener('click', retry);
      this.status.appendChild(button);
    }
    this.status.hidden = false;
  }

  clearStatus() {
    clearTimeout(this.loadingTimer);
    this.status.replaceChildren();
    this.status.classList.remove('region-status-error');
    this.status.hidden = true;
  }
}

export default RegionSelector;
