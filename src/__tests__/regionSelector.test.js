/**
 * Settings region dropdown: labels, ordering, loading, failure and retry.
 */

import { indexJson, installMocks } from './fixtures/mediaRelease.js';

const en = require('../_locales/en/messages.json');

const R1 = 'm261020r01';

let RegionSelector;
let buildRegionOptions;
let getRegionLabel;
let formatProgress;
let mocks;
let select;
let status;

function englishMessage(key, substitutions = []) {
  const message = en[key]?.message;
  if (!message) return '';
  const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
  return message.replace(/\$(\d)/g, (_, n) => subs[Number(n) - 1] ?? '');
}

function storedRelease(codes) {
  return { schemaVersion: 2, release: R1, indexUrl: 'x', index: indexJson(R1, codes), storedAt: 1 };
}

function setup({ storage = {}, session = {}, uiLanguage = 'en', respond = () => ({ success: true }) } = {}) {
  mocks = installMocks({ storage });
  Object.assign(mocks.session.data, session);
  chrome.i18n.getMessage.mockImplementation(englishMessage);
  chrome.i18n.getUILanguage.mockImplementation(() => uiLanguage);
  chrome.runtime.sendMessage.mockImplementation((message, callback) => {
    Promise.resolve(respond(message)).then(response => callback(response));
  });

  jest.resetModules();
  ({ RegionSelector, buildRegionOptions, getRegionLabel, formatProgress } = require('../regionSelector.js'));

  document.body.innerHTML = `
    <select id="modal-region"><option value="WLD">World</option></select>
    <p id="modal-region-status" hidden></p>
  `;
  select = document.getElementById('modal-region');
  status = document.getElementById('modal-region-status');
}

