import { populateRegionSelect } from './shared.js';
import './popup.css';

document.addEventListener('DOMContentLoaded', function () {
  const regionSelect = document.getElementById('region');
  const autoPlayCheckbox = document.getElementById('auto-play');
  const resetOnboardingButton = document.getElementById('reset-onboarding');
  const deleteCacheButton = document.getElementById('delete-cache');
  const saveNotification = document.getElementById('save-notification');

  // Populate the region select
  populateRegionSelect(regionSelect);

  // Load current settings
  chrome.storage.sync.get(['region', 'autoPlay'], function (result) {
    regionSelect.value = result.region || 'US';
    autoPlayCheckbox.checked = result.autoPlay || false;
  });

  // Function to save settings
  function saveSettings() {
    const settings = {
      region: regionSelect.value,
      autoPlay: autoPlayCheckbox.checked
    };
    chrome.storage.sync.set(settings, function () {
      showSaveNotification();
    });
  }

  // Function to show save notification
  function showSaveNotification() {
    saveNotification.classList.add('show');
    setTimeout(() => {
      saveNotification.classList.remove('show');
    }, 2000);
  }

  // Add event listeners for auto-save
  regionSelect.addEventListener('change', saveSettings);
  autoPlayCheckbox.addEventListener('change', saveSettings);

  // Reset onboarding
  resetOnboardingButton.addEventListener('click', function () {
    chrome.storage.sync.set({ onboardingComplete: false }, function () {
      alert('Onboarding reset. Open a new tab to see it.');
    });
  });

  // Delete cache
  deleteCacheButton.addEventListener('click', function () {
    chrome.storage.local.remove(['cachedBirdInfo', 'cacheDate'], function () {
      alert('Cache deleted!');
    });
  });
  if (process.env.NODE_ENV === 'development') {
    document.getElementById('debug-section').style.display = 'block';
  }
});