import { populateRegionSelect } from './shared.js';
import { getQuietHoursText } from './quietHours.js';
import { localizeHtml, getMessage } from './i18n.js';
import { log, warn } from './logger.js';
import { handleQuickAccessToggle } from './quickAccessPermissions.js';
import { resetChromeFooterNotification } from './chromeFooterNotification.js';

// Module-level singleton instance
let instance = null;



/**
 * Settings sidebar component for managing user preferences
 * Slides in from the right edge of the screen
 * Provides a consistent UI for settings across the extension
 */
class SettingsSidebar {
  constructor() {
    // Singleton guard - prevent duplicate instances
    if (instance) {
      return instance;
    }
    
    this.initialize();
    
    instance = this;
    return instance;
  }
  
  static getInstance() {
    if (!instance) {
      instance = new SettingsSidebar();
    }
    return instance;
  }
  
  static destroyInstance() {
    if (instance) {
      instance.destroy();
      instance = null;
    }
  }
  
  initialize() {
    this.isOpen = false;
    this.escapeHandler = null;
    this.abortController = new AbortController();
    
    this.createSidebar();
    this.initializeElements();
    this.bindEvents();
    this.loadSettings();
  }


  createSidebar() {
    // Check if sidebar already exists
    const existingSidebar = document.getElementById('settings-sidebar');
    if (existingSidebar) {
      existingSidebar.remove();
    }
    
    // Create sidebar HTML dynamically with i18n data attributes
    const sidebarHTML = `
      <div 
        id="settings-sidebar" 
        class="settings-sidebar"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-sidebar-title"
      >
        <div class="settings-content">
          <div class="settings-header">
            <h2 id="settings-sidebar-title" data-i18n="settingsTitle">BirdTab Settings</h2>
            <button id="close-settings" class="close-button" data-i18n-aria-label="closeSettings" aria-label="Close settings">
              <img src="images/svg/close.svg" alt="Close" width="20" height="20">
            </button>
          </div>
          <div class="settings-body">
            <div class="setting">
              <label for="modal-region" class="setting-label-with-icon">
                <img src="images/svg/location.svg" alt="" width="18" height="18" class="setting-icon">
                <span data-i18n="birdingRegion">Birding Region</span>
                <span class="pro-badge" data-i18n="proBadge">Pro</span>
              </label>
              <select id="modal-region" data-i18n-title="regionTooltip" title="Choose the region where you'd like to see birds from. You'll still see birds from around the world!">
                <!-- Options will be populated by JavaScript -->
              </select>
              <p class="help-text" data-i18n="regionHelpText">Choose your preferred region for bird discoveries.</p>
            </div>

            <div class="setting">
              <div class="toggle-container">
                <div class="toggle-text">
                  <span class="setting-label-with-icon">
                    <img src="images/svg/microphone.svg" alt="" width="18" height="18" class="setting-icon">
                    <span data-i18n="autoPlayBirdCalls">Auto-play bird calls</span>
                  </span>
                  <p class="help-text" data-i18n="autoPlayHelpText">Play bird songs automatically with each new tab. Quiet hours will override this when active.</p>
                </div>
                <label class="switch" data-i18n-title="autoPlayTooltip" title="Enable to automatically play bird calls when you open a new tab">
                  <input type="checkbox" id="modal-auto-play">
                  <span class="slider round"></span>
                </label>
              </div>
            </div>

            <div class="setting">
              <div class="toggle-container">
                <div class="toggle-text">
                  <span class="setting-label-with-icon">
                    <img src="images/svg/moon.svg" alt="" width="18" height="18" class="setting-icon">
                    <span><span data-i18n="quietHours">Quiet Hours</span> <span id="modal-quiet-hours-text"></span></span>
                  </span>
                  <p class="help-text" data-i18n="quietHoursHelpText">Mute bird songs during specified quiet hours.</p>
                </div>
                <label class="switch" data-i18n-title="quietHoursTooltip" title="Enable to automatically turn off auto-play during quiet hours">
                  <input type="checkbox" id="modal-quiet-hours">
                  <span class="slider round"></span>
                </label>
              </div>
            </div>

            <div class="setting">
              <div class="toggle-container">
                <div class="toggle-text">
                  <span class="setting-label-with-icon">
                    <img src="images/svg/clock.svg" alt="" width="18" height="18" class="setting-icon">
                    <span data-i18n="clockDisplay">Show Clock</span>
                    <span class="pro-badge" data-i18n="proBadge">Pro</span>
                  </span>
                  <p class="help-text" id="modal-clock-help" data-i18n="clockDisplayHelpText">Display a large clock in the center of your new tab.</p>
                </div>
                <label class="switch" data-i18n-title="clockDisplayTooltip" title="Show current time on new tab page">
                  <input type="checkbox" id="modal-clock-display" aria-describedby="modal-clock-help">
                  <span class="slider round"></span>
                </label>
              </div>
            </div>

            <div class="setting">
              <div class="toggle-container">
                <div class="toggle-text">
                  <span class="setting-label-with-icon">
                    <img src="images/svg/search.svg" alt="" width="18" height="18" class="setting-icon">
                    <span data-i18n="quickAccessFeatures">Quick Access Features</span>
                  </span>
                  <p class="help-text" id="modal-productivity-help" data-i18n="productivityHelpText">Enable search box, top sites, and custom shortcuts for enhanced productivity.</p>
                </div>
                <label class="switch" data-i18n-title="productivityTooltip" title="Show search box, most visited sites, and allow custom shortcuts">
                  <input type="checkbox" id="modal-enable-productivity" aria-describedby="modal-productivity-help">
                  <span class="slider round"></span>
                </label>
              </div>
            </div>

            <div class="setting">
              <div class="toggle-container">
                <div class="toggle-text">
                  <span class="setting-label-with-icon">
                    <img src="images/svg/video.svg" alt="" width="18" height="18" class="setting-icon">
                    <span data-i18n="videoMode">Video Mode</span>
                    <span class="pro-badge" data-i18n="proBadge">Pro</span>
                  </span>
                  <p class="help-text" id="modal-video-mode-help" data-i18n="videoModeHelpText">Show bird videos instead of photos when available. Videos include sound.</p>
                </div>
                <label class="switch" data-i18n-title="videoModeTooltip" title="Enable to show bird videos instead of photos">
                  <input type="checkbox" id="modal-video-mode" aria-describedby="modal-video-mode-help">
                  <span class="slider round"></span>
                </label>
              </div>
            </div>

            <div class="setting">
              <div class="toggle-container">
                <div class="toggle-text">
                  <span class="setting-label-with-icon">
                    <img src="images/svg/camera.svg" alt="" width="18" height="18" class="setting-icon">
                    <span data-i18n="highResImages">High-Resolution Images</span>
                    <span class="pro-badge" data-i18n="proBadge">Pro</span>
                  </span>
                  <p class="help-text" id="modal-high-res-help" data-i18n="highResHelpText">Display ultra high-resolution 2400px bird photos for crystal-clear detail.</p>
                </div>
                <label class="switch" data-i18n-title="highResTooltip" title="Enable to show high-resolution images">
                  <input type="checkbox" id="modal-high-res" aria-describedby="modal-high-res-help">
                  <span class="slider round"></span>
                </label>
              </div>
            </div>

            <div class="setting">
              <div class="toggle-container">
                <div class="toggle-text">
                  <span class="setting-label-with-icon">
                    <img src="images/svg/settings.svg" alt="" width="18" height="18" class="setting-icon">
                    <span data-i18n="googleApps">Google Apps</span>
                  </span>
                  <p class="help-text" id="modal-google-apps-help" data-i18n="googleAppsHelpText">Show a quick access button to open Google apps like Gmail, Drive, YouTube, and more.</p>
                </div>
                <label class="switch" data-i18n-title="googleAppsTooltip" title="Enable to show Google Apps button">
                  <input type="checkbox" id="modal-google-apps" aria-describedby="modal-google-apps-help">
                  <span class="slider round"></span>
                </label>
              </div>
            </div>

            <div class="setting">
              <div class="toggle-container">
                <div class="toggle-text">
                  <span class="setting-label-with-icon">
                    <img src="images/svg/external-link.svg" alt="" width="18" height="18" class="setting-icon">
                    <span data-i18n="showChromeTab">Chrome Tab Shortcut</span>
                  </span>
                  <p class="help-text" id="modal-chrome-tab-help" data-i18n="showChromeTabHelpText">Show a shortcut to quickly access the default Chrome new tab page.</p>
                </div>
                <label class="switch" data-i18n-title="showChromeTabTooltip" title="Enable to show Chrome Tab shortcut">
                  <input type="checkbox" id="modal-chrome-tab" aria-describedby="modal-chrome-tab-help">
                  <span class="slider round"></span>
                </label>
              </div>
            </div>
          </div>
          <a href="mailto:support@birdtab.app" class="settings-footer feedback-link">
            <img src="images/svg/message.svg" alt="" width="16" height="16" class="feedback-icon">
            <span data-i18n="sendFeedback">Send Feedback</span>
          </a>
          ${process.env.NODE_ENV === 'development' ? `
          <style>
            .settings-debug-section {
              margin-top: 16px;
              padding: 16px var(--modal-spacing, 16px);
              border-top: 1px solid var(--modal-border, rgba(255, 255, 255, 0.1));
            }
            .settings-debug-section .debug-section-title {
              font-size: 13px;
              font-weight: 600;
              color: var(--modal-text-secondary, rgba(255, 255, 255, 0.7));
              text-transform: uppercase;
              letter-spacing: 0.5px;
              margin: 0 0 12px 0;
            }
            .settings-debug-section .debug-buttons {
              display: flex;
              flex-direction: column;
              gap: 8px;
            }
            .settings-debug-section .debug-button {
              width: 100%;
              padding: 10px 14px;
              border-radius: 8px;
              border: 1px solid rgba(244, 67, 54, 0.3);
              font-size: 13px;
              font-weight: 500;
              background-color: rgba(244, 67, 54, 0.1);
              color: #f44336;
              cursor: pointer;
              transition: all 0.2s ease;
            }
            .settings-debug-section .debug-button:hover {
              background-color: rgba(244, 67, 54, 0.2);
              border-color: rgba(244, 67, 54, 0.5);
            }
            .settings-debug-section .debug-button:active {
              background-color: rgba(244, 67, 54, 0.3);
            }
          </style>
          <div class="settings-debug-section">
            <h3 class="debug-section-title" data-i18n="debugOptions">Debug Options</h3>
            <div class="debug-buttons">
              <button id="sidebar-reset-tour" class="debug-button" data-i18n="resetTour">Reset Feature Tour</button>
              <button id="sidebar-reset-onboarding" class="debug-button" data-i18n="resetOnboarding">Reset Onboarding</button>
              <button id="sidebar-delete-cache" class="debug-button" data-i18n="deleteCache">Delete Cache</button>
            </div>
          </div>
          ` : ''}
        </div>
      </div>
    `;

    // Add sidebar to body
    document.body.insertAdjacentHTML('beforeend', sidebarHTML);
    
    // Get references to the created elements
    this.sidebar = document.getElementById('settings-sidebar');
    this.closeButton = document.getElementById('close-settings');
    
    // Localize the newly created sidebar
    localizeHtml();
  }

