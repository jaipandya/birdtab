import './onboarding.css';
import { populateRegionSelect } from './shared.js';
import { localizeHtml } from './i18n.js';

document.addEventListener('DOMContentLoaded', function () {
  // Localize the onboarding immediately
  localizeHtml();
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

    chrome.storage.sync.set({
      region: selectedRegion,
      autoPlay: autoPlayEnabled,
      onboardingComplete: true
    }, function () {
      chrome.tabs.create({ url: 'index.html' });
      window.close();
    });
  });
});