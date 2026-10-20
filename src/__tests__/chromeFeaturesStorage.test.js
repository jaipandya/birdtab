/**
 * Chrome-first features that keep state: Your Birds, favorites, holding a bird,
 * "Open BirdTab" (and boot.js), Guess the Bird, and the quiz on your own birds.
 */

import fs from 'fs';
import path from 'path';
import CONFIG from '../config.js';
import { recordSighting, getSeenBirds, clearSeenBirds } from '../seenBirds.js';
import { toggleFavorite, isFavorite, getFavorites, clearFavorites } from '../favorites.js';
import { getHeldBird, rememberShownBird } from '../birdRotation.js';
import { initNewTabMode, setNewTabMode, isPinnedToToolbar, noteChromeTabUse, hasSteppedAside } from '../newTabMode.js';
import { applyQuickGuess } from '../quickGuess.js';
import QuizMode from '../quiz.js';
import { getBirdByCode } from '../mediaClient.js';
import { resetBirdNames } from '../birdNames.js';

jest.mock('../analytics.js', () => ({ trackFeature: jest.fn(), trackQuizCompleted: jest.fn() }));
jest.mock('../sentry.js', () => ({ captureException: jest.fn() }));
jest.mock('../mediaCache.js', () => ({ resolveMediaUrl: jest.fn(), isMediaCached: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../mediaClient.js', () => ({
  getBirdByCode: jest.fn(() => Promise.resolve(null)),
  getSelectedRegion: jest.fn(() => Promise.resolve('WLD')),
}));

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** chrome.storage local and sync in memory, with callbacks, promises and change events */
function installChrome({ withGetKeys = true } = {}) {
  const listeners = [];
  const area = (name) => {
    const data = {};
    const api = {
      data,
      get: jest.fn((keys, cb) => {
        let out = {};
        if (keys == null) out = clone(data);
        else if (typeof keys === 'string' || Array.isArray(keys)) {
          for (const k of [].concat(keys)) if (k in data) out[k] = clone(data[k]);
        } else {
          for (const k of Object.keys(keys)) out[k] = k in data ? clone(data[k]) : keys[k];
        }
        if (cb) cb(out);
        return Promise.resolve(out);
      }),
      set: jest.fn((obj, cb) => {
        const changes = {};
        for (const k of Object.keys(obj)) {
          changes[k] = { oldValue: data[k], newValue: obj[k] };
          data[k] = clone(obj[k]);
        }
        listeners.forEach(l => l(changes, name));
        if (cb) cb();
        return Promise.resolve();
      }),
      remove: jest.fn((keys, cb) => {
        [].concat(keys).forEach(k => { delete data[k]; });
        if (cb) cb();
        return Promise.resolve();
      }),
    };
    if (withGetKeys) api.getKeys = jest.fn(() => Promise.resolve(Object.keys(data)));
    return api;
  };
  global.chrome = {
    ...global.chrome,
    storage: { local: area('local'), sync: area('sync'), onChanged: { addListener: (f) => listeners.push(f) } },
    i18n: { getMessage: jest.fn(() => ''), getUILanguage: () => 'en' },
    tabs: { update: jest.fn() },
    action: undefined,
  };
  return global.chrome;
}

const bird = (code, extra = {}) => ({ speciesCode: code, name: `Bird ${code}`, imageUrl: `https://media/${code}.avif`, ...extra });

const FEATURES = ['newTabMode', 'birdRotation', 'favorites', 'yourBirds', 'quickGuess'];
beforeAll(() => { FEATURES.forEach(f => { CONFIG.FEATURES[f] = true; }); });
afterAll(() => { FEATURES.forEach(f => { CONFIG.FEATURES[f] = false; }); });

