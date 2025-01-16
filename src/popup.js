import { populateRegionSelect } from './shared.js';
import './popup.css';
import { getQuietHoursText } from './quietHours.js';

document.addEventListener('DOMContentLoaded', function () {
  const regionSelect = document.getElementById('region');
  const autoPlayCheckbox = document.getElementById('auto-play');
  const quietHoursCheckbox = document.getElementById('quiet-hours');
  const resetOnboardingButton = document.getElementById('reset-onboarding');
  const deleteCacheButton = document.getElementById('delete-cache');
  const saveNotification = document.getElementById('save-notification');
  const quietHoursTextElement = document.getElementById('quiet-hours-text');
  const enableSearchCheckbox = document.getElementById('enable-search');

  // Populate the region select
  populateRegionSelect(regionSelect);

  // Load current settings
  chrome.storage.sync.get(['region', 'autoPlay', 'quietHours'], function (result) {
    regionSelect.value = result.region || 'US';
    autoPlayCheckbox.checked = result.autoPlay || false;
    quietHoursCheckbox.checked = result.quietHours || false;
  });

  // Update quiet hours text
  quietHoursTextElement.textContent = `(${getQuietHoursText()})`;

  // Function to save settings
  function saveSettings() {
    const settings = {
      region: regionSelect.value,
      autoPlay: autoPlayCheckbox.checked,
      quietHours: quietHoursCheckbox.checked
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
  quietHoursCheckbox.addEventListener('change', saveSettings);

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

  // Check search enabled state
  chrome.storage.sync.get(['searchEnabled'], (result) => {
    enableSearchCheckbox.checked = result.searchEnabled || false;
  });

  // Handle search toggle
  enableSearchCheckbox.addEventListener('change', function() {
    chrome.storage.sync.set({ searchEnabled: this.checked });
  });

  if (process.env.NODE_ENV === 'development') {
    document.getElementById('debug-section').style.display = 'block';
  }
});