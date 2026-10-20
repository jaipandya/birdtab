/**
 * The guide (guide/guide.js): one tip at a time, paced, never one already learned (by its own
 * button, by using the feature, or by an older flag), and not again after being ignored twice.
 */

jest.mock('../analytics.js', () => ({
  track: jest.fn(), trackFeature: jest.fn(), trackReviewPromptAction: jest.fn(), trackReviewPromptShown: jest.fn(),
}));
jest.mock('../pinCoach.js', () => ({ showPinCoach: jest.fn() }));

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function installChrome({ local = {}, sync = {} } = {}) {
  const listeners = [];
  const area = (name, initial) => {
    const data = clone(initial);
    return {
      data,
      get: jest.fn(async (keys) => {
        if (keys == null) return clone(data);
        return Object.fromEntries([].concat(keys).filter(k => k in data).map(k => [k, clone(data[k])]));
      }),
      set: jest.fn(async (obj) => {
        const changes = {};
        for (const [k, v] of Object.entries(obj)) {
          changes[k] = { oldValue: data[k], newValue: v };
          data[k] = clone(v);
        }
        listeners.forEach(l => l(changes, name));
      }),
      remove: jest.fn(async (keys) => { [].concat(keys).forEach(k => delete data[k]); }),
    };
  };
  global.chrome = {
    storage: { local: area('local', local), sync: area('sync', sync), onChanged: { addListener: (f) => listeners.push(f), removeListener() {} } },
    i18n: { getMessage: jest.fn(() => ''), getUILanguage: () => 'en' },
    tabs: { create: jest.fn() },
    runtime: { sendMessage: jest.fn() },
  };
  return global.chrome;
}

