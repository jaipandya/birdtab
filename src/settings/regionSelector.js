/**
 * Region Selector
 *
 * Fills the settings region list (regionPicker.js) from the stored release
 * index and switches regions through the background service worker.
 *
 * - The list comes from storage (works offline). With no stored index it
 *   shows a short loading state and asks the background to discover the release.
 * - Choosing a region keeps the current bird on screen and shows
 *   "Loading birds for India… 42%" until the region's manifest is stored.
 *   The list stays usable: choosing another region replaces the
 *   download, and a replaced switch shows nothing.
 *   On failure the previous region stays selected, with a retry.
 * - The background mirrors the switch in chrome.storage.session
 *   (regionSwitchState), so reopening settings shows a download still in
 *   progress, or a recent failure.
 */

import CONFIG from '../config.js';
import { getMessage, getUILanguage } from '../i18n.js';
import { log } from '../logger.js';
import { RELEASE_KEY } from '../mediaClient.js';

const WORLD = CONFIG.MEDIA.DEFAULT_REGION;
const { REGION_SWITCH_STATE_KEY, REGION_SWITCH_STALE_MS } = CONFIG.MEDIA;
const HIGH_SEAS = 'XX';
// Codes eBird uses that are not ISO 3166 countries (or mean something else
// in CLDR, e.g. CS); show the index name for these.
const NON_ISO_REGION_CODES = new Set([HIGH_SEAS, 'AC', 'CP', 'CS', 'XK']);
// Loading text appears only if something takes longer than this
const LOADING_TEXT_DELAY_MS = 300;
// A failure found on opening settings is shown if it is this recent
const RECENT_FAILURE_MS = 5 * 60 * 1000;

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
 * The list's regions: World first, then by localized name. `indexName` is the
 * release's own (English) name, so a search finds a region by either.
 * @returns {Array<{code: string, name: string, indexName: string}>}
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
      indexName: region.name || region.code,
    }));

  const world = options.filter(o => o.code === WORLD);
  const rest = options
    .filter(o => o.code !== WORLD)
    .sort((a, b) => collator.compare(a.name, b.name));
  return [...world, ...rest];
}

/**
 * "42%" in the UI language, or '' when the size is unknown. Never shows
 * 100% before the switch is done (the manifest still has to be stored).
 */
export function formatProgress(received, expected, uiLanguage = safeUILanguage()) {
  if (!(expected > 0) || !Number.isFinite(received)) return '';
  const fraction = Math.min(Math.max(received / expected, 0), 0.99);
  try {
    return new Intl.NumberFormat([uiLanguage, 'en'], { style: 'percent', maximumFractionDigits: 0 }).format(fraction);
  } catch {
    return `${Math.floor(fraction * 100)}%`;
  }
}

function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

async function readSwitchState() {
  try {
    const area = chrome.storage?.session;
    if (!area) return null;
    const { [REGION_SWITCH_STATE_KEY]: state } = await area.get(REGION_SWITCH_STATE_KEY);
    return state || null;
  } catch {
    return null;
  }
}