describe('Your Birds (seenBirds.js)', () => {
  test('fills from the viewing history once, each species once', async () => {
    const chrome = installChrome();
    chrome.storage.local.data.viewHistory = { value: [
      bird('a', { timestamp: 100 }), bird('b', { timestamp: 200 }), bird('a', { timestamp: 300 }),
    ] };
    const seen = await getSeenBirds();
    expect(seen.map(e => e.bird.speciesCode)).toEqual(['a', 'b']);
    expect(seen[0]).toMatchObject({ firstSeen: 100, lastSeen: 300 });
    expect(chrome.storage.local.data.seenBirdsCount).toBe(2);
  });

  test('a new species returns the new count; a repeat returns null and moves it to the top', async () => {
    const chrome = installChrome();
    chrome.storage.local.data.seenBirdsBackfilled = true;
    expect(await recordSighting(bird('a', { autoPlay: true }))).toBe(1);
    expect(await recordSighting(bird('b'))).toBe(2);
    expect(await recordSighting(bird('a'))).toBeNull();
    expect(chrome.storage.local.data['seen:a'].bird.autoPlay).toBeUndefined();
    const seen = await getSeenBirds();
    expect(seen.map(e => e.bird.speciesCode)[0]).toBe('a');
    expect(chrome.storage.local.data.seenBirdsCount).toBe(2);
  });

  test('works without storage.getKeys (Chrome before 130, Firefox before 143)', async () => {
    const chrome = installChrome({ withGetKeys: false });
    chrome.storage.local.data.seenBirdsBackfilled = true;
    await recordSighting(bird('a'));
    await recordSighting(bird('b'));
    expect((await getSeenBirds()).length).toBe(2);
  });

  test('clearing empties the list, the count and the history, but not favorites', async () => {
    const chrome = installChrome();
    chrome.storage.local.data.seenBirdsBackfilled = true;
    chrome.storage.local.data.viewHistory = { value: [bird('a')] };
    chrome.storage.sync.data.favoriteSpecies = ['a'];
    await recordSighting(bird('a'));
    await clearSeenBirds();
    expect(await getSeenBirds()).toEqual([]);
    expect(chrome.storage.local.data.seenBirdsCount).toBe(0);
    expect(chrome.storage.local.data.viewHistory).toBeUndefined();
    expect(chrome.storage.sync.data.favoriteSpecies).toEqual(['a']);
  });

  test('records nothing when the feature is off', async () => {
    installChrome();
    CONFIG.FEATURES.yourBirds = false;
    try {
      expect(await recordSighting(bird('a'))).toBeNull();
    } finally {
      CONFIG.FEATURES.yourBirds = true;
    }
  });
});

describe('Favorites (favorites.js)', () => {
  test('toggling adds codes to sync (newest first) and details to local, and removes them again', async () => {
    const chrome = installChrome();
    expect(await toggleFavorite(bird('a'))).toBe(true);
    expect(await toggleFavorite(bird('b'))).toBe(true);
    expect(chrome.storage.sync.data.favoriteSpecies).toEqual(['b', 'a']);
    expect(chrome.storage.local.data.favoriteBirds.a.name).toBe('Bird a');
    expect(await isFavorite('a')).toBe(true);
    expect(await toggleFavorite(bird('a'))).toBe(false);
    expect(chrome.storage.sync.data.favoriteSpecies).toEqual(['b']);
    expect(chrome.storage.local.data.favoriteBirds.a).toBeUndefined();
  });

  test('a favorite from another computer is filled from the manifest, else named by its code', async () => {
    const chrome = installChrome();
    chrome.storage.sync.data.favoriteSpecies = ['known', 'unknown'];
    getBirdByCode.mockImplementation((code) => Promise.resolve(code === 'known' ? bird('known') : null));
    const favorites = await getFavorites();
    expect(favorites[0].name).toBe('Bird known');
    expect(favorites[1]).toEqual({ speciesCode: 'unknown', name: 'unknown' });
  });

  test('clearing removes every favorite', async () => {
    const chrome = installChrome();
    await toggleFavorite(bird('a'));
    await clearFavorites();
    expect(chrome.storage.sync.data.favoriteSpecies).toEqual([]);
    expect(await getFavorites()).toEqual([]);
  });
});

