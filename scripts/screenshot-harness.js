// Screenshots of the surfaces that hold buttons, from the preview harness (scripts/preview-harness.js),
// in headless Chrome over the DevTools protocol (Node 22+, no dependencies).
// Usage: node scripts/screenshot-harness.js <out dir> [dev-chrome dir] [surface ...]
// Build first: npx webpack --mode development --env BROWSER=chrome && node scripts/preview-harness.js dev-chrome
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [out, dir = 'dev-chrome', ...rest] = process.argv.slice(2);
// --btn=<direction> renders every surface with that button direction (preview-harness.js)
const variant = (rest.find(a => a.startsWith('--btn=')) || '').slice(6);
const only = rest.filter(a => !a.startsWith('--'));
const SURFACES = {
  review: 'harness.html?review',
  footer: 'harness.html?footer',
  offer: 'harness.html?offer',
  tour: 'harness.html?tour',
  coach: 'harness.html?mode=button#coach',
  settings: 'harness.html?mode=button#settings',
  birds: 'harness.html?seed=8#birds',
  confirm: 'harness.html?seed=8#confirm',
  error: 'harness.html#error',
  quiz: 'harness.html#quiz',
  onboarding: 'harness-onboarding.html',
};
// The card or panel holding the buttons, also saved as <name>-crop.png
const CROP = {
  review: '.review-prompt', footer: '.chrome-footer-notification', offer: '#step-aside-offer',
  tour: '.tour-tooltip, [class*="tour-tooltip"], [class*="tour-welcome"]', coach: '.pin-coach-card',
  settings: '#settings-panel .settings-panel-surface', birds: '#your-birds-sidebar .settings-content',
  confirm: '.confirmation-dialog', error: '.error-modal-content', quiz: '.quiz-content', onboarding: '.onboarding-card',
};
// Cards that appear on their own after a delay
const SETTLE_MS = { review: 3500, footer: 4000, offer: 2500, tour: 3500, quiz: 2500, onboarding: 2500 };

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const rects = {};
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'birdtab-shots-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--remote-debugging-port=9333',
    `--user-data-dir=${profile}`, '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });
  try {
    let version;
    for (let i = 0; i < 50 && !version; i++) { try { version = await (await fetch('http://127.0.0.1:9333/json/version')).json(); } catch { await sleep(200); } }
    for (const [name, page] of Object.entries(SURFACES)) {
      if (only.length && !only.includes(name)) continue;
      const target = await (await fetch(`http://127.0.0.1:9333/json/new?about:blank`, { method: 'PUT' })).json();
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise(r => ws.addEventListener('open', r, { once: true }));
      let id = 0; const pending = new Map();
      ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
      const send = (method, params = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
      await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
      await send('Page.enable');
      const flags = 'fresh' + (variant ? `&btn=${variant}` : '');
      const fresh = page.includes('?') ? page.replace('?', `?${flags}&`) : page.replace(/(#|$)/, `?${flags}$1`);
      await send('Page.navigate', { url: `file://${path.resolve(dir, fresh)}` });
      // Ready: the harness says so (main page), or the page has loaded (onboarding)
      for (let i = 0; i < 100; i++) {
        const r = await send('Runtime.evaluate', { expression: "document.documentElement.dataset.harnessReady === 'true' || (location.pathname.endsWith('onboarding.html') && document.readyState === 'complete')", returnByValue: true });
        if (r.result?.result?.value) break;
        await sleep(200);
      }
      await sleep(SETTLE_MS[name] ?? 900);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(shot.result.data, 'base64'));
      if (CROP[name]) {
        const r = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
          const el = [...document.querySelectorAll(${JSON.stringify(CROP[name])})].find(e => e.getBoundingClientRect().width > 0);
          if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height };
        })()` });
        const b = r.result?.result?.value;
        if (b) {
          const pad = 24;
          const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
          const clip = { x, y, width: Math.min(1280 - x, b.width + 2 * pad), height: Math.min(800 - y, b.height + 2 * pad), scale: 1 };
          rects[name] = clip;
          const crop = await send('Page.captureScreenshot', { format: 'png', clip });
          fs.writeFileSync(path.join(out, `${name}-crop.png`), Buffer.from(crop.result.data, 'base64'));
        }
      }
      console.log(`✓ ${name}`);
      ws.close();
      await fetch(`http://127.0.0.1:9333/json/close/${target.id}`);
    }
    fs.writeFileSync(path.join(out, 'crops.json'), JSON.stringify(rects, null, 2));
  } finally {
    chrome.kill();
    await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome still closing */ }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
