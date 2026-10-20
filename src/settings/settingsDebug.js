/**
 * Dev builds only: a Debug Options section in the settings window, with buttons that show
 * each feature's states on demand.
 */
import { getMessage } from '../i18n.js';
import { log } from '../logger.js';
import { TIP_IDS, showTip, resetGuide } from '../guide/guide.js';
import CONFIG from '../config.js';
import { html } from '../utils/html.js';
import { setNewTabMode } from '../newTabMode.js';
import { showSeenMilestone, clearSeenBirds } from '../seenBirds.js';
import { showPinCoach } from '../pinCoach.js';

/** The section, as settingsSections() gives them; null outside dev builds. */
export function debugSection() {
  if (process.env.NODE_ENV !== 'development') return null;
  return {
    key: 'debug', titleKey: 'debugOptions', title: 'Debug Options', icon: 'images/svg/settings.svg',
    body: html`
      <div class="settings-debug">
        <style>
          .settings-debug {
            --debug-accent: #f44336;
            --debug-accent-10: rgba(244, 67, 54, 0.1);
            --debug-accent-20: rgba(244, 67, 54, 0.2);
            --debug-accent-30: rgba(244, 67, 54, 0.3);
            --debug-accent-50: rgba(244, 67, 54, 0.5);
            display: flex;
            flex-direction: column;
            gap: 6px;
          }
          .settings-debug .debug-button {
            padding: 9px 12px; border-radius: 8px; border: 1px solid var(--debug-accent-30);
            background: var(--debug-accent-10); color: var(--debug-accent); font: inherit; font-size: 13px; font-weight: 500;
            text-align: start; cursor: pointer;
          }
          .settings-debug .debug-button:hover { background-color: var(--debug-accent-20); border-color: var(--debug-accent-50); }
          .settings-debug .debug-select { padding: 0 8px; border-radius: 8px; background: var(--debug-accent-10); color: var(--debug-accent); border: 1px solid var(--debug-accent-30); }
        </style>
        <div style="display: flex; gap: 6px;">
          <select id="debug-tip" class="debug-select">${TIP_IDS.map(id => html`<option value="${id}">${id}</option>`)}</select>
          <button class="debug-button" style="flex: 1;" data-debug="show-tip">Show Tip</button>
        </div>
        <button class="debug-button" data-debug="reset-tips">Reset Tips (Learned and Pacing)</button>
        <button class="debug-button" data-debug="show-welcome">Show the Welcome on the Next Tab</button>
        <button id="debug-reset-onboarding" class="debug-button" data-i18n="resetOnboarding">Reset Onboarding</button>
        <button id="debug-delete-cache" class="debug-button" data-i18n="deleteCache">Delete Cache</button>
        <button class="debug-button" data-debug="reset-review">Reset Review Prompt</button>
        ${CONFIG.FEATURES.newTabMode ? html`
        <button class="debug-button" data-debug="pin-coach-steps">Show Pin Coach</button>
        <button class="debug-button" data-debug="pin-coach-done">Show Pin Coach: Pinned</button>
        <button class="debug-button" data-debug="reset-new-tab-mode">Reset Open BirdTab to Every Tab</button>` : ''}
        ${CONFIG.FEATURES.yourBirds ? html`
        <button class="debug-button" data-debug="milestone">Show “Different Birds Seen” Milestone</button>
        <button class="debug-button" data-debug="reset-your-birds">Clear Your Birds (and History)</button>
        <button class="debug-button" data-debug="refill-your-birds">Refill Your Birds from History</button>` : ''}
        ${CONFIG.FEATURES.favorites ? html`
        <button class="debug-button" data-debug="reset-favorites">Reset Favorites</button>` : ''}
        ${CONFIG.FEATURES.birdRotation ? html`
        <button class="debug-button" data-debug="clear-held-bird">Clear Held Bird</button>` : ''}
        <p class="pref-help" id="debug-status" role="status"></p>
      </div>`,
  };
}

