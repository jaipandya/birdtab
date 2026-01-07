import { populateRegionSelect } from './shared.js';
import './popup.css';
import { getQuietHoursText } from './quietHours.js';
import { localizeHtml, getMessage } from './i18n.js';
import { initSentry, captureException, addBreadcrumb, updateUserContext } from './sentry.js';
import { showPermissionDialog } from './permissionDialog.js';
import { resetChromeFooterNotification } from './chromeFooterNotification.js';

import { log } from './logger.js';

document.addEventListener('DOMContentLoaded', function () {
  // Initialize Sentry for popup
  initSentry('popup');
  
  // Localize the popup immediately
  localizeHtml();
  
  addBreadcrumb('Popup opened', 'navigation', 'info');
  
  // Debug i18n
  log('UI Locale: ' + chrome.i18n.getUILanguage());
  chrome.i18n.getAcceptLanguages(langs => log('Accept Languages: ' + langs.join(', ')));
  log('Test message (settingsTitle): ' + getMessage('settingsTitle'));

  const regionSelect = document.getElementById('region');
  const autoPlayCheckbox = document.getElementById('auto-play');
  const quietHoursCheckbox = document.getElementById('quiet-hours');
  const resetOnboardingButton = document.getElementById('reset-onboarding');
  const deleteCacheButton = document.getElementById('delete-cache');
  const saveNotification = document.getElementById('save-notification');
  const quietHoursTextElement = document.getElementById('quiet-hours-text');
  const enableProductivityCheckbox = document.getElementById('enable-productivity');
  const videoModeCheckbox = document.getElementById('video-mode');
  const highResCheckbox = document.getElementById('high-res');

  // Populate the region select
  populateRegionSelect(regionSelect);

  // Load current settings
  chrome.storage.sync.get(['region', 'autoPlay', 'quietHours', 'quickAccessEnabled', 'videoMode', 'highResImages'], function (result) {
    regionSelect.value = result.region || 'US';
    autoPlayCheckbox.checked = result.autoPlay || false;
    quietHoursCheckbox.checked = result.quietHours || false;
    enableProductivityCheckbox.checked = result.quickAccessEnabled || false;
    videoModeCheckbox.checked = result.videoMode || false;
    highResCheckbox.checked = result.highResImages || false;
  });

  // Update quiet hours text
  quietHoursTextElement.textContent = `(${getQuietHoursText()})`;

  // Function to save settings
  function saveSettings() {
    const settings = {
      region: regionSelect.value,
      autoPlay: autoPlayCheckbox.checked,
      quietHours: quietHoursCheckbox.checked,
      videoMode: videoModeCheckbox.checked,
      highResImages: highResCheckbox.checked
    };
    
    chrome.storage.sync.set(settings, function () {
      if (chrome.runtime.lastError) {
        captureException(new Error('Failed to save settings'), {
          tags: { operation: 'saveSettings' },
          extra: { error: chrome.runtime.lastError.message, settings }
        });
        return;
      }
      
      // Update Sentry user context with new settings
      updateUserContext(settings);
      
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
  videoModeCheckbox.addEventListener('change', saveSettings);
  highResCheckbox.addEventListener('change', saveSettings);

  // Debug buttons - only exist in development builds
  // Safe null checks prevent errors in production where debug section is removed
  if (resetOnboardingButton) {
    resetOnboardingButton.addEventListener('click', async function () {
      if (!confirm(getMessage('confirmResetSettings'))) {
        return;
      }
      
      try {
        // Reset all settings to their default values
        await new Promise((resolve, reject) => {
          chrome.storage.sync.clear(function() {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve();
            }
          });
        });
        
        // Set default values including onboardingComplete: false
        await new Promise((resolve, reject) => {
          chrome.storage.sync.set({
            region: 'US',
            autoPlay: false,
            quietHours: false,
            quickAccessEnabled: false,
            onboardingComplete: false,
            featureTourVersion: 0
          }, function () {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve();
            }
          });
        });
        
        // Show single success message
        alert(getMessage('settingsResetComplete'));
        window.close();
      } catch (error) {
        log('Error resetting settings: ' + error.message);
        alert(getMessage('errorResettingSettings'));
      }
    });
  }

  if (deleteCacheButton) {
    deleteCacheButton.addEventListener('click', async function () {
      try {
        // Clear all cached data including bird info, custom shortcuts, and other cached items
        await new Promise((resolve, reject) => {
          chrome.storage.local.clear(function () {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve();
            }
          });
        });
        
        // Also clear some sync storage cached items if needed
        await new Promise((resolve, reject) => {
          chrome.storage.sync.remove(['customShortcuts'], function () {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve();
            }
          });
        });
        
        // Notify background script to clear preloaded bird info (don't wait for response)
        chrome.runtime.sendMessage({ action: 'deleteCache' });
        
        // Show single success message
        alert(getMessage('cacheCleared'));
      } catch (error) {
        log('Error clearing cache: ' + error.message);
        alert(getMessage('errorClearingCache'));
      }
    });
  }

  const resetTourButton = document.getElementById('reset-tour');
  if (resetTourButton) {
    resetTourButton.addEventListener('click', async function () {
      try {
        // Reset the feature tour version
        await new Promise((resolve, reject) => {
          chrome.storage.sync.set({ featureTourVersion: 0 }, function () {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve();
            }
          });
        });
        
        // Also reset the Chrome footer notification
        await resetChromeFooterNotification();
        
        const successMsg = chrome.i18n.getMessage('tourReset') || 'Feature tour has been reset. It will show again on the next page load.';
        alert(successMsg);
      } catch (error) {
        log('Error resetting tour: ' + error.message);
        const errorMsg = chrome.i18n.getMessage('errorResettingTour') || 'Error resetting the feature tour';
        alert(errorMsg);
      }
    });
  }

  // Handle productivity toggle with improved error handling
  enableProductivityCheckbox.addEventListener('change', async function() {
    const isEnabled = this.checked;
    const checkbox = this;

    try {
      if (isEnabled) {
        log('Showing permission dialog before Chrome permission request');

        // Show permission dialog first
        const userConfirmed = await showPermissionDialog({
          title: 'permissionDialogTitle',
          subtitle: 'permissionDialogSubtitle',
          privacyText: 'permissionDialogPrivacy',
          privacyLinkText: 'privacyPolicy',
          privacyLinkUrl: 'https://birdtab.app/privacy',
          cancelText: 'goBack',
          confirmText: 'continue'
        });

        if (!userConfirmed) {
          // User clicked "Go back", revert the toggle
          checkbox.checked = false;
          return;
        }

        // User clicked "Continue", now request Chrome permissions
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
          checkbox.checked = false;
          alert(getMessage('permissionRequired'));
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
          // Don't capture this as an error since it's expected to sometimes fail
          addBreadcrumb('Permission removal failed (harmless)', 'info', 'info', { error: error.message });
        }
      }
    } catch (error) {
      log('Error with productivity toggle: ' + error.message);
      captureException(error, {
        tags: { operation: 'productivityToggle' },
        extra: { isEnabled, permissions: ['topSites', 'favicon'] }
      });
      checkbox.checked = !isEnabled; // Revert on error
      alert(getMessage('somethingWentWrong'));
    }
  });

  if (process.env.NODE_ENV === 'development') {
    document.getElementById('debug-section').style.display = 'block';
  }
});