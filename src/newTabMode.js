/**
 * "Open BirdTab" (CONFIG.FEATURES.newTabMode: Chrome and Edge)
 *
 * People who want Chrome's own new tab page back used to have one option: uninstall.
 * BirdTab can instead step aside:
 *   'every'   every new tab shows a bird (default)
 *   'hourly'  the first new tab after an hour without BirdTab shows a bird, the rest open Chrome's page
 *   'button'  only the toolbar button (or typing "bird" in the address bar) opens BirdTab
 *
 * boot.js decides before the page paints, from localStorage copies kept here.
 * The setting itself lives in chrome.storage.local like the other settings.
 */

import CONFIG from './config.js';
import { log } from './logger.js';
import { trackFeature } from './analytics.js';
import { html, setHtml } from './utils/html.js';
import { showPinCoach } from './pinCoach.js';

export const NEW_TAB_MODES = ['every', 'hourly', 'button'];

const MODE_MIRROR_KEY = 'birdtab:newTabMode';
const LAST_SHOWN_KEY = 'birdtab:lastShown';
// After this many uses of the Chrome Tab shortcut, offer to step aside instead
const CHROME_TAB_NUDGE_AFTER = 3;

function writeMirror(mode) {
  try {
    if (mode === 'hourly' || mode === 'button') {
      localStorage.setItem(MODE_MIRROR_KEY, mode);
    } else {
      localStorage.removeItem(MODE_MIRROR_KEY);
    }
  } catch {
    // localStorage unavailable: BirdTab shows on every tab, as before
  }
}

/**
 * Whether boot.js sent this tab to Chrome's new tab page. Nothing else should
 * start then: no history entry, no session stats, no bird taken from the queue.
 */
export function hasSteppedAside() {
  return window.__birdtabSteppedAside === true;
}

/**
 * Keep boot.js's copy of the setting in step with chrome.storage (fresh install,
 * cleared site data, a change made in another tab), and note that BirdTab was shown.
 */
export async function initNewTabMode() {
  if (!CONFIG.FEATURES.newTabMode) return;
  try {
    localStorage.setItem(LAST_SHOWN_KEY, String(Date.now()));
  } catch {
    // ignore
  }
  const { newTabMode } = await chrome.storage.local.get(['newTabMode']);
  writeMirror(newTabMode || CONFIG.STORAGE_DEFAULTS.newTabMode);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.newTabMode) {
      writeMirror(changes.newTabMode.newValue);
    }
  });
}

export async function setNewTabMode(mode) {
  if (!NEW_TAB_MODES.includes(mode)) return;
  writeMirror(mode);
  await chrome.storage.local.set({ newTabMode: mode });
  trackFeature(`new_tab_mode_${mode}`);
}

/**
 * Whether BirdTab's button is pinned to the toolbar.
 * @returns {Promise<boolean|null>} null where Chrome can't say
 */
export async function isPinnedToToolbar() {
  try {
    const settings = await chrome.action?.getUserSettings?.();
    return settings ? settings.isOnToolbar : null;
  } catch {
    return null;
  }
}

/**
 * Count uses of the Chrome Tab shortcut; after a few, the next BirdTab tab offers
 * to step aside rather than leave uninstalling as the only way to Chrome's page.
 */
export async function noteChromeTabUse() {
  if (!CONFIG.FEATURES.newTabMode) return;
  const { chromeTabUses = 0 } = await chrome.storage.local.get(['chromeTabUses']);
  await chrome.storage.local.set({ chromeTabUses: chromeTabUses + 1 });
}

export async function maybeOfferToStepAside() {
  if (!CONFIG.FEATURES.newTabMode) return;
  const { chromeTabUses = 0, stepAsideOfferDismissed = false, newTabMode = 'every' } =
    await chrome.storage.local.get(['chromeTabUses', 'stepAsideOfferDismissed', 'newTabMode']);
  if (stepAsideOfferDismissed || newTabMode !== 'every' || chromeTabUses < CHROME_TAB_NUDGE_AFTER) return;
  if (document.getElementById('step-aside-offer')) return;

  const msg = (key, fallback) => chrome.i18n.getMessage(key) || fallback;
  const card = document.createElement('div');
  card.id = 'step-aside-offer';
  card.className = 'step-aside-offer';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-labelledby', 'step-aside-offer-title');
  setHtml(card, html`
    <button class="step-aside-close" type="button" aria-label="${msg('closeAlt', 'Close')}">
      <img src="images/svg/close.svg" alt="" width="16" height="16">
    </button>
    <p class="step-aside-title" id="step-aside-offer-title">${msg('stepAsideOfferTitle', 'Prefer Chrome’s new tab page?')}</p>
    <p class="step-aside-text">${msg('stepAsideOfferText', 'BirdTab can step aside and open only when you want a bird.')}</p>
    <div class="step-aside-actions">
      <button type="button" class="step-aside-btn primary" data-mode="button">${msg('newTabModeButton', 'Only when I ask')}</button>
      <button type="button" class="step-aside-btn" data-mode="hourly">${msg('newTabModeHourly', 'Now and then')}</button>
    </div>
  `);
  document.body.appendChild(card);
  trackFeature('step_aside_offer_shown');

  const dismiss = async () => {
    await chrome.storage.local.set({ stepAsideOfferDismissed: true });
    card.remove();
  };
  card.querySelector('.step-aside-close').addEventListener('click', () => {
    trackFeature('step_aside_offer_dismissed');
    dismiss();
  });
  for (const button of card.querySelectorAll('[data-mode]')) {
    button.addEventListener('click', async () => {
      const mode = button.dataset.mode;
      await setNewTabMode(mode);
      await chrome.storage.local.set({ stepAsideOfferDismissed: true });
      log(`Open BirdTab set to ${mode} from the offer`);
      card.remove();
      // The toolbar button is the way back to BirdTab now: help pin it
      showPinCoach();
    });
  }
}
