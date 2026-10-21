/**
 * Settings window: holds every setting the browser has, reads and saves them, shows one
 * section at a time, opens and closes; dev builds add the Debug Options section.
 */

import { indexJson, installMocks } from './fixtures/mediaRelease.js';

const en = require('../_locales/en/messages.json');

const COMMON_IDS = ['modal-region', 'modal-quick-guess', 'modal-auto-play', 'modal-quiet-hours',
  'modal-quiet-hours-start', 'modal-quiet-hours-end', 'modal-clock-display', 'modal-enable-productivity'];

let mocks;
let panelModule;

function englishMessage(key, substitutions = []) {
  const message = en[key]?.message;
  if (!message) return '';
  const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
  return message.replace(/\$(\d)/g, (_, n) => subs[Number(n) - 1] ?? '');
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

async function setup({ browser = 'chrome', env = 'test', storage = {} } = {}) {
  process.env.BROWSER = browser;
  process.env.NODE_ENV = env;
  mocks = installMocks({
    storage: {
      region: 'WLD',
      media_release: { schemaVersion: 2, release: 'm261020r01', indexUrl: 'x', index: indexJson('m261020r01', ['WLD', 'IN']), storedAt: 1 },
      ...storage,
    },
  });
  chrome.i18n.getMessage.mockImplementation(englishMessage);
  chrome.runtime.sendMessage.mockImplementation((message, callback) => callback?.({ success: true }));
  document.body.innerHTML = '<button id="settings-button"></button>';
  jest.resetModules();
  panelModule = require('../settings/settingsPanel.js');
  panelModule.initSettingsPanel();
  await flush();
}

const root = () => document.getElementById('settings-panel');
const $ = (id) => document.getElementById(id);
const shownSections = () => [...root().querySelectorAll('.sp-page .pref-section')].filter(s => !s.hidden).map(s => s.dataset.section);
const navKeys = () => [...root().querySelectorAll('.sp-nav-item')].map(item => item.dataset.section);

afterEach(() => {
  panelModule?.resetSettingsPanel();
  delete process.env.BROWSER;
  process.env.NODE_ENV = 'test';
});

describe('what each browser gets', () => {
  test('Chrome: every setting, four sections', async () => {
    await setup();
    for (const id of [...COMMON_IDS, 'modal-google-apps', 'modal-chrome-tab']) {
      expect($(id)).not.toBeNull();
    }
    expect(document.querySelectorAll('input[name="new-tab-mode"]')).toHaveLength(3);
    expect(navKeys()).toEqual(['birds', 'newTab', 'sound', 'page']);
    // One element per id, so labels and descriptions point at the right thing
    const ids = [...root().querySelectorAll('[id]')].map(el => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('Firefox: no New Tab section and no Chrome Tab Shortcut', async () => {
    await setup({ browser: 'firefox' });
    for (const id of [...COMMON_IDS, 'modal-google-apps']) expect($(id)).not.toBeNull();
    expect($('modal-chrome-tab')).toBeNull();
    expect(document.querySelectorAll('input[name="new-tab-mode"]')).toHaveLength(0);
    expect(navKeys()).toEqual(['birds', 'sound', 'page']);
  });

  test('Edge: no Google Apps row', async () => {
    await setup({ browser: 'edge' });
    expect($('modal-google-apps')).toBeNull();
    expect($('modal-chrome-tab')).not.toBeNull();
    expect(document.querySelectorAll('input[name="new-tab-mode"]')).toHaveLength(3);
  });
});

test('the bird choices are segments, the line under them says what the chosen one means', async () => {
  await setup({ storage: { birdRotation: 'hourly' } });
  const segments = [...root().querySelectorAll('.pref-segment')];
  expect(segments.map(s => s.textContent.trim())).toEqual(['One tab', 'An hour', 'A day']);
  expect(segments.map(s => s.classList.contains('selected'))).toEqual([false, true, false]);
  expect($('bird-rotation-caption').textContent).toBe('The same bird for an hour, then a new one.');

  document.querySelector('input[name="bird-rotation"][value="daily"]').click();
  expect($('bird-rotation-caption').textContent).toBe('One bird for the whole day.');
  expect(segments[2].classList.contains('selected')).toBe(true);
});

test('shows what is stored and saves a change', async () => {
  await setup({ storage: { clockDisplayMode: 'clock', birdRotation: 'hourly', autoPlay: true } });
  expect($('modal-clock-display').checked).toBe(true);
  expect($('modal-auto-play').checked).toBe(true);
  expect(document.querySelector('input[name="bird-rotation"]:checked').value).toBe('hourly');

  $('modal-clock-display').click();
  document.querySelector('input[name="bird-rotation"][value="daily"]').click();
  await flush();
  expect(mocks.local.data.clockDisplayMode).toBe('off');
  expect(mocks.local.data.birdRotation).toBe('daily');
});

test('the side list shows one section at a time and moves focus to it', async () => {
  await setup();
  expect(shownSections()).toEqual(['birds']);
  root().querySelector('.sp-nav-item[data-section="sound"]').click();
  expect(shownSections()).toEqual(['sound']);
  expect(root().querySelector('[aria-current]').dataset.section).toBe('sound');
  expect(document.activeElement).toBe($('settings-page-sound'));
});

test('the region list closes when another section is shown, or the window closes', async () => {
  await setup();
  panelModule.openSettings();
  $('modal-region').click();
  expect($('region-picker').hidden).toBe(false);
  root().querySelector('.sp-nav-item[data-section="sound"]').click();
  expect($('region-picker').hidden).toBe(true);

  root().querySelector('.sp-nav-item[data-section="birds"]').click();
  $('modal-region').click();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(root().classList.contains('open')).toBe(false);
  expect($('region-picker').hidden).toBe(true);
});

test('arrow keys move through the side list', async () => {
  await setup();
  const items = [...root().querySelectorAll('.sp-nav-item')];
  items[0].focus();
  items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  expect(document.activeElement).toBe(items[1]);
  items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  expect(document.activeElement).toBe(items[items.length - 1]);
});

test('opens, and closes on Escape or a click beside it', async () => {
  await setup();
  panelModule.openSettings();
  expect(root().classList.contains('open')).toBe(true);
  expect(document.activeElement).toBe(root().querySelector('.settings-panel-surface'));

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(root().classList.contains('open')).toBe(false);
  expect(document.activeElement).toBe($('settings-button'));

  panelModule.openSettings();
  root().click();
  expect(root().classList.contains('open')).toBe(false);

  panelModule.openSettings();
  root().querySelector('.pref-label').click();
  expect(root().classList.contains('open')).toBe(true);
});

test('Debug Options: a section in dev builds only', async () => {
  await setup({ env: 'development' });
  expect(navKeys()).toContain('debug');
  expect($('debug-tip')).not.toBeNull();

  panelModule.resetSettingsPanel();
  await setup({ env: 'production' });
  expect(navKeys()).not.toContain('debug');
  expect(root().querySelector('.settings-debug')).toBeNull();
});
