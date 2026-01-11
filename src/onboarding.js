import './onboarding.css';
import { populateRegionSelect } from './shared.js';
import { localizeHtml } from './i18n.js';
import { initSentry, captureException, addBreadcrumb, startTransaction } from './sentry.js';
import { initAnalytics, trackOnboardingCompleted } from './analytics.js';

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize Sentry and start transaction
  initSentry('onboarding');
  await initAnalytics('onboarding');
  const transaction = startTransaction('onboarding-flow', 'navigation');
  
  // Localize immediately
  localizeHtml();
  addBreadcrumb('Onboarding started', 'navigation', 'info');
  
  // State and DOM references
  let currentStep = 1;
  const totalSteps = 3;
  const nextButtons = document.querySelectorAll('.next-btn');
  const finishButton = document.getElementById('finish-btn');
  const dots = document.querySelectorAll('.dot');
  const regionSelect = document.getElementById('region-select');

  populateRegionSelect(regionSelect);

  const showStep = (step) => {
    document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    document.getElementById(`step${step}`).classList.add('active');
    dots.forEach((dot, i) => dot.classList.toggle('active', i === step - 1));
    addBreadcrumb(`Onboarding step ${step}`, 'navigation', 'info', { step, totalSteps });
  };

  // Next button handlers
  nextButtons.forEach(btn => btn.addEventListener('click', () => {
    if (currentStep < totalSteps) showStep(++currentStep);
  }));

  // Finish button handler
  finishButton.addEventListener('click', () => {
    const selectedRegion = regionSelect.value;
    const autoPlayEnabled = document.getElementById('autoplay-toggle').checked;

    addBreadcrumb('Onboarding completed', 'user', 'info', { 
      region: selectedRegion, 
      autoPlay: autoPlayEnabled 
    });

    chrome.storage.sync.set({
      region: selectedRegion,
      autoPlay: autoPlayEnabled,
      onboardingComplete: true
    }, () => {
      if (chrome.runtime.lastError) {
        captureException(new Error('Failed to save onboarding settings'), {
          tags: { operation: 'saveOnboardingSettings' },
          extra: { error: chrome.runtime.lastError.message, selectedRegion, autoPlayEnabled }
        });
        return;
      }
      
      // Track onboarding completion only after settings are successfully saved
      trackOnboardingCompleted(selectedRegion, autoPlayEnabled);
      
      if (transaction) {
        transaction.setStatus('ok');
        transaction.finish();
      }
      
      chrome.tabs.create({ url: 'index.html' });
      window.close();
    });
  });
});