describe('Holding a bird (birdRotation.js)', () => {
  const navigation = (type) => { performance.getEntriesByType = jest.fn(() => [{ type }]); };

  test('every tab never holds', async () => {
    const chrome = installChrome();
    navigation('navigate');
    chrome.storage.local.data.birdRotation = 'every';
    await rememberShownBird(bird('a'));
    expect(await getHeldBird()).toBeNull();
  });

  test('hourly holds the last bird on a new tab, with the current auto-play setting', async () => {
    const chrome = installChrome();
    navigation('navigate');
    chrome.storage.local.data.birdRotation = 'hourly';
    chrome.storage.local.data.autoPlay = true;
    await rememberShownBird(bird('a'));
    expect(await getHeldBird()).toMatchObject({ speciesCode: 'a', autoPlay: true });
  });

  test('a reload (the refresh button, picking a bird) always brings a new bird', async () => {
    const chrome = installChrome();
    navigation('reload');
    chrome.storage.local.data.birdRotation = 'daily';
    await rememberShownBird(bird('a'));
    expect(await getHeldBird()).toBeNull();
  });

  test('an hour later the hold is over', async () => {
    const chrome = installChrome();
    navigation('navigate');
    chrome.storage.local.data.birdRotation = 'hourly';
    chrome.storage.local.data.currentBird = { bird: bird('a'), shownAt: Date.now() - 61 * 60 * 1000 };
    expect(await getHeldBird()).toBeNull();
  });
});

describe('Open BirdTab (newTabMode.js)', () => {
  beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });

  test('boot.js gets a copy of the setting, and the time BirdTab was shown', async () => {
    const chrome = installChrome();
    chrome.storage.local.data.newTabMode = 'button';
    await initNewTabMode();
    expect(localStorage.getItem('birdtab:newTabMode')).toBe('button');
    expect(Number(localStorage.getItem('birdtab:lastShown'))).toBeGreaterThan(0);
    await setNewTabMode('every');
    expect(localStorage.getItem('birdtab:newTabMode')).toBeNull();
    expect(chrome.storage.local.data.newTabMode).toBe('every');
  });

  test('an unknown mode is ignored', async () => {
    const chrome = installChrome();
    await setNewTabMode('sometimes');
    expect(chrome.storage.local.data.newTabMode).toBeUndefined();
  });

  test('the pin check says null where Chrome cannot tell', async () => {
    const chrome = installChrome();
    expect(await isPinnedToToolbar()).toBeNull();
    chrome.action = { getUserSettings: () => Promise.resolve({ isOnToolbar: true }) };
    expect(await isPinnedToToolbar()).toBe(true);
  });

  test('uses of the Chrome Tab shortcut are counted (the guide offers to step aside after a few)', async () => {
    const chrome = installChrome();
    await noteChromeTabUse();
    await noteChromeTabUse();
    expect(chrome.storage.local.data.chromeTabUses).toBe(2);
  });
});

describe('boot.js', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'boot.js'), 'utf8');
  const run = ({ mode, navType = 'navigate', lastShown, search = '' }) => {
    localStorage.clear();
    if (mode) localStorage.setItem('birdtab:newTabMode', mode);
    if (lastShown) localStorage.setItem('birdtab:lastShown', String(lastShown));
    window.history.replaceState({}, '', `/index.html${search}`);
    performance.getEntriesByType = jest.fn(() => [{ type: navType }]);
    window.matchMedia = jest.fn(() => ({ matches: false }));
    delete window.__birdtabSteppedAside;
    const chrome = installChrome();
    new Function(source)();
    return chrome.tabs.update.mock.calls.length > 0;
  };

  test('every tab (no setting) shows BirdTab', () => {
    expect(run({})).toBe(false);
  });

  test('"when I ask" sends a new tab to Chrome\'s page, and marks it for script.js', () => {
    expect(run({ mode: 'button' })).toBe(true);
    expect(hasSteppedAside()).toBe(true);
  });

  test('the toolbar button (?open), a reload and Back always show BirdTab', () => {
    expect(run({ mode: 'button', search: '?open' })).toBe(false);
    expect(run({ mode: 'button', navType: 'reload' })).toBe(false);
    expect(run({ mode: 'button', navType: 'back_forward' })).toBe(false);
  });

  test('"now and then" shows BirdTab after an hour away, and steps aside within it', () => {
    expect(run({ mode: 'hourly', lastShown: Date.now() - 2 * 60 * 60 * 1000 })).toBe(false);
    expect(run({ mode: 'hourly', lastShown: Date.now() - 5 * 60 * 1000 })).toBe(true);
  });
});

