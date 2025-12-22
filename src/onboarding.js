import './onboarding.css';
import { populateRegionSelect } from './shared.js';
import { localizeHtml } from './i18n.js';
import { initSentry, captureException, addBreadcrumb, startTransaction } from './sentry.js';

document.addEventListener('DOMContentLoaded', function () {
  // Initialize Sentry for onboarding
  initSentry('onboarding');
  
  // Start onboarding flow transaction
  const transaction = startTransaction('onboarding-flow', 'navigation');
  
  // Localize the onboarding immediately
  localizeHtml();
  
  addBreadcrumb('Onboarding started', 'navigation', 'info');
  
  let currentStep = 1;
  const totalSteps = 3;
  const nextButtons = document.querySelectorAll('.next-btn');
  const finishButton = document.getElementById('finish-btn');
  const dots = document.querySelectorAll('.dot');

  // Populate the region select
  const regionSelect = document.getElementById('region-select');
  populateRegionSelect(regionSelect);

  function showStep(step) {
    document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    document.getElementById(`step${step}`).classList.add('active');
    dots.forEach((dot, index) => {
      dot.classList.toggle('active', index === step - 1);
    });
    
    addBreadcrumb(`Onboarding step ${step}`, 'navigation', 'info', { step, totalSteps });
  }

  nextButtons.forEach(button => {
    button.addEventListener('click', () => {
      if (currentStep < totalSteps) {
        currentStep++;
        showStep(currentStep);
      }
    });
  });

  finishButton.addEventListener('click', () => {
    const selectedRegion = document.getElementById('region-select').value;
    const autoPlayEnabled = document.getElementById('autoplay-toggle').checked;

    addBreadcrumb('Onboarding completed', 'user', 'info', { 
      region: selectedRegion, 
      autoPlay: autoPlayEnabled 
    });

    chrome.storage.sync.set({
      region: selectedRegion,
      autoPlay: autoPlayEnabled,
      onboardingComplete: true
    }, function () {
      if (chrome.runtime.lastError) {
        captureException(new Error('Failed to save onboarding settings'), {
          tags: { operation: 'saveOnboardingSettings' },
          extra: { error: chrome.runtime.lastError.message, selectedRegion, autoPlayEnabled }
        });
        return;
      }
      
      // Finish the onboarding transaction
      if (transaction) {
        transaction.setStatus('ok');
        transaction.finish();
      }
      
      chrome.tabs.create({ url: 'index.html' });
      window.close();
    });
  });
});