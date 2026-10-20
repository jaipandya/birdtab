/**
 * The welcome (welcome/welcome.js): the song plays from the card, the suggested region is chosen,
 * and "Start birding" or "Skip" saves exactly what was chosen and brings in the page.
 */

jest.mock('../analytics.js', () => ({ track: jest.fn(), trackOnboardingCompleted: jest.fn() }));
jest.mock('../welcome/regionSuggest.js', () => ({
  ...jest.requireActual('../welcome/regionSuggest.js'),
  browserTimeZone: () => 'Asia/Calcutta',
}));

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const flush = () => new Promise(r => setTimeout(r, 0));

function installChrome() {
  const listeners = [];
  const area = (name, initial = {}) => {
    const data = clone(initial);
    return {
      data,
      get: jest.fn(async (keys) => Object.fromEntries([].concat(keys).filter(k => k in data).map(k => [k, clone(data[k])]))),
      set: jest.fn(async (obj) => {
        const changes = {};
        for (const [k, v] of Object.entries(obj)) {
          changes[k] = { oldValue: data[k], newValue: v };
          data[k] = clone(v);
        }
        listeners.forEach(l => l(changes, name));
      }),
      remove: jest.fn(async () => {}),
    };
  };
  const regions = [{ code: 'WLD', speciesCount: 500 }, { code: 'IN', speciesCount: 298 }, { code: 'KE', speciesCount: 290 }];
  global.chrome = {
    storage: {
      local: area('local', { region: 'WLD', media_release: { index: { regions } } }),
      sync: area('sync', { onboardingComplete: false }),
      session: area('session'),
      onChanged: { addListener: (f) => listeners.push(f), removeListener: (f) => listeners.splice(listeners.indexOf(f), 1) },
    },
    i18n: { getMessage: jest.fn(() => ''), getUILanguage: () => 'en' },
    runtime: { sendMessage: jest.fn((message, cb) => cb?.({ success: true, region: message.region })), lastError: undefined },
  };
  return global.chrome;
}

async function open() {
  process.env.BROWSER = process.env.BROWSER || 'chrome';
  const chrome = installChrome();
  jest.resetModules();
  const { showWelcome } = require('../welcome/welcome.js');
  const audio = { toggle: jest.fn(async () => {}), pause: jest.fn() };
  const onDone = jest.fn();
  await showWelcome({ birdName: 'Osprey', songLength: '0:46', audio, onDone });
  await flush();
  await flush();
  return { chrome, audio, onDone, $: (s) => document.querySelector(s) };
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.matchMedia = () => ({ matches: true });
});

test('the first bird and its song, from the card', async () => {
  const { audio, $ } = await open();
  expect($('.welcome-bird-name').textContent).toBe('Osprey');
  $('.welcome-song').click();
  expect(audio.toggle).toHaveBeenCalledTimes(1);
  document.dispatchEvent(new CustomEvent('birdtab:audio', { detail: { playing: true, currentTime: 23, duration: 46 } }));
  expect($('.welcome-song').classList.contains('playing')).toBe(true);
  expect($('.welcome-song-label').textContent).toBe('Pause');
  expect($('.welcome-song-progress i').style.transform).toBe('scaleX(0.5)');
  document.dispatchEvent(new CustomEvent('birdtab:audio', { detail: { playing: false } }));
  expect($('.welcome-song-label').textContent).toBe('Play again');
});

test('Start birding: the suggested region, songs as asked, and the page comes back', async () => {
  const { chrome, onDone, $ } = await open();
  $('[data-action="next"]').click();
  expect($('[data-step="setup"]').hidden).toBe(false);
  // The time zone's country is suggested and chosen
  expect($('input[name="welcome-region"]:checked').value).toBe('IN');

  $('input[name="welcome-sound"][value="on"]').click();
  expect($('.welcome-quiet').hidden).toBe(false);
  $('[data-action="start"]').click();
  await flush();
  await flush();

  expect(chrome.storage.local.data).toMatchObject({ autoPlay: true, quietHours: true });
  expect(chrome.storage.sync.data.onboardingComplete).toBe(true);
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'switchRegion', region: 'IN' }, expect.any(Function));
  expect(onDone).toHaveBeenCalledTimes(1);
  expect($('.welcome-note')).not.toBeNull();
});

test('World, and songs only on request: nothing to download, quiet hours untouched', async () => {
  const { chrome, $ } = await open();
  $('[data-action="next"]').click();
  $('input[name="welcome-region"][value="WLD"]').click();
  $('[data-action="start"]').click();
  await flush();
  await flush();
  expect(chrome.storage.local.data.autoPlay).toBe(false);
  expect(chrome.storage.local.data.quietHours).toBeUndefined();
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'switchRegion' }), expect.anything());
});

test('Skip changes nothing but finishes the welcome', async () => {
  const { chrome, onDone, $ } = await open();
  $('[data-action="skip"]').click();
  await flush();
  await flush();
  expect(chrome.storage.local.data.region).toBe('WLD');
  expect(chrome.storage.local.data.autoPlay).toBe(false);
  expect(chrome.storage.sync.data.onboardingComplete).toBe(true);
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('finished in another tab: this one steps aside too', async () => {
  const { chrome, onDone } = await open();
  await chrome.storage.sync.set({ onboardingComplete: true });
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('Firefox: the note says to keep the new tab page when Firefox asks', async () => {
  process.env.BROWSER = 'firefox';
  try {
    const { $ } = await open();
    $('[data-action="skip"]').click();
    await flush();
    await flush();
    expect($('.welcome-note-sub')?.textContent).toBe('If Firefox asks about your new tab page, keep the change.');
  } finally {
    process.env.BROWSER = 'chrome';
  }
});

test('the new-tab keys are ⌘ T on a Mac', async () => {
  Object.defineProperty(navigator, 'userAgentData', { value: { platform: 'macOS' }, configurable: true });
  try {
    const { $ } = await open();
    $('[data-action="skip"]').click();
    await flush();
    await flush();
    expect([...document.querySelectorAll('.welcome-note kbd')].map(k => k.textContent)).toEqual(['⌘', 'T']);
  } finally {
    delete navigator.userAgentData;
  }
});
