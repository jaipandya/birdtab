/**
 * Dev builds only: a Debug Options section in the settings window, with buttons that show
 * each feature's states on demand.
 */
import { getTourVersion } from '../featureTour.js';
import { getMessage } from '../i18n.js';
import { log } from '../logger.js';
import { resetChromeFooterNotification, showChromeFooterNotification } from '../chromeFooterNotification.js';
import CONFIG from '../config.js';
import { html } from '../utils/html.js';
import { setNewTabMode, maybeOfferToStepAside } from '../newTabMode.js';
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
          <select id="debug-tour-version" class="debug-select"></select>
          <button id="debug-reset-tour" class="debug-button" style="flex: 1;" data-i18n="resetTour">Reset Feature Tour</button>
        </div>
        <button id="debug-reset-onboarding" class="debug-button" data-i18n="resetOnboarding">Reset Onboarding</button>
        <button id="debug-delete-cache" class="debug-button" data-i18n="deleteCache">Delete Cache</button>
        <button class="debug-button" data-debug="reset-review">Reset Review Prompt</button>
        <button class="debug-button" data-debug="footer-notice">Show Chrome Footer Tip</button>
        ${CONFIG.FEATURES.newTabMode ? html`
        <button class="debug-button" data-debug="pin-coach-steps">Show Pin Coach</button>
        <button class="debug-button" data-debug="pin-coach-done">Show Pin Coach: Pinned</button>
        <button class="debug-button" data-debug="step-aside-offer">Show “Prefer Chrome’s Page?” Offer</button>
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

  const versionSelect = section.querySelector('#debug-tour-version');
  for (let i = 0; i <= getTourVersion(); i++) versionSelect.add(new Option(`v${i}`, String(i)));
  versionSelect.value = '0';

  section.querySelector('#debug-reset-tour').addEventListener('click', async () => {
    try {
      const targetVersion = parseInt(versionSelect.value, 10);
      await chrome.storage.sync.set({ featureTourVersion: targetVersion });
      await resetChromeFooterNotification();
      done(`Tour version set to ${targetVersion}. Reload to see effect.`);
    } catch (error) {
      log('Error resetting tour: ' + error.message);
      done(getMessage('errorResettingTour') || 'Error resetting the feature tour');
    }
  });

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
      await chrome.storage.sync.set({ onboardingComplete: false, featureTourVersion: 0 });
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
      done('Review prompt reset. Open a new tab to see it.');
    },
    'footer-notice': async () => {
      await resetChromeFooterNotification();
      panel.close();
      showChromeFooterNotification();
    },
    'pin-coach-steps': () => showPinCoach({ preview: 'steps' }),
    'pin-coach-done': () => showPinCoach({ preview: 'done' }),
    'step-aside-offer': async () => {
      await chrome.storage.local.set({ chromeTabUses: 3, stepAsideOfferDismissed: false, newTabMode: 'every' });
      document.getElementById('step-aside-offer')?.remove();
      panel.close();
      maybeOfferToStepAside();
    },
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