  initializeElements() {
    // Get all the sidebar form elements
    this.regionSelect = document.getElementById('modal-region');
    this.autoPlayCheckbox = document.getElementById('modal-auto-play');
    this.quietHoursCheckbox = document.getElementById('modal-quiet-hours');
    this.clockDisplayCheckbox = document.getElementById('modal-clock-display');
    this.enableProductivityCheckbox = document.getElementById('modal-enable-productivity');
    this.videoModeCheckbox = document.getElementById('modal-video-mode');
    this.highResCheckbox = document.getElementById('modal-high-res');
    this.googleAppsCheckbox = document.getElementById('modal-google-apps');
    this.chromeTabCheckbox = document.getElementById('modal-chrome-tab');
    this.quietHoursTextElement = document.getElementById('modal-quiet-hours-text');

    // Populate the region select
    if (this.regionSelect) {
      populateRegionSelect(this.regionSelect);
    }

    // Update quiet hours text
    if (this.quietHoursTextElement) {
      this.quietHoursTextElement.textContent = `(${getQuietHoursText()})`;
    }
  }

  bindEvents() {
    // Settings button click - use event delegation to handle button replacement
    // This ensures clicks work even if the button is replaced in the DOM
    document.addEventListener('click', (e) => {
      const settingsBtn = e.target.closest('#settings-button');
      if (settingsBtn) {
        e.preventDefault();
        e.stopPropagation();
        this.open();
      }
    }, { signal: this.abortController.signal });

    // Close button click
    if (this.closeButton) {
      this.closeButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      });
    }

    // Click outside sidebar to close
    if (this.sidebar) {
      this.sidebar.addEventListener('click', (e) => {
        if (e.target === this.sidebar) {
          // Stop event propagation to prevent media click handler from triggering
          e.stopPropagation();
          this.close();
        }
      });
    }

    // Prevent sidebar content clicks from closing sidebar
    // BUT allow links (like mailto:) to work normally
    const sidebarContent = this.sidebar ? this.sidebar.querySelector('.settings-content') : null;
    if (sidebarContent) {
      sidebarContent.addEventListener('click', (e) => {
        // Don't stop propagation for links - let them navigate normally
        if (e.target.closest('a[href]')) {
          return;
        }
        e.stopPropagation();
      });
    }

    // ESC key to close and focus trap - bind to document with abort controller
    this.escapeHandler = (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        e.preventDefault();
        this.close();
      }
    };
    document.addEventListener('keydown', this.escapeHandler, { 
      signal: this.abortController.signal 
    });
    
    // Focus trap
    document.addEventListener('keydown', this.trapFocus.bind(this), {
      signal: this.abortController.signal,
    });

    // Auto-save on setting changes
    if (this.regionSelect) {
      this.regionSelect.addEventListener('change', () => this.saveSettings());
    }
    if (this.autoPlayCheckbox) {
      this.autoPlayCheckbox.addEventListener('change', () => this.saveSettings());
    }
    if (this.quietHoursCheckbox) {
      this.quietHoursCheckbox.addEventListener('change', () => this.saveSettings());
    }
    if (this.clockDisplayCheckbox) {
      this.clockDisplayCheckbox.addEventListener('change', () => this.saveSettings());
    }
    // Special handler for productivity features with permission request
    if (this.enableProductivityCheckbox) {
      this.enableProductivityCheckbox.addEventListener('change', async (e) => {
        await this.handleProductivityToggle(e.target.checked);
      });
    }
    if (this.videoModeCheckbox) {
      this.videoModeCheckbox.addEventListener('change', () => this.saveSettings());
    }
    if (this.highResCheckbox) {
      this.highResCheckbox.addEventListener('change', () => this.saveSettings());
    }
    if (this.googleAppsCheckbox) {
      this.googleAppsCheckbox.addEventListener('change', () => this.saveSettings());
    }
    if (this.chromeTabCheckbox) {
      this.chromeTabCheckbox.addEventListener('change', () => this.saveSettings());
    }
    
    // Make entire toggle container rows clickable
    this.bindToggleContainerClicks();
    
    // Bind debug buttons (only exist in development)
    this.bindDebugButtons();
  }

  /**
   * Make toggle container rows clickable to toggle the checkbox
   */
  bindToggleContainerClicks() {
    const toggleContainers = this.sidebar.querySelectorAll('.toggle-container');

    toggleContainers.forEach(container => {
      container.style.cursor = 'pointer';

      container.addEventListener('click', async (e) => {
        // Don't toggle if clicking directly on the switch or checkbox
        if (e.target.closest('.switch') || e.target.tagName === 'INPUT') {
          return;
        }

        const checkbox = container.querySelector('input[type="checkbox"]');
        if (!checkbox) return;

        // Special handling for productivity toggle (requires permission)
        if (checkbox.id === 'modal-enable-productivity') {
          checkbox.checked = !checkbox.checked;
          await this.handleProductivityToggle(checkbox.checked);
        } else {
          checkbox.checked = !checkbox.checked;
          this.saveSettings();
        }
      });
    });
  }

  /**
   * Bind debug button event handlers (only exist in development builds)
   */
  bindDebugButtons() {
    const resetTourButton = document.getElementById('sidebar-reset-tour');
    const resetOnboardingButton = document.getElementById('sidebar-reset-onboarding');
    const deleteCacheButton = document.getElementById('sidebar-delete-cache');

    if (resetTourButton) {
      resetTourButton.addEventListener('click', async () => {
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
          
          const successMsg = getMessage('tourReset') || 'Feature tour has been reset. It will show again on the next page load.';
          alert(successMsg);
        } catch (error) {
          log('Error resetting tour: ' + error.message);
          const errorMsg = getMessage('errorResettingTour') || 'Error resetting the feature tour';
          alert(errorMsg);
        }
      });
    }

    if (resetOnboardingButton) {
      resetOnboardingButton.addEventListener('click', async () => {
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
          
          // Show success message and close sidebar
          alert(getMessage('settingsResetComplete'));
          this.close();
        } catch (error) {
          log('Error resetting settings: ' + error.message);
          alert(getMessage('errorResettingSettings'));
        }
      });
    }

    if (deleteCacheButton) {
      deleteCacheButton.addEventListener('click', async () => {
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
          
          // Show success message
          alert(getMessage('cacheCleared'));
        } catch (error) {
          log('Error clearing cache: ' + error.message);
          alert(getMessage('errorClearingCache'));
        }
      });
    }
  }

  open() {
    if (!this.sidebar) return;
    
    this.loadSettings(); // Refresh settings when opening
    this.sidebar.classList.add('open');
    this.isOpen = true;
    
    // Prevent body scroll when sidebar is open
    document.body.style.overflow = 'hidden';
  }

  close() {
    if (!this.sidebar) return;
    
    this.sidebar.classList.remove('open');
    this.isOpen = false;
    
    // Restore body scroll
    document.body.style.overflow = '';
    
    // Return focus to settings button (query fresh in case DOM was replaced)
    const settingsBtn = document.getElementById('settings-button');
    if (settingsBtn) {
      settingsBtn.focus();
    }
  }

  destroy() {
    // Clean up all event listeners via abort controller
    this.abortController.abort();
    
    // Restore body scroll if sidebar was open
    document.body.style.overflow = '';
    
    // Remove sidebar from DOM
    if (this.sidebar && this.sidebar.parentNode) {
      this.sidebar.remove();
    }
    
    // Clear references
    this.sidebar = null;
    this.escapeHandler = null;
    
    // Clear module-level instance
    instance = null;
  }

  loadSettings() {
    // Load current settings from storage
    if (!chrome?.storage?.sync) {
      warn('Chrome storage API not available');
      return;
    }

    chrome.storage.sync.get(['region', 'autoPlay', 'quietHours', 'clockDisplayMode', 'quickAccessEnabled', 'videoMode', 'highResImages', 'googleAppsEnabled', 'chromeTabEnabled'], (result) => {

      if (this.regionSelect) {
        this.regionSelect.value = result.region || 'US';
      }
      if (this.autoPlayCheckbox) {
        this.autoPlayCheckbox.checked = result.autoPlay || false;
      }
      if (this.quietHoursCheckbox) {
        this.quietHoursCheckbox.checked = result.quietHours || false;
      }
      if (this.clockDisplayCheckbox) {
        // Checkbox is checked if clock OR timer is enabled
        this.clockDisplayCheckbox.checked = (result.clockDisplayMode === 'clock' || result.clockDisplayMode === 'timer');
      }
      if (this.enableProductivityCheckbox) {
        this.enableProductivityCheckbox.checked = result.quickAccessEnabled || false;
      }
      if (this.videoModeCheckbox) {
        this.videoModeCheckbox.checked = result.videoMode || false;
      }
      if (this.highResCheckbox) {
        this.highResCheckbox.checked = result.highResImages || false;
      }
      if (this.googleAppsCheckbox) {
        this.googleAppsCheckbox.checked = result.googleAppsEnabled || false;
      }
      if (this.chromeTabCheckbox) {
        // Default is true (enabled) - only disable if explicitly set to false
        this.chromeTabCheckbox.checked = result.chromeTabEnabled !== false;
      }
    });
  }

  saveSettings() {
    if (!chrome?.storage?.sync) {
      warn('Chrome storage API not available');
      return;
    }

    // For clock display, we need to check current mode to preserve timer state
    chrome.storage.sync.get(['clockDisplayMode'], (currentSettings) => {
      const settings = {};

      if (this.regionSelect) {
        settings.region = this.regionSelect.value;
      }
      if (this.autoPlayCheckbox) {
        settings.autoPlay = this.autoPlayCheckbox.checked;
      }
      if (this.quietHoursCheckbox) {
        settings.quietHours = this.quietHoursCheckbox.checked;
      }
      if (this.clockDisplayCheckbox) {
        let clockDisplayMode = 'off';

        if (this.clockDisplayCheckbox.checked) {
          // If checkbox is enabled, preserve current mode (clock or timer)
          // Default to 'clock' if not set
          const currentMode = currentSettings.clockDisplayMode || 'off';
          clockDisplayMode = (currentMode === 'timer') ? 'timer' : 'clock';
        }

        settings.clockDisplayMode = clockDisplayMode;
      }
      if (this.enableProductivityCheckbox) {
        settings.quickAccessEnabled = this.enableProductivityCheckbox.checked;
      }
      if (this.videoModeCheckbox) {
        settings.videoMode = this.videoModeCheckbox.checked;
      }
      if (this.highResCheckbox) {
        settings.highResImages = this.highResCheckbox.checked;
      }
      if (this.googleAppsCheckbox) {
        settings.googleAppsEnabled = this.googleAppsCheckbox.checked;
      }
      if (this.chromeTabCheckbox) {
        settings.chromeTabEnabled = this.chromeTabCheckbox.checked;
      }

      chrome.storage.sync.set(settings, () => {
        // Settings saved successfully - show notification
        this.showSaveNotification();
      });
    });
  }

  async handleProductivityToggle(isEnabled) {
    await handleQuickAccessToggle(isEnabled, {
      onSuccess: () => this.showSaveNotification(),
      onRevert: () => { this.enableProductivityCheckbox.checked = !isEnabled; },
      component: 'settingsSidebar'
    });
  }

  showSaveNotification() {
    // Remove existing notification if present
    const existingNotification = document.querySelector('.settings-save-notification');
    if (existingNotification) {
      existingNotification.remove();
    }

    // Create new notification
    const notification = document.createElement('div');
    notification.className = 'settings-save-notification';
    notification.textContent = getMessage('settingsSaved');
    
    // Add to document
    document.body.appendChild(notification);
    
    // Show notification with animation after processing delay
    setTimeout(() => {
      notification.classList.add('show');
    }, 200);
    
    // Hide and remove notification after 2 seconds
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => {
        if (notification.parentNode) {
          notification.remove();
        }
      }, 300);
    }, 2000);
  }

  /**
   * Keep focus inside the sidebar (basic focus trap)
   */
  trapFocus(e) {
    if (!this.isOpen || e.key !== 'Tab') return;
    
    const focusable = this.sidebar.querySelectorAll(
      'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

export default SettingsSidebar;