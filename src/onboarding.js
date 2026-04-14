import './tokens.css';
import './onboarding.css';
import { localizeHtml } from './i18n.js';
import { initSentry, captureException, addBreadcrumb, startTransaction } from './sentry.js';
import { initAnalytics, trackOnboardingCompleted } from './analytics.js';

document.addEventListener('DOMContentLoaded', async () => {
  initSentry('onboarding');
  await initAnalytics('onboarding');
  const transaction = startTransaction('onboarding-flow', 'navigation');
  
  localizeHtml();
  addBreadcrumb('Onboarding started', 'navigation', 'info');

  // Start manifest download immediately in the background.
  // The service worker handles the actual fetch and caching;
  // we just send a message so it starts early.
  let manifestReady = false;
  const manifestPromise = new Promise(resolve => {
    chrome.runtime.sendMessage({ action: 'fetchManifest' }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('Manifest prefetch message failed:', chrome.runtime.lastError.message);
      }
      manifestReady = response?.success === true;
      resolve(manifestReady);
    });
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

    addBreadcrumb('Onboarding completed', 'user', 'info', { 
      region: 'WLD', 
      autoPlay: autoPlayEnabled 
    });

    // If the manifest isn't ready yet, show a loading state briefly
    if (!manifestReady) {
      finishButton.disabled = true;
      finishButton.classList.add('loading');
      const btnLabel = finishButton.querySelector('span');
      const originalText = btnLabel?.textContent;
      if (btnLabel) {
        btnLabel.textContent = chrome.i18n.getMessage('preparingExperience') || 'Preparing your experience…';
      }

      // Wait for manifest (with a timeout so we don't block forever)
      const timeout = new Promise(resolve => setTimeout(() => resolve(false), 15000));
      await Promise.race([manifestPromise, timeout]);

      if (btnLabel) btnLabel.textContent = originalText;
      finishButton.disabled = false;
      finishButton.classList.remove('loading');
    }

    chrome.storage.local.set({
      region: 'WLD',
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

        trackOnboardingCompleted('WLD', autoPlayEnabled);

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
