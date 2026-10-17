import './tokens.css';
import './onboarding.css';
import './buttons.css';
import { localizeHtml } from './i18n.js';
import { initSentry, captureException, addBreadcrumb, startTransaction } from './sentry.js';
import { log } from './logger.js';
import CONFIG from './config.js';
import { initAnalytics, trackOnboardingCompleted } from './analytics.js';

document.addEventListener('DOMContentLoaded', async () => {
  initSentry('onboarding');
  await initAnalytics('onboarding');
  const transaction = startTransaction('onboarding-flow', 'navigation');
  
  localizeHtml();
  addBreadcrumb('Onboarding started', 'navigation', 'info');

  // Start the manifest download in the background so it's likely stored by the
  // first new tab. Nothing waits for it: until it is, the first tab shows a
  // bird that ships with the extension.
  chrome.runtime.sendMessage({ action: 'fetchManifest' }, () => {
    if (chrome.runtime.lastError) {
      log(`Manifest prefetch message failed: ${chrome.runtime.lastError.message}`);
    }
  });

  const autoplayToggle = document.getElementById('autoplay-toggle');
  const toggleContainer = document.querySelector('.toggle-container');
  toggleContainer.addEventListener('click', (e) => {
    if (e.target === autoplayToggle || e.target.closest('.switch')) return;
    autoplayToggle.checked = !autoplayToggle.checked;
  });

  const finishButton = document.getElementById('finish-btn');

  finishButton.addEventListener('click', async () => {
    const autoPlayEnabled = document.getElementById('autoplay-toggle').checked;
    const { region = CONFIG.STORAGE_DEFAULTS.region } = await chrome.storage.local.get(['region']);

    addBreadcrumb('Onboarding completed', 'user', 'info', {
      region,
      autoPlay: autoPlayEnabled
    });

    chrome.storage.local.set({
      region,
      autoPlay: autoPlayEnabled
    }, () => {
      if (chrome.runtime.lastError) {
        captureException(new Error('Failed to save onboarding settings to local'), {
          tags: { operation: 'saveOnboardingSettings' },
          extra: { error: chrome.runtime.lastError.message, autoPlayEnabled }
        });
        return;
      }

      chrome.storage.sync.set({
        onboardingComplete: true
      }, () => {
        if (chrome.runtime.lastError) {
          captureException(new Error('Failed to save onboarding state to sync'), {
            tags: { operation: 'saveOnboardingState' },
            extra: { error: chrome.runtime.lastError.message }
          });
          return;
        }

        trackOnboardingCompleted(region, autoPlayEnabled);

        if (transaction) {
          transaction.setStatus('ok');
          transaction.finish();
        }

        chrome.tabs.create({ url: 'index.html' });
        window.close();
      });
    });
  });
});