/**
 * Wire the section's buttons, if it's there.
 * @param {HTMLElement} root - the settings window
 * @param {{close: Function, loadSettings: Function}} panel
 */
export function bindDebugSection(root, panel) {
  if (process.env.NODE_ENV !== 'development') return;
  const section = root.querySelector('.settings-debug');
  if (!section) return;
  const status = section.querySelector('#debug-status');
  const done = (text) => { status.textContent = text; };

  section.querySelector('#debug-reset-onboarding').addEventListener('click', async () => {
    if (!confirm(getMessage('confirmResetSettings'))) return;
    try {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({
        region: CONFIG.STORAGE_DEFAULTS.region,
        autoPlay: false,
        quietHours: false,
        clockDisplayMode: 'clock',
        quickAccessEnabled: true,
        hideTopSites: true
      });
      await chrome.storage.sync.set({ onboardingComplete: false, featureTourVersion: 0, seenFeatures: {} });
      panel.close();
      done(getMessage('settingsResetComplete'));
    } catch (error) {
      log('Error resetting settings: ' + error.message);
      done(getMessage('errorResettingSettings'));
    }
  });

  section.querySelector('#debug-delete-cache').addEventListener('click', async () => {
    try {
      // Everything stored on this device, custom shortcuts included
      await chrome.storage.local.clear();
      // The background's preloaded birds too (no need to wait)
      chrome.runtime.sendMessage({ action: 'deleteCache' });
      done(getMessage('cacheCleared'));
    } catch (error) {
      log('Error clearing cache: ' + error.message);
      done(getMessage('errorClearingCache'));
    }
  });

  // The CONFIG.FEATURES features: show each one's states on demand
  const actions = {
    'reset-review': async () => {
      await chrome.storage.local.set({
        installTime: Date.now() - 2 * 60 * 1000,
        newTabCount: 10,
        lastReviewPrompt: 0,
        reviewDismissed: false,
        reviewLeft: false
      });
      done('Review prompt due. It shows when the guide next has room, or choose it under Show Tip.');
    },
    'show-tip': async () => {
      panel.close();
      const shown = await showTip(section.querySelector('#debug-tip').value);
      if (!shown) done('That tip has nothing to point at on this page (or this browser).');
    },
    'reset-tips': async () => {
      await resetGuide();
      done('Tips reset: the guide starts over from the next tab.');
    },
    'show-welcome': async () => {
      await chrome.storage.sync.set({ onboardingComplete: false });
      await chrome.storage.local.remove('onboardingComplete');
      done('The next new tab shows the welcome.');
    },
    'pin-coach-steps': () => showPinCoach({ preview: 'steps' }),
    'pin-coach-done': () => showPinCoach({ preview: 'done' }),
    'reset-new-tab-mode': async () => {
      await setNewTabMode('every');
      await chrome.storage.local.remove(['chromeTabUses', 'stepAsideOfferDismissed']);
      panel.loadSettings();
      done('Open BirdTab: every tab. Chrome Tab uses and the offer reset.');
    },
    'milestone': () => {
      panel.close();
      showSeenMilestone(50, { force: true });
    },
    'reset-your-birds': async () => {
      await clearSeenBirds();
      done('Your Birds and History cleared.');
    },
    'refill-your-birds': async () => {
      await chrome.storage.local.remove(['seenBirdsBackfilled']);
      done('Your Birds refills from History the next time it opens.');
    },
    'reset-favorites': async () => {
      await chrome.storage.sync.set({ favoriteSpecies: [] });
      await chrome.storage.local.remove(['favoriteBirds']);
      document.getElementById('favorite-button')?.setAttribute('aria-pressed', 'false');
      done('Favorites cleared.');
    },
    'clear-held-bird': async () => {
      await chrome.storage.local.remove(['currentBird']);
      done('Held bird cleared: the next new tab shows a new bird.');
    },
  };
  for (const button of section.querySelectorAll('[data-debug]')) {
    button.addEventListener('click', () => actions[button.dataset.debug]?.());
  }
}