describe('Guess the Bird (quickGuess.js)', () => {
  test('the first click reveals the name and stops there; later clicks reach the name as usual', () => {
    installChrome();
    document.body.innerHTML = `
      <div class="info-panel"><div class="info-panel-header"><button id="bird-name">Painted Bunting</button></div></div>`;
    const button = document.getElementById('bird-name');
    const opened = jest.fn();
    button.addEventListener('click', opened);
    applyQuickGuess(button);
    expect(button.textContent).not.toBe('Painted Bunting');
    button.click();
    expect(button.textContent).toBe('Painted Bunting');
    expect(opened).not.toHaveBeenCalled();
    button.click();
    expect(opened).toHaveBeenCalledTimes(1);
  });
});

describe('Quiz me on these (quiz.js)', () => {
  const region = Array.from({ length: 12 }, (_, i) => ({ speciesCode: `r${i}`, primaryComName: `Region ${i}`, imageUrl: `https://media/r${i}.avif` }));
  const mine = ['x', 'y', 'z', 'w'].map(c => ({ speciesCode: c, primaryComName: `Mine ${c}`, imageUrl: `https://media/${c}.avif` }));

  test('asks only about the given birds, with wrong answers from the region', async () => {
    const ctx = { questionBirds: mine, startImagePreloading: jest.fn() };
    await QuizMode.prototype.prepareQuestions.call(ctx, region);
    expect(ctx.questions).toHaveLength(4);
    for (const q of ctx.questions) {
      expect(mine.map(b => b.speciesCode)).toContain(q.bird.speciesCode);
      expect(q.options).toHaveLength(4);
      expect(q.options.filter(o => o.isCorrect)).toEqual([{ name: q.bird.primaryComName, isCorrect: true }]);
      for (const wrong of q.options.filter(o => !o.isCorrect)) expect(wrong.name).toMatch(/^Region /);
    }
  });

  test('the answers are in the UI language when names are stored', async () => {
    installChrome();
    chrome.i18n.getUILanguage = () => 'de';
    resetBirdNames();
    const names = Object.fromEntries([...region, ...mine].map(b => [b.speciesCode, `Vogel ${b.speciesCode}`]));
    await chrome.storage.local.set({ media_names: { locale: 'de', url: 'x', names } });
    const ctx = { questionBirds: mine, startImagePreloading: jest.fn() };
    await QuizMode.prototype.prepareQuestions.call(ctx, region);
    for (const q of ctx.questions) {
      expect(q.correctAnswer).toBe(`Vogel ${q.bird.speciesCode}`);
      expect(q.options.filter(o => o.isCorrect)).toEqual([{ name: q.correctAnswer, isCorrect: true }]);
      for (const wrong of q.options.filter(o => !o.isCorrect)) expect(wrong.name).toMatch(/^Vogel r/);
    }
    resetBirdNames();
  });

  test('without a list it is the normal ten-question region quiz', async () => {
    const ctx = { questionBirds: null, startImagePreloading: jest.fn() };
    await QuizMode.prototype.prepareQuestions.call(ctx, region);
    expect(ctx.questions).toHaveLength(10);
    expect(ctx.questions.every(q => q.bird.speciesCode.startsWith('r'))).toBe(true);
  });
});