function optionLabels() {
  return [...select.options].map(o => o.textContent);
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('region labels and order', () => {
  test('World first with its count, then countries by localized name', () => {
    setup();
    const regions = [
      { code: 'WLD', name: 'World', speciesCount: 500 },
      { code: 'US', name: 'United States', speciesCount: 300 },
      { code: 'IN', name: 'India', speciesCount: 243 },
      { code: 'DE', name: 'Germany', speciesCount: 1234 },
    ];

    const options = buildRegionOptions(regions, 'en');

    expect(options.map(o => o.label)).toEqual([
      'World',
      'Germany',
      'India',
      'United States',
    ]);
  });

  test('uses Intl.DisplayNames in the UI language and sorts by that name', () => {
    setup({ uiLanguage: 'de' });
    const options = buildRegionOptions([
      { code: 'IN', name: 'India', speciesCount: 243 },
      { code: 'DE', name: 'Germany', speciesCount: 300 },
      { code: 'WLD', name: 'World', speciesCount: 500 },
    ], 'de');

    expect(options.map(o => o.code)).toEqual(['WLD', 'DE', 'IN']);
    expect(options[1].name).toBe('Deutschland');
    expect(options[2].name).toBe('Indien');
    expect(options[2].label).toBe('Indien');
  });

  test('non-ISO codes use the index name; High Seas uses i18n', () => {
    setup();
    expect(getRegionLabel({ code: 'XX', name: 'High Seas', speciesCount: 2 }, 'en')).toBe('High Seas');
    expect(getRegionLabel({ code: 'CS', name: 'Coral Sea Islands', speciesCount: 9 }, 'en')).toBe('Coral Sea Islands');
    expect(getRegionLabel({ code: 'XK', name: 'Kosovo', speciesCount: 9 }, 'en')).toBe('Kosovo');
    expect(getRegionLabel({ code: 'ZZZ', name: 'Somewhere', speciesCount: 1 }, 'en')).toBe('Somewhere');
  });
});

describe('RegionSelector', () => {
  test('fills the list from storage without asking the background', async () => {
    setup({ storage: { region: 'IN', media_release: storedRelease(['WLD', 'IN', 'US']) } });
    const selector = new RegionSelector({ select, status });

    await selector.load();

    expect(optionLabels()).toEqual(['World', 'India', 'United States']);
    expect(select.value).toBe('IN');
    expect(status.hidden).toBe(true);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test('with no stored list, loads the index in the background', async () => {
    let resolveResponse;
    setup({ respond: () => new Promise(resolve => { resolveResponse = resolve; }) });
    jest.useFakeTimers();
    const selector = new RegionSelector({ select, status });

    const loading = selector.load();
    await Promise.resolve();
    await Promise.resolve();
    expect(select.disabled).toBe(true);
    expect(optionLabels()).toEqual(['World']);
    jest.advanceTimersByTime(300);
    expect(status.textContent).toBe('Loading regions…');

    mocks.data.media_release = storedRelease(['WLD', 'IN']);
    resolveResponse({ success: true });
    jest.useRealTimers();
    await loading;

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'loadRegionIndex' }, expect.any(Function));
    expect(select.disabled).toBe(false);
    expect(optionLabels()).toHaveLength(2);
    expect(status.hidden).toBe(true);
  });

  test('shows a failure with a retry when the list cannot be loaded', async () => {
    let succeed = false;
    setup({
      respond: () => {
        if (succeed) mocks.data.media_release = storedRelease(['WLD', 'US']);
        return { success: succeed };
      }
    });
    const selector = new RegionSelector({ select, status });

    await selector.load();

    expect(status.hidden).toBe(false);
    expect(status.textContent).toContain("Couldn't load the list of regions.");
    expect(optionLabels()).toEqual(['World']);
    expect(select.disabled).toBe(false);

    succeed = true;
    status.querySelector('button').click();
    await flush();
    await flush();

    expect(optionLabels()).toEqual(['World', 'United States']);
    expect(status.hidden).toBe(true);
  });

  test('switching region shows loading text after a short delay, then applies', async () => {
    let resolveSwitch;
    setup({
      storage: { region: 'WLD', media_release: storedRelease(['WLD', 'IN']) },
      respond: message => message.action === 'switchRegion'
        ? new Promise(resolve => { resolveSwitch = resolve; })
        : { success: true },
    });
    const onRegionChanged = jest.fn();
    const selector = new RegionSelector({ select, status, onRegionChanged });
    await selector.load();
    jest.useFakeTimers();

    select.value = 'IN';
    select.dispatchEvent(new Event('change'));
    await Promise.resolve();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'switchRegion', region: 'IN' }, expect.any(Function));
    // no flash for fast switches
    jest.advanceTimersByTime(299);
    expect(status.hidden).toBe(true);
    jest.advanceTimersByTime(1);
    expect(status.textContent).toBe('Loading birds for India…');
    // the dropdown stays usable
    expect(select.disabled).toBe(false);
    jest.useRealTimers();

    resolveSwitch({ success: true, region: 'IN', previousRegion: 'WLD' });
    await flush();

    expect(select.value).toBe('IN');
    expect(select.disabled).toBe(false);
    expect(status.hidden).toBe(true);
    expect(onRegionChanged).toHaveBeenCalledWith('IN');
  });

  test('a failed switch keeps the previous region, says so, and retries', async () => {
    let fail = true;
    setup({
      storage: { region: 'WLD', media_release: storedRelease(['WLD', 'IN']) },
      respond: message => message.action === 'switchRegion'
        ? (fail ? { success: false, error: 'HTTP 500' } : { success: true })
        : { success: true },
    });
    const onRegionChanged = jest.fn();
    const selector = new RegionSelector({ select, status, onRegionChanged });
    await selector.load();

    select.value = 'IN';
    select.dispatchEvent(new Event('change'));
    await flush();

    expect(select.value).toBe('WLD');
    expect(status.textContent).toContain("Couldn't load birds for India. Still showing World.");
    expect(onRegionChanged).not.toHaveBeenCalled();

    fail = false;
    status.querySelector('button').click();
    await flush();

    expect(select.value).toBe('IN');
    expect(onRegionChanged).toHaveBeenCalledWith('IN');
    expect(status.hidden).toBe(true);
  });

  test('offline: the stored list still shows', async () => {
    setup({
      storage: { region: 'US', media_release: storedRelease(['WLD', 'IN', 'US']) },
      respond: () => ({ success: false }),
    });
    const selector = new RegionSelector({ select, status });
    await selector.load();
    expect(optionLabels()).toHaveLength(3);
    expect(select.value).toBe('US');
  });
});