function loadGuide(browser = 'chrome') {
  process.env.BROWSER = browser;
  process.env.NODE_ENV = 'test';
  jest.resetModules();
  return require('../guide/guide.js');
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const fresh = () => ({ tabs: 0, lastShownAt: 0, lastShownTab: null, shown: {} });
const ctxFor = (overrides = {}) => ({
  tabs: 2, seen: 2, days: 0, reviewDue: false, local: {}, sync: {}, learned: {}, ...overrides,
});
const ids = (tips) => tips.map(t => t.id);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('choosing a tip', () => {
  test('nothing on the first tab after the welcome; the bird name on the second', () => {
    const { pickTips } = loadGuide();
    expect(ids(pickTips(ctxFor({ tabs: 1 }), fresh()))).toEqual([]);
    expect(ids(pickTips(ctxFor({ tabs: 2 }), fresh()))).toEqual(['birdName']);
  });

  test('a tip waits PACE_TABS tabs and PACE_MS after the last', () => {
    const { pickTips, PACE_TABS, PACE_MS } = loadGuide();
    const now = 10 * DAY;
    const state = { ...fresh(), lastShownTab: 2, lastShownAt: now - 10 * 60 * 1000, shown: { birdName: 1 } };
    // (jsdom isn't Chrome, so Chrome's footer note is out: the heart is next)
    const ctx = (tabs) => ctxFor({ tabs, seen: 6, learned: { birdName: true } });
    expect(ids(pickTips(ctx(2 + PACE_TABS), state, now))).toEqual([]);
    expect(ids(pickTips(ctx(2 + PACE_TABS - 1), { ...state, lastShownAt: now - PACE_MS }, now))).toEqual([]);
    expect(ids(pickTips(ctx(2 + PACE_TABS), { ...state, lastShownAt: now - PACE_MS }, now))).toEqual(['favorite']);
  });

  test('learned tips never show, whether learned here or by an older flag', () => {
    const { pickTips } = loadGuide();
    expect(ids(pickTips(ctxFor({ learned: { birdName: true } }), fresh()))).toEqual([]);
    // Users who finished tour version 4 were shown the bird name already
    expect(ids(pickTips(ctxFor({ sync: { featureTourVersion: 4 } }), fresh()))).toEqual([]);
    // The footer note they closed before, the heart they already use
    const later = ctxFor({ tabs: 9, seen: 12, learned: { birdName: true, yourBirds: true },
      local: { chromeFooterNotificationDismissed: true }, sync: { favoriteSpecies: ['ostric2'] } });
    expect(ids(pickTips(later, fresh()))).not.toEqual(expect.arrayContaining(['chromeFooter', 'favorite']));
  });

  test('a tip shown twice without an answer isn’t shown again', () => {
    const { pickTips, IMPRESSIONS } = loadGuide();
    const state = { ...fresh(), shown: { birdName: IMPRESSIONS } };
    expect(ids(pickTips(ctxFor(), state))).toEqual([]);
  });

  test('Your Birds at ten birds, the quiz at twenty after two days', () => {
    const { pickTips } = loadGuide();
    const learned = { birdName: true, chromeFooter: true, favorite: true, chromeTab: true };
    expect(ids(pickTips(ctxFor({ tabs: 30, seen: 10, learned }), fresh()))).toEqual(['yourBirds']);
    expect(ids(pickTips(ctxFor({ tabs: 30, seen: 20, days: 1, learned: { ...learned, yourBirds: true } }), fresh()))).toEqual([]);
    expect(ids(pickTips(ctxFor({ tabs: 30, seen: 20, days: 2, learned: { ...learned, yourBirds: true } }), fresh()))).toEqual(['quiz']);
    // Guess the bird already on: the quiz tip has nothing new to say
    expect(ids(pickTips(ctxFor({ tabs: 30, seen: 20, days: 2, local: { quickGuess: true }, learned: { ...learned, yourBirds: true } }), fresh()))).toEqual([]);
  });

  test('stepping aside is offered after three trips to Chrome’s page, on the very next tab', () => {
    const { pickTips } = loadGuide('chrome');
    const state = { ...fresh(), lastShownTab: 5, lastShownAt: Date.now(), shown: { birdName: 1 } };
    const ctx = ctxFor({ tabs: 6, learned: { birdName: true }, local: { chromeTabUses: 3 } });
    expect(ids(pickTips(ctx, state))[0]).toBe('stepAside');
    // Not once BirdTab steps aside, nor after the offer was closed
    expect(ids(pickTips({ ...ctx, local: { chromeTabUses: 3, newTabMode: 'hourly' } }, state))).not.toContain('stepAside');
    expect(ids(pickTips({ ...ctx, local: { chromeTabUses: 3, stepAsideOfferDismissed: true } }, state))).not.toContain('stepAside');
  });

  test('Firefox has no Chrome tips', () => {
    const { pickTips } = loadGuide('firefox');
    const ctx = ctxFor({ tabs: 20, days: 3, learned: { birdName: true }, local: { chromeTabUses: 5 } });
    const shown = ids(pickTips(ctx, fresh()));
    expect(shown).not.toContain('stepAside');
    expect(shown).not.toContain('chromeTab');
    expect(shown).not.toContain('chromeFooter');
  });

  test('the review comes when it’s due, and again later', () => {
    const { pickTips } = loadGuide();
    const all = { birdName: true, chromeFooter: true, favorite: true, chromeTab: true, yourBirds: true, quiz: true, review: true };
    expect(ids(pickTips(ctxFor({ tabs: 60, learned: all, reviewDue: true }), { ...fresh(), shown: { review: 5 } }))).toEqual(['review']);
    expect(ids(pickTips(ctxFor({ tabs: 60, learned: all, reviewDue: false }), fresh()))).toEqual([]);
  });
});

describe('a tip on the page', () => {
  beforeEach(() => {
    // jsdom lays nothing out: every element counts as shown
    Element.prototype.getClientRects = function () { return [{ width: 10, height: 10 }]; };
  });

  test('beside its target; using the target learns it, once, in sync storage', async () => {
    const chrome = installChrome();
    const { showTip } = loadGuide();
    document.body.innerHTML = '<div class="info-panel"><button id="bird-name">Osprey</button></div>';
    expect(await showTip('birdName')).toBe(true);
    expect(document.querySelector('.guide-tip')).not.toBeNull();
    expect(document.querySelector('.guide-beacon')).not.toBeNull();

    document.getElementById('bird-name').click();
    await new Promise(r => setTimeout(r, 0));
    expect(chrome.storage.sync.data.seenFeatures).toEqual({ birdName: true });
  });

  test('closing it means not again, and runs its own dismissal (the footer note’s flag)', async () => {
    const chrome = installChrome();
    const { showTip } = loadGuide();
    // jsdom's userAgent isn't Chrome's: the footer tip is for Chrome only
    Object.defineProperty(navigator, 'vendor', { value: 'Google Inc.', configurable: true });
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 Chrome/141.0', configurable: true });
    expect(await showTip('chromeFooter')).toBe(true);
    document.querySelector('.guide-tip-close').click();
    await new Promise(r => setTimeout(r, 0));
    expect(chrome.storage.sync.data.seenFeatures.chromeFooter).toBe(true);
    expect(chrome.storage.local.data.chromeFooterNotificationDismissed).toBe(true);
  });

  test('a hidden target (Guess the bird, low-distraction mode) means no tip', async () => {
    installChrome();
    const { showTip } = loadGuide();
    document.body.innerHTML = '<div class="info-panel"><button id="bird-name" class="guess-hidden">Who’s this bird?</button></div>';
    expect(await showTip('birdName')).toBe(false);
    document.body.innerHTML = '<div class="info-panel low-distraction-hidden"><button id="bird-name">Osprey</button></div>';
    expect(await showTip('birdName')).toBe(false);
  });

  test('the milestone note shows unless the Your Birds tip has the floor', async () => {
    const chrome = installChrome({ local: { seenBirdsCount: 10, guideState: { tabs: 40, lastShownTab: 39, lastShownAt: Date.now(), shown: {} } } });
    const { runGuide } = loadGuide();
    await runGuide({ milestone: 10 });
    // Paced out (a tip on the last tab): the note speaks instead
    expect(document.querySelector('.life-list-milestone')).not.toBeNull();
    expect(chrome.storage.local.data.guideState.tabs).toBe(41);

    // A new page: nothing shown lately, the earlier tips learned
    document.body.innerHTML = '<button id="settings-button"></button>';
    chrome.storage.local.data.guideState = { tabs: 40, lastShownTab: null, lastShownAt: 0, shown: {} };
    chrome.storage.sync.data.seenFeatures = { birdName: true, chromeFooter: true };
    const pending = loadGuide().runGuide({ milestone: 10 });
    await new Promise(r => setTimeout(r, 50));
    expect(document.querySelector('.life-list-milestone')).toBeNull();
    await pending;
    expect(document.querySelector('.guide-tip-yourBirds')).not.toBeNull();
  });
});

describe('stepping aside', () => {
  beforeEach(() => {
    Element.prototype.getClientRects = function () { return [{ width: 10, height: 10 }]; };
    document.body.innerHTML = '<a id="chrome-tab-link"><span class="chrome-tab-icon"></span></a>';
  });

  test('all three ways are offered, the one in use marked; keeping it changes nothing', async () => {
    const chrome = installChrome({ local: { chromeTabUses: 3 } });
    const { showTip } = loadGuide('chrome');
    expect(await showTip('stepAside')).toBe(true);
    const choices = [...document.querySelectorAll('.guide-choice')];
    expect(choices).toHaveLength(3);
    expect(choices[0].classList.contains('current')).toBe(true);
    choices[0].click();
    await new Promise(r => setTimeout(r, 0));
    expect(chrome.storage.local.data.newTabMode).toBeUndefined();
    expect(chrome.storage.local.data.stepAsideOfferDismissed).toBe(true);
  });

  test('a change applies at once, says so in the card, and Undo takes it back', async () => {
    const chrome = installChrome({ local: { chromeTabUses: 3 } });
    const { showTip } = loadGuide('chrome');
    await showTip('stepAside');
    document.querySelectorAll('.guide-choice')[2].click();
    await new Promise(r => setTimeout(r, 0));
    expect(chrome.storage.local.data.newTabMode).toBe('button');
    // Still open, now with Undo
    const undo = [...document.querySelectorAll('.guide-btn')].find(b => b.textContent === 'Undo');
    expect(undo).toBeDefined();
    undo.click();
    await new Promise(r => setTimeout(r, 0));
    expect(chrome.storage.local.data.newTabMode).toBe('every');
    // Answered: not offered again
    expect(chrome.storage.local.data.stepAsideOfferDismissed).toBe(true);
  });
});

describe('users from before the guide', () => {
  test('no tip on the first tabs after the update; a new install starts at once', async () => {
    const chrome = installChrome({ local: { seenBirdsCount: 30 } });
    const { runGuide, startGuide } = loadGuide();
    await runGuide();
    await runGuide();
    expect(chrome.storage.local.data.guideState).toMatchObject({ tabs: 2, lastShownTab: 0 });
    expect(chrome.storage.local.data.guideState.lastShownAt).toBeGreaterThan(Date.now() - 60000);
    expect(document.querySelector('.guide-tip')).toBeNull();

    await startGuide();
    expect(chrome.storage.local.data.guideState).toEqual({ tabs: 0, lastShownAt: 0, lastShownTab: null, shown: {} });
  });
});
