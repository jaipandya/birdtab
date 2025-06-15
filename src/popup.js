import { populateRegionSelect } from './shared.js';
import './popup.css';
import { getQuietHoursText } from './quietHours.js';

// Helper function for logging messages (only in development)
function log(message) {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[BirdTab Popup]: ${message}`);
  }
}

document.addEventListener('DOMContentLoaded', function () {
  const regionSelect = document.getElementById('region');
  const autoPlayCheckbox = document.getElementById('auto-play');
  const quietHoursCheckbox = document.getElementById('quiet-hours');
  const resetOnboardingButton = document.getElementById('reset-onboarding');
  const deleteCacheButton = document.getElementById('delete-cache');
  const saveNotification = document.getElementById('save-notification');
  const quietHoursTextElement = document.getElementById('quiet-hours-text');
  const enableProductivityCheckbox = document.getElementById('enable-productivity');

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
    // Add slight delay to give illusion of processing
    setTimeout(() => {
      saveNotification.classList.add('show');
      setTimeout(() => {
        saveNotification.classList.remove('show');
      }, 2000);
    }, 200);
  }

  // Add event listeners for auto-save
  regionSelect.addEventListener('change', saveSettings);
  autoPlayCheckbox.addEventListener('change', saveSettings);
  quietHoursCheckbox.addEventListener('change', saveSettings);

  // Reset onboarding
  resetOnboardingButton.addEventListener('click', function () {
    if (confirm('This will reset all settings to defaults and show the onboarding again. Continue?')) {
      // Reset all settings to their default values
      chrome.storage.sync.clear(function() {
        if (chrome.runtime.lastError) {
          log('Error clearing sync storage: ' + chrome.runtime.lastError.message);
          alert('⚠️ Error resetting settings. Please try again.');
          return;
        }
        // Set default values including onboardingComplete: false
        chrome.storage.sync.set({
          region: 'US',
          autoPlay: false,
          quietHours: false,
          quickAccessEnabled: false,
          onboardingComplete: false
        }, function () {
          if (chrome.runtime.lastError) {
            log('Error setting default values: ' + chrome.runtime.lastError.message);
            alert('⚠️ Error resetting settings. Please try again.');
            return;
          }
          alert('✅ Settings Reset Complete!\n\nAll your BirdTab settings have been restored to their defaults.\n\nOpen a new tab to see the setup wizard again.');
          window.close();
        });
      });
    }
  });

  // Delete cache
  deleteCacheButton.addEventListener('click', function () {
    // Clear all cached data including bird info, custom shortcuts, and other cached items
    chrome.storage.local.clear(function () {
      if (chrome.runtime.lastError) {
        log('Error clearing local storage: ' + chrome.runtime.lastError.message);
        alert('⚠️ Error clearing cache. Please try again.');
        return;
      }
      // Also clear some sync storage cached items if needed
      chrome.storage.sync.remove(['customShortcuts'], function () {
        if (chrome.runtime.lastError) {
          log('Error removing custom shortcuts: ' + chrome.runtime.lastError.message);
          alert('⚠️ Error clearing cache. Please try again.');
          return;
        }
        alert('🧹 Cache Cleared!\n\nAll cached bird images, custom shortcuts, and temporary data have been removed.\n\nThis should help if you were experiencing any loading issues.');
      });
    });
  });

  // Check quick access features enabled state
  chrome.storage.sync.get(['quickAccessEnabled'], (result) => {
    enableProductivityCheckbox.checked = result.quickAccessEnabled || false;
  });

  // Handle productivity toggle with improved error handling
  enableProductivityCheckbox.addEventListener('change', async function() {
    const isEnabled = this.checked;
    
    try {
      if (isEnabled) {
        // Request permissions when enabling productivity features
        const granted = await chrome.permissions.request({
          permissions: ['topSites', 'favicon']
        });
        
        if (granted) {
          // Permission granted, enable quick access features
          chrome.storage.sync.set({ 
            quickAccessEnabled: isEnabled
          }, function() {
            if (chrome.runtime.lastError) {
              log('Error saving quick access settings: ' + chrome.runtime.lastError.message);
              return;
            }
            showSaveNotification();
          });
        } else {
          // Permission denied, revert the toggle
          this.checked = false;
          alert('🔒 Permission Required\n\nTo use productivity features (search box, most visited sites, and custom shortcuts), BirdTab needs access to your browser\'s top sites.\n\nYou can enable this anytime by toggling the setting again.');
        }
      } else {
        // Disable quick access features
        chrome.storage.sync.set({ 
          quickAccessEnabled: isEnabled
        }, function() {
          if (chrome.runtime.lastError) {
            log('Error saving quick access settings: ' + chrome.runtime.lastError.message);
            return;
          }
          showSaveNotification();
        });
        
        // Try to remove permissions (non-blocking, failure is OK)
        try {
          await chrome.permissions.remove({
            permissions: ['topSites', 'favicon']
          });
        } catch (error) {
          log('Could not remove permissions (this is usually harmless): ' + error.message);
        }
      }
    } catch (error) {
      log('Error with productivity toggle: ' + error.message);
      this.checked = !isEnabled; // Revert on error
      alert('⚠️ Something went wrong\n\nWe couldn\'t update your productivity settings. This might be a temporary issue.\n\nPlease try again in a moment. If the problem continues, try restarting your browser.');
    }
  });

  if (process.env.NODE_ENV === 'development') {
    document.getElementById('debug-section').style.display = 'block';
  }
});