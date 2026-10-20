// Preview harness: dev-chrome/harness.html (or dev-firefox/, dist-*/) opens the new tab page outside the extension with a stubbed
// chrome.* API (in-memory storage seeded past onboarding), for screenshots in any browser.
// Usage: npx webpack --mode development --env BROWSER=chrome && node scripts/preview-harness.js dev-chrome
// Then open dev-chrome/harness.html: #settings #birds #favorites #coach #confirm #error #quiz open that surface;
// ?mode=button ?guess ?review ?seed=8 seed the state; ?welcome shows the welcome (a fresh install's first tab);
// ?tip=<id> shows that tip (guide/guide.js), ?tips lets the guide choose (otherwise every tip counts as learned);
// window.__pinned = true pretends BirdTab is pinned. scripts/screenshot-harness.js captures them all.

const fs = require('fs'); const path = require('path');
const dir = process.argv[2];
const msgs = JSON.parse(fs.readFileSync(path.join(dir, '_locales/en/messages.json'), 'utf8'));
const shim = `
window.__MSGS = ${JSON.stringify(Object.fromEntries(Object.entries(msgs).map(([k, v]) => [k, v.message])))};
(function(){
  const params = new URLSearchParams(location.search);
  const day = 24 * 60 * 60 * 1000;
  const welcome = params.has('welcome');
  // Every tip learned, so tips only show when asked for (?tip=<id>, ?tips)
  const tipsLearned = params.has('tips') || params.has('tip') ? {}
    : Object.fromEntries(['stepAside', 'birdName', 'chromeFooter', 'yourBirds', 'favorite', 'chromeTab', 'quiz'].map(id => [id, true]));
  // ?fresh: ignore what earlier harness pages saved (screenshots start from a clean state)
  const saved = params.has('fresh') ? null : JSON.parse(localStorage.getItem('h:local') || 'null');
  const stores = { local: saved || {
      region: 'WLD', autoPlay: false, newTabMode: params.get('mode') || 'every', birdRotation: 'every', quickGuess: params.has('guess'),
      quickAccessEnabled: true, clockDisplayMode: 'clock', chromeTabEnabled: true,
      viewHistory: { value: [], timestamp: 0 },
      ...(params.has('review') ? { installTime: Date.now() - 10 * day, newTabCount: 80, lastReviewPrompt: 0 } : { installTime: Date.now(), newTabCount: 1 }),
      ...(params.get('tip') === 'stepAside' ? { chromeTabUses: 3 } : {}) },
    sync: { onboardingComplete: !welcome, seenFeatures: tipsLearned, favoriteSpecies: [] },
    session: {} };
  const listeners = [];
  function area(name) {
    const s = stores[name];
    const pick = (keys) => { if (keys == null) return { ...s }; if (typeof keys === 'string') keys = [keys];
      if (Array.isArray(keys)) return Object.fromEntries(keys.filter(k => k in s).map(k => [k, s[k]]));
      return Object.fromEntries(Object.keys(keys).map(k => [k, k in s ? s[k] : keys[k]])); };
    const done = (v, cb) => { if (cb) { setTimeout(() => cb(v), 0); } return Promise.resolve(v); };
    const persist = () => { if (name !== 'local') return; try {
      localStorage.setItem('h:local', JSON.stringify(Object.fromEntries(Object.entries(s).filter(([k]) => !k.startsWith('media_')))));
    } catch (e) { /* quota: keep in memory only */ } };
    return {
      get: (keys, cb) => done(pick(keys), cb),
      set: (obj, cb) => { const changes = {}; for (const k in obj) { changes[k] = { oldValue: s[k], newValue: obj[k] }; s[k] = obj[k]; }
        persist(); setTimeout(() => listeners.forEach(l => l(changes, name)), 0); return done(undefined, cb); },
      remove: (keys, cb) => { [].concat(keys).forEach(k => delete s[k]); persist(); return done(undefined, cb); },
      clear: (cb) => { Object.keys(s).forEach(k => delete s[k]); persist(); return done(undefined, cb); },
      getKeys: () => Promise.resolve(Object.keys(s)),
    };
  }
  // Birds from a stored manifest, else World's from the CDN (no background here to download one),
  // as the background would answer for the quiz
  let manifestPromise = null;
  const loadManifest = () => manifestPromise || (manifestPromise = (async () => {
    const key = Object.keys(stores.local).find(k => k.startsWith('media_region_'));
    if (key) return stores.local[key];
    const current = await (await fetch('https://media.birdtab.app/current.json')).json();
    const index = await (await fetch(current.indexUrl)).json();
    return (await fetch(index.regions.find(r => r.code === 'WLD').url)).json();
  })());
  const manifestBirds = async () => ((await loadManifest()).species || []).map(e => ({ speciesCode: e.speciesCode,
    primaryComName: e.primaryComName, name: e.primaryComName, scientificName: e.scientificName,
    imageUrl: e.image?.renditions?.default?.url, photographer: e.image?.creatorName }));
  const ev = () => ({ addListener() {}, removeListener() {}, hasListener() { return false; } });
  window.chrome = {
    storage: { local: area('local'), sync: area('sync'), session: area('session'), onChanged: { addListener: (f) => listeners.push(f), removeListener() {} } },
    i18n: { getMessage: (k, subs) => { let m = window.__MSGS[k] || ''; [].concat(subs || []).forEach((v, i) => { m = m.replace('$' + (i + 1), v); }); return m; },
            getUILanguage: () => 'en' },
    runtime: { id: 'harness', getURL: (p) => p, onMessage: ev(), getManifest: () => ({ version: '2.1.2' }), lastError: undefined, onInstalled: ev(),
      sendMessage: (m, cb) => {
        const reply = m && m.action === 'getBirdsByRegion'
          ? manifestBirds().then(birds => ({ success: true, birds: birds.slice(0, 80) }))
          : m && m.action === 'loadRegionIndex'
            // The settings region list, from the live release (no background here to discover it)
            ? fetch('https://media.birdtab.app/current.json').then(r => r.json()).then(async (current) => {
                const index = await (await fetch(current.indexUrl)).json();
                await window.chrome.storage.local.set({ media_release: { schemaVersion: current.schemaVersion, release: current.release, indexUrl: current.indexUrl, index, storedAt: Date.now() } });
                return { success: true };
              }).catch(() => ({ success: false }))
            : m && m.action === 'switchRegion'
              // A region download of about two seconds, its progress where the page reads it
              ? (async () => {
                  const state = (received) => ({ regionSwitchState: { code: m.region, state: 'loading', received, expected: 400000, updatedAt: Date.now() } });
                  for (let received = 0; received < 400000; received += 80000) { await window.chrome.storage.session.set(state(received)); await wait(400); }
                  await window.chrome.storage.session.remove(['regionSwitchState']);
                  await window.chrome.storage.local.set({ region: m.region });
                  return { success: true, region: m.region };
                })()
              : Promise.resolve(undefined);
        if (typeof cb === 'function') reply.then(cb);
        return reply;
      } },
    tabs: { create() { return Promise.resolve({}); }, update() { return Promise.resolve({}); }, query: (q, cb) => cb && cb([]), getCurrent: (cb) => { if (cb) cb({ id: 1 }); return Promise.resolve({ id: 1 }); } },
    permissions: { getAll: () => Promise.resolve({ permissions: [], origins: [], data_collection: [] }), contains: (p, cb) => { if (cb) cb(false); return Promise.resolve(false); }, request: (p, cb) => { if (cb) cb(false); return Promise.resolve(false); }, onAdded: ev(), onRemoved: ev() },
    action: { getUserSettings: () => Promise.resolve({ isOnToolbar: window.__pinned === true }) },
    topSites: { get: (cb) => cb([]) }, search: { query() {} },
  };

  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const until = async (test, ms = 15000) => { const end = Date.now() + ms; while (!test() && Date.now() < end) await wait(100); };
  const clickText = (labels) => [...document.querySelectorAll('.options-menu-item, [role=menuitem], button')]
    .find(b => labels.includes(b.textContent.trim()))?.click();
  const openMenuItem = async (labels) => { document.getElementById('settings-button')?.click(); await wait(300); clickText(labels); await wait(700); };

  // ?seed=N: N birds seen (two of them favourites), from the manifest, for Your Birds
  async function seed(n) {
    const birds = (await manifestBirds()).slice(0, n);
    const now = Date.now();
    const local = {};
    birds.forEach((b, i) => { local['seen:' + b.speciesCode] = { bird: b, firstSeen: now - (i + 1) * 3600e3, lastSeen: now - i * 1800e3 }; });
    local.seenBirdsBackfilled = true; local.seenBirdsCount = birds.length;
    await chrome.storage.local.set(local);
    await chrome.storage.sync.set({ favoriteSpecies: birds.slice(1, 3).map(b => b.speciesCode) });
    await chrome.storage.local.set({ favoriteBirds: Object.fromEntries(birds.slice(1, 3).map(b => [b.speciesCode, b])) });
  }

  // ?btn=<direction>: try a button direction by overriding the --btn-* tokens (tokens.css)
  const BUTTON_DIRECTIONS = {
    // The shipped look (tokens.css) is "gilded"; the others override it
    gilded: {},
    honey: {
      '--btn-primary-bg': '#d4a24c',
      '--btn-primary-bg-hover': '#ddb062',
      '--btn-primary-fg': '#2b1d06',
      '--btn-primary-border': 'transparent',
      '--btn-primary-highlight': 'inset 0 1px 0 rgba(255, 255, 255, 0.28), inset 0 -1px 0 rgba(0, 0, 0, 0.12)',
      '--btn-secondary-bg': 'rgba(255, 255, 255, 0.10)',
      '--btn-secondary-bg-hover': 'rgba(255, 255, 255, 0.15)',
      '--btn-secondary-border': 'rgba(255, 255, 255, 0.12)',
      '--btn-secondary-fg': 'rgba(255, 255, 255, 0.90)',
    },
    amber: {
      '--btn-primary-bg': 'rgba(212, 162, 76, 0.18)',
      '--btn-primary-bg-hover': 'rgba(212, 162, 76, 0.28)',
      '--btn-primary-fg': '#f3d391',
      '--btn-primary-border': 'rgba(212, 162, 76, 0.55)',
      '--btn-primary-highlight': 'inset 0 1px 0 rgba(255, 220, 160, 0.12)',
    },
    champagne: {
      '--btn-primary-bg': '#e4c58c',
      '--btn-primary-bg-hover': '#ecd19e',
      '--btn-primary-fg': '#2b1d06',
      '--btn-primary-border': 'transparent',
      '--btn-primary-highlight': 'inset 0 1px 0 rgba(255, 255, 255, 0.42), inset 0 -1px 0 rgba(0, 0, 0, 0.1)',
      '--btn-secondary-bg': 'rgba(255, 236, 205, 0.08)',
      '--btn-secondary-bg-hover': 'rgba(255, 236, 205, 0.13)',
      '--btn-secondary-border': 'rgba(255, 226, 178, 0.16)',
      '--btn-secondary-fg': '#f3eadb',
    },
  };
  const direction = BUTTON_DIRECTIONS[params.get('btn')];
  if (direction && Object.keys(direction).length) {
    const style = document.createElement('style');
    style.textContent = ':root{' + Object.entries(direction).map(([k, v]) => k + ':' + v).join(';') + '}';
    (document.head || document.documentElement).appendChild(style);
    // Also after the bundle's own styles, which are injected later in development builds
    window.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
  }

  // #settings #birds #favorites #coach #confirm #error #quiz: open that surface once the page is ready
  window.addEventListener('load', async () => {
    await until(() => document.getElementById('bird-name')?.textContent);
    if (welcome) {
      await until(() => document.querySelector('.welcome.visible'));
      await wait(700);
      document.documentElement.dataset.harnessReady = 'true';
      return;
    }
    await wait(800);
    if (params.has('seed')) await seed(Number(params.get('seed')) || 8);
    const h = location.hash.slice(1);
    if (h === 'settings') await openMenuItem(['Settings']);
    if (h === 'birds' || h === 'confirm') await openMenuItem(['Your Birds', 'History']);
    if (h === 'favorites') { await openMenuItem(['Your Birds']); document.querySelector('input[name=your-birds-filter][value=favorites]')?.click(); }
    if (h === 'confirm') { await wait(300); document.getElementById('your-birds-clear')?.click(); }
    if (h === 'coach') { await openMenuItem(['Settings']); document.querySelector('[data-debug=pin-coach-steps]')?.click(); }
    if (params.get('tip')) {
      // Through Debug Options, as a developer would
      await openMenuItem(['Settings']);
      const select = document.getElementById('debug-tip');
      if (select) { select.value = params.get('tip'); document.querySelector('[data-debug=show-tip]')?.click(); }
      await until(() => document.querySelector('.guide-tip.visible'), 4000);
      await wait(600);
    }
    if (h === 'error') {
      // As the page's own error state: everything but the error hides
      ['#content-container', '.search-container', '.clock-container', '.timer-container', '.top-sites-container', '#chrome-tab-link']
        .forEach(sel => document.querySelectorAll(sel).forEach(el => { el.style.display = 'none'; }));
      document.getElementById('error-modal')?.classList.remove('hidden');
    }
    if (h === 'quiz') {
      await openMenuItem(['Quiz']);
      await until(() => document.querySelector('.quiz-option:not([disabled]), .quiz-option-btn'));
      await wait(1500);
      document.querySelector('.quiz-option, .quiz-option-btn')?.click();
    }
    document.documentElement.dataset.harnessReady = 'true';
  });
})();`;
fs.writeFileSync(path.join(dir, 'harness-shim.js'), shim);
// The stub first in <head>, in place of boot.js where the build has it (Chrome and Edge; Firefox has none)
const index = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const html = index.includes('<script src="boot.js"></script>')
  ? index.replace('<script src="boot.js"></script>', '<script src="harness-shim.js"></script>')
  : index.replace(/<head>/i, '<head><script src="harness-shim.js"></script>');
fs.writeFileSync(path.join(dir, 'harness.html'), html);
console.log('harness written');