function clearSwitchState() {
  try {
    chrome.storage?.session?.remove(REGION_SWITCH_STATE_KEY)?.catch?.(() => {});
  } catch {
    // Nothing to clear
  }
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
   * @param {import('./regionPicker.js').RegionPicker} options.picker - the list the user chooses from
   * @param {HTMLElement} options.status - live region for loading/failure text
   * @param {(region: string) => void} [options.onRegionChanged] - after a successful switch
   */
  constructor({ picker, status, onRegionChanged = () => {} }) {
    this.picker = picker;
    this.status = status;
    this.onRegionChanged = onRegionChanged;
    this.currentRegion = WORLD;
    this.options = [];
    // Region being downloaded, its latest progress, and the request token
    // (a response for an older token is a choice the user already replaced)
    this.pendingRegion = null;
    this.progress = null;
    this.requestToken = 0;
    this.loadingTimer = null;

    this.picker.onChoose = (code) => this.switchTo(code);
    try {
      chrome.storage?.onChanged?.addListener((changes, area) => {
        if (area === 'session' && changes[REGION_SWITCH_STATE_KEY]) {
          this.onSwitchStateChanged(changes[REGION_SWITCH_STATE_KEY].newValue);
        }
      });
    } catch {
      // No live progress; the text still updates when the switch ends
    }
  }

  /**
   * Read the stored list and region, and any switch still in progress (or
   * recently failed); fetch the list in the background if none is stored.
   */
  async load() {
    const { [RELEASE_KEY]: stored, region } = await chrome.storage.local.get([RELEASE_KEY, 'region']);
    this.currentRegion = region || WORLD;

    if (!stored?.index?.regions?.length) {
      // No stored list yet: World alone until the index arrives
      this.render([{ code: WORLD }]);
      await this.fetchIndex();
      return;
    }

    this.render(stored.index.regions);
    if (this.pendingRegion) {
      // Settings reopened on this page mid-download: the switch is still ours
      this.picker.value = this.pendingRegion;
      this.showLoading();
    } else {
      await this.restoreSwitchState();
    }
  }

  /**
   * Settings opened while the background is switching (or just failed):
   * show it. A fresh 'loading' state is joined by asking for the same region
   * (the background shares the download); one not updated for
   * REGION_SWITCH_STALE_MS means the service worker stopped: shown as failed.
   */
  async restoreSwitchState() {
    const state = await readSwitchState();
    if (!state?.code || state.code === WORLD || state.code === this.currentRegion) {
      if (!this.pendingRegion) this.clearStatus();
      return;
    }
    const age = Date.now() - (state.updatedAt || 0);

    if (state.state === 'loading' && age < REGION_SWITCH_STALE_MS) {
      this.progress = { received: state.received, expected: state.expected };
      this.startSwitch(state.code, { showNow: true });
      return;
    }

    const failedAgo = state.state === 'loading' ? age - REGION_SWITCH_STALE_MS : age;
    if (failedAgo < RECENT_FAILURE_MS) {
      this.showFailure(state.code);
    } else {
      this.clearStatus();
    }
  }

  async fetchIndex() {
    this.picker.disabled = true;
    this.showStatusLater(getMessage('regionLoadingList'));

    const response = await sendMessage({ action: 'loadRegionIndex' });
    this.picker.disabled = false;

    if (response.success) {
      const { [RELEASE_KEY]: stored } = await chrome.storage.local.get([RELEASE_KEY]);
      if (stored?.index?.regions?.length) {
        this.render(stored.index.regions);
        if (this.pendingRegion) {
          this.picker.value = this.pendingRegion;
          this.showLoading();
        } else {
          this.clearStatus();
        }
        return;
      }
    }

    log(`Region list unavailable: ${response.error || response.status || 'no index'}`);
    this.showStatus(getMessage('regionListFailed'), () => this.fetchIndex());
  }

  render(regions) {
    this.options = buildRegionOptions(regions);
    // A selected region missing from the list (shouldn't happen) still shows
    const options = this.options.some(o => o.code === this.currentRegion)
      ? this.options
      : [...this.options, { code: this.currentRegion, name: this.currentRegion, indexName: this.currentRegion }];
    this.picker.setOptions(options);
    this.picker.value = this.currentRegion;
  }

  nameOf(code) {
    return this.options.find(o => o.code === code)?.name || code;
  }

  loadingText() {
    const text = getMessage('regionLoadingBirds', [this.nameOf(this.pendingRegion)]);
    const percent = this.progress ? formatProgress(this.progress.received, this.progress.expected) : '';
    return percent ? `${text} ${percent}` : text;
  }

  /** Show (or refresh) the loading text for the pending region. */
  showLoading() {
    if (this.pendingRegion) this.showStatus(this.loadingText());
  }

  showFailure(code) {
    this.showStatus(
      getMessage('regionSwitchFailed', [this.nameOf(code), this.nameOf(this.currentRegion)]),
      () => this.switchTo(code)
    );
  }

  onSwitchStateChanged(state) {
    if (!this.pendingRegion || state?.code !== this.pendingRegion || state.state !== 'loading') return;
    this.progress = { received: state.received, expected: state.expected };
    // Before the delay is up the timer shows the latest text itself
    if (!this.loadingTimer && !this.status.hidden) this.showLoading();
  }

  async switchTo(code) {
    if (code === this.pendingRegion) return;

    if (code === this.currentRegion && !this.pendingRegion) {
      // Back to the region in use: nothing to load; forget an old failure
      clearSwitchState();
      this.clearStatus();
      return;
    }

    // Offline: only World and the region in use are stored, so anything else fails now
    if (isOffline() && code !== WORLD && code !== this.currentRegion) {
      if (this.pendingRegion) {
        // Stop the download in progress (switching to the region in use changes nothing)
        this.requestToken++;
        this.pendingRegion = null;
        sendMessage({ action: 'switchRegion', region: this.currentRegion });
      }
      log(`Offline: not switching region to ${code}`);
      this.picker.value = this.currentRegion;
      this.showFailure(code);
      return;
    }

    this.startSwitch(code);
  }

  async startSwitch(code, { showNow = false } = {}) {
    const token = ++this.requestToken;
    if (!showNow) this.progress = null;
    this.pendingRegion = code;
    this.picker.value = code;
    const loadingShown = !this.status.hidden && !this.status.classList.contains('region-status-error');
    if (showNow || loadingShown) {
      // Already showing a download (or restoring one): switch the text now
      this.showLoading();
    } else {
      // Fast switches finish before the text would appear: no flash
      this.clearStatus();
      this.showLoadingLater();
    }

    const response = await sendMessage({ action: 'switchRegion', region: code });
    if (token !== this.requestToken) return; // replaced by a later choice

    this.pendingRegion = null;
    this.progress = null;

    if (response.success) {
      this.currentRegion = response.region || code;
      this.picker.value = this.currentRegion;
      this.clearStatus();
      this.onRegionChanged(this.currentRegion);
      return;
    }

    if (response.superseded) {
      // Replaced from elsewhere (e.g. another tab's settings): show what is stored now
      const { region } = await chrome.storage.local.get(['region']);
      this.currentRegion = region || WORLD;
      this.picker.value = this.currentRegion;
      this.clearStatus();
      await this.restoreSwitchState();
      return;
    }

    log(`Region switch to ${code} failed: ${response.error}`);
    this.picker.value = this.currentRegion;
    this.showFailure(code);
  }

  showLoadingLater() {
    clearTimeout(this.loadingTimer);
    this.loadingTimer = setTimeout(() => {
      this.loadingTimer = null;
      this.showLoading();
    }, LOADING_TEXT_DELAY_MS);
  }

  showStatusLater(text, delay = LOADING_TEXT_DELAY_MS) {
    clearTimeout(this.loadingTimer);
    if (delay <= 0) {
      this.showStatus(text);
      return;
    }
    this.loadingTimer = setTimeout(() => {
      this.loadingTimer = null;
      this.showStatus(text);
    }, delay);
  }

  showStatus(text, retry = null) {
    clearTimeout(this.loadingTimer);
    this.loadingTimer = null;
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
    this.loadingTimer = null;
    this.status.replaceChildren();
    this.status.classList.remove('region-status-error');
    this.status.hidden = true;
  }
}

export default RegionSelector;