describe('progress text', () => {
  test('a percentage in the UI language, capped below 100% until stored', () => {
    setup();
    expect(formatProgress(420, 1000, 'en')).toBe('42%');
    expect(formatProgress(420, 1000, 'de')).toBe('42\u00a0%');
    expect(formatProgress(2000, 1000, 'en')).toBe('99%');
    expect(formatProgress(0, 1000, 'en')).toBe('0%');
  });

  test('no percentage when the size is unknown', () => {
    setup();
    expect(formatProgress(420, null, 'en')).toBe('');
    expect(formatProgress(420, 0, 'en')).toBe('');
  });
});

describe('RegionSelector while a region downloads', () => {
  const KEY = 'regionSwitchState';
  let pending;

  function setupSwitching({ region = 'WLD', session = {} } = {}) {
    pending = {};
    setup({
      storage: { region, media_release: storedRelease(['WLD', 'IN', 'US']) },
      session,
      respond: message => message.action === 'switchRegion'
        ? new Promise(resolve => { pending[message.region] = resolve; })
        : { success: true },
    });
  }

  function choose(code) {
    select.value = code;
    select.dispatchEvent(new Event('change'));
  }

  function switchMessages() {
    return chrome.runtime.sendMessage.mock.calls.map(c => c[0]).filter(m => m.action === 'switchRegion').map(m => m.region);
  }

  afterEach(() => {
    jest.useRealTimers();
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  });

  test('shows the download percentage from the background', async () => {
    setupSwitching();
    const selector = new RegionSelector({ select, status });
    await selector.load();
    jest.useFakeTimers({ now: 5000 });

    choose('IN');
    jest.advanceTimersByTime(300);
    expect(status.textContent).toBe('Loading birds for India…');

    await mocks.session.set({ [KEY]: { code: 'IN', state: 'loading', received: 420, expected: 1000, updatedAt: 5300 } });
    expect(status.textContent).toBe('Loading birds for India… 42%');

    // a progress update for another region is ignored
    await mocks.session.set({ [KEY]: { code: 'US', state: 'loading', received: 900, expected: 1000, updatedAt: 5300 } });
    expect(status.textContent).toBe('Loading birds for India… 42%');
  });

  test('picking another region replaces the download; the replaced one shows nothing', async () => {
    setupSwitching();
    const onRegionChanged = jest.fn();
    const selector = new RegionSelector({ select, status, onRegionChanged });
    await selector.load();
    jest.useFakeTimers();

    choose('IN');
    jest.advanceTimersByTime(300);
    choose('US');
    expect(select.value).toBe('US');
    expect(status.textContent).toBe('Loading birds for United States…');
    expect(switchMessages()).toEqual(['IN', 'US']);

    jest.useRealTimers();
    pending.IN({ success: false, superseded: true, region: 'IN' });
    await flush();
    expect(select.value).toBe('US');
    expect(status.textContent).toBe('Loading birds for United States…');
    expect(status.classList.contains('region-status-error')).toBe(false);

    pending.US({ success: true, region: 'US', previousRegion: 'WLD' });
    await flush();
    expect(select.value).toBe('US');
    expect(status.hidden).toBe(true);
    expect(onRegionChanged).toHaveBeenCalledTimes(1);
    expect(onRegionChanged).toHaveBeenCalledWith('US');
  });

  test('picking the loading region again sends nothing new', async () => {
    setupSwitching();
    const selector = new RegionSelector({ select, status });
    await selector.load();

    choose('IN');
    choose('IN');
    expect(switchMessages()).toEqual(['IN']);
  });

  test('picking World while a region loads switches at once', async () => {
    setupSwitching({ region: 'US' });
    const selector = new RegionSelector({ select, status });
    await selector.load();

    choose('IN');
    choose('WLD');
    expect(switchMessages()).toEqual(['IN', 'WLD']);

    pending.WLD({ success: true, region: 'WLD', previousRegion: 'US' });
    pending.IN({ success: false, superseded: true, region: 'IN' });
    await flush();
    expect(select.value).toBe('WLD');
    expect(status.hidden).toBe(true);
  });

  test('a failure after being replaced is ignored', async () => {
    setupSwitching();
    const selector = new RegionSelector({ select, status });
    await selector.load();

    choose('IN');
    choose('US');
    pending.IN({ success: false, error: 'HTTP 500' });
    await flush();
    expect(status.classList.contains('region-status-error')).toBe(false);
    expect(select.value).toBe('US');
  });

  test('on open, shows a download in progress and joins it', async () => {
    setupSwitching({
      session: { [KEY]: { code: 'IN', state: 'loading', received: 250, expected: 1000, updatedAt: Date.now() - 1000 } },
    });
    const onRegionChanged = jest.fn();
    const selector = new RegionSelector({ select, status, onRegionChanged });

    await selector.load();

    expect(select.value).toBe('IN');
    expect(status.textContent).toBe('Loading birds for India… 25%');
    expect(switchMessages()).toEqual(['IN']);

    pending.IN({ success: true, region: 'IN', previousRegion: 'WLD' });
    await flush();
    expect(select.value).toBe('IN');
    expect(status.hidden).toBe(true);
    expect(onRegionChanged).toHaveBeenCalledWith('IN');
  });

  test('on open, a loading state not updated for 30 s is shown as failed', async () => {
    setupSwitching({
      session: { [KEY]: { code: 'IN', state: 'loading', received: 250, expected: 1000, updatedAt: Date.now() - 31000 } },
    });
    const selector = new RegionSelector({ select, status });

    await selector.load();

    expect(select.value).toBe('WLD');
    expect(status.textContent).toContain("Couldn't load birds for India. Still showing World.");
    expect(status.querySelector('button')).not.toBeNull();
    expect(switchMessages()).toEqual([]);

    status.querySelector('button').click();
    expect(switchMessages()).toEqual(['IN']);
    expect(select.value).toBe('IN');
  });

  test('on open, a recent failure is shown with its retry; an old one is not', async () => {
    setupSwitching({
      session: { [KEY]: { code: 'US', state: 'failed', received: 0, expected: 1000, updatedAt: Date.now() - 60000, error: 'HTTP 500' } },
    });
    let selector = new RegionSelector({ select, status });
    await selector.load();
    expect(status.textContent).toContain("Couldn't load birds for United States.");

    setupSwitching({
      session: { [KEY]: { code: 'US', state: 'failed', received: 0, expected: 1000, updatedAt: Date.now() - 6 * 60000, error: 'HTTP 500' } },
    });
    selector = new RegionSelector({ select, status });
    await selector.load();
    expect(status.hidden).toBe(true);
  });

  test('on open, a loading state for the region already in use is cleared', async () => {
    setupSwitching({
      region: 'IN',
      session: { [KEY]: { code: 'IN', state: 'loading', received: 900, expected: 1000, updatedAt: Date.now() } },
    });
    const selector = new RegionSelector({ select, status });
    await selector.load();
    expect(select.value).toBe('IN');
    expect(status.hidden).toBe(true);
    expect(switchMessages()).toEqual([]);
  });

  test('reopening settings on the same page keeps showing the download', async () => {
    setupSwitching();
    const selector = new RegionSelector({ select, status });
    await selector.load();
    choose('IN');

    await selector.load();
    expect(select.value).toBe('IN');
    expect(status.textContent).toBe('Loading birds for India…');
    expect(switchMessages()).toEqual(['IN']);
  });

  test('offline: fails at once with the usual message, without asking the background', async () => {
    setupSwitching();
    const selector = new RegionSelector({ select, status });
    await selector.load();
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });

    choose('IN');

    expect(switchMessages()).toEqual([]);
    expect(select.value).toBe('WLD');
    expect(status.textContent).toContain("Couldn't load birds for India. Still showing World.");

    // World needs no download
    choose('WLD');
    expect(status.hidden).toBe(true);
  });
});
