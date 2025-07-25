import { populateRegionSelect } from './shared.js';
import { getQuietHoursText } from './quietHours.js';

// Module-level singleton instance
let instance = null;

// Helper function for logging messages (only in development)
function log(message) {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[BirdTab Settings]: ${message}`);
  }
}



/**
 * Settings modal component for managing user preferences
 * Provides a consistent UI for settings across the extension
 */
class SettingsModal {
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
      instance = new SettingsModal();
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
    
    this.settingsButton = document.getElementById('settings-button');
    this.createModal();
    this.initializeElements();
    this.bindEvents();
    this.loadSettings();
    
    // Auto-cleanup on page unload
    window.addEventListener('beforeunload', () => this.destroy(), { once: true });
  }


  createModal() {
    // Check if modal already exists
    const existingModal = document.getElementById('settings-modal');
    if (existingModal) {
      existingModal.remove();
    }
    
    // Create modal HTML dynamically
    const modalHTML = `
      <div 
        id="settings-modal" 
        class="settings-modal hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
      >
        <div class="settings-content">
          <div class="settings-header">
            <h2 id="settings-modal-title">Settings</h2>
            <button id="close-settings" class="close-button" aria-label="Close settings">
              <img src="images/svg/close.svg" alt="Close" width="20" height="20">
            </button>
          </div>
          <div class="settings-body">
            <div class="setting">
              <label for="modal-region">Birding Region</label>
              <select id="modal-region" title="Choose the region where you'd like to see birds from. You'll still see birds from around the world!">
                <!-- Options will be populated by JavaScript -->
              </select>
              <p class="help-text">This helps us show birds you might spot in your area.</p>
            </div>
            
            <div class="setting">
              <div class="toggle-container">
                <div class="toggle-text">
                  <span>Auto-play bird calls</span>
                  <p class="help-text">Play bird songs automatically with each new tab. Quiet hours will override this when active.</p>
                </div>
                <label class="switch" title="Enable to automatically play bird calls when you open a new tab">
                  <input type="checkbox" id="modal-auto-play">
                  <span class="slider round"></span>
                </label>
              </div>
            </div>
            
            <div class="setting">
              <div class="toggle-container">
                <div class="toggle-text">
                  <span>Quiet Hours <span id="modal-quiet-hours-text"></span></span>
                  <p class="help-text">Mute bird songs during specified quiet hours.</p>
                </div>
                <label class="switch" title="Enable to automatically turn off auto-play during quiet hours">
                  <input type="checkbox" id="modal-quiet-hours">
                  <span class="slider round"></span>
                </label>
              </div>
            </div>
            
            <div class="setting">
              <div class="toggle-container">
                <div class="toggle-text">
                  <span>Quick Access Features</span>
                  <p class="help-text" id="modal-productivity-help">Enable search box, top sites, and custom shortcuts for enhanced productivity.</p>
                </div>
                <label class="switch" title="Show search box, most visited sites, and allow custom shortcuts">
                  <input type="checkbox" id="modal-enable-productivity" aria-describedby="modal-productivity-help">
                  <span class="slider round"></span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    
    // Add modal to body
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Get references to the created elements
    this.modal = document.getElementById('settings-modal');
    this.closeButton = document.getElementById('close-settings');
  }

  initializeElements() {
    // Get all the modal form elements
    this.regionSelect = document.getElementById('modal-region');
    this.autoPlayCheckbox = document.getElementById('modal-auto-play');
    this.quietHoursCheckbox = document.getElementById('modal-quiet-hours');
    this.enableProductivityCheckbox = document.getElementById('modal-enable-productivity');
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
    // Settings button click
    if (this.settingsButton) {
      this.settingsButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.open();
      });
    }

    // Close button click
    if (this.closeButton) {
      this.closeButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      });
    }

    // Click outside modal to close
    if (this.modal) {
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) {
          this.close();
        }
      });
    }

    // Prevent modal content clicks from closing modal
    const modalContent = this.modal ? this.modal.querySelector('.settings-content') : null;
    if (modalContent) {
      modalContent.addEventListener('click', (e) => {
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
    // Special handler for productivity features with permission request
    if (this.enableProductivityCheckbox) {
      this.enableProductivityCheckbox.addEventListener('change', async (e) => {
        await this.handleProductivityToggle(e.target.checked);
      });
    }
  }

  open() {
    if (!this.modal) return;
    
    this.loadSettings(); // Refresh settings when opening
    this.modal.classList.remove('hidden');
    this.isOpen = true;
    
    // Focus trap - focus the first focusable element
    const firstFocusable = this.modal.querySelector('select, input, button');
    if (firstFocusable) {
      setTimeout(() => firstFocusable.focus(), 100);
    }
  }

  close() {
    if (!this.modal) return;
    
    this.modal.classList.add('hidden');
    this.isOpen = false;
    
    // Return focus to settings button
    if (this.settingsButton) {
      this.settingsButton.focus();
    }
  }

  destroy() {
    // Clean up all event listeners via abort controller
    this.abortController.abort();
    
    // Remove modal from DOM
    if (this.modal && this.modal.parentNode) {
      this.modal.remove();
    }
    
    // Clear references
    this.modal = null;
    this.settingsButton = null;
    this.escapeHandler = null;
    
    // Clear module-level instance
    instance = null;
  }

  loadSettings() {
    // Load current settings from storage
    if (!chrome?.storage?.sync) {
      console.warn('Chrome storage API not available');
      return;
    }
    
    chrome.storage.sync.get(['region', 'autoPlay', 'quietHours', 'quickAccessEnabled'], (result) => {
      
      if (this.regionSelect) {
        this.regionSelect.value = result.region || 'US';
      }
      if (this.autoPlayCheckbox) {
        this.autoPlayCheckbox.checked = result.autoPlay || false;
      }
      if (this.quietHoursCheckbox) {
        this.quietHoursCheckbox.checked = result.quietHours || false;
      }
      if (this.enableProductivityCheckbox) {
        this.enableProductivityCheckbox.checked = result.quickAccessEnabled || false;
      }
    });
  }

  saveSettings() {
    if (!chrome?.storage?.sync) {
      console.warn('Chrome storage API not available');
      return;
    }
    
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
    if (this.enableProductivityCheckbox) {
      settings.quickAccessEnabled = this.enableProductivityCheckbox.checked;
    }
    
    chrome.storage.sync.set(settings, () => {
      // Settings saved successfully - show notification
      this.showSaveNotification();
    });
  }

  async handleProductivityToggle(isEnabled) {
    try {
      if (isEnabled) {
        // Request permissions when enabling productivity features
        const granted = await chrome.permissions.request({
          permissions: ['topSites', 'favicon']
        });
        
        if (granted) {
          // Permission granted, save the setting
          this.saveSettings();
        } else {
          // Permission denied, revert the toggle
          this.enableProductivityCheckbox.checked = false;
          alert('🔒 Permission Required\n\nTo use productivity features (search box, most visited sites, and custom shortcuts), BirdTab needs access to your browser\'s top sites.\n\nYou can enable this anytime by toggling the setting again.');
        }
      } else {
        // Save settings first, then try to remove permissions
        this.saveSettings();
        
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
      this.enableProductivityCheckbox.checked = !isEnabled; // Revert on error
      alert('⚠️ Something went wrong\n\nWe couldn\'t update your productivity settings. This might be a temporary issue.\n\nPlease try again in a moment. If the problem continues, try restarting your browser.');
    }
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
    notification.textContent = 'Settings saved';
    
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
   * Keep focus inside the modal (basic focus trap)
   */
  trapFocus(e) {
    if (!this.isOpen || e.key !== 'Tab') return;
    
    const focusable = this.modal.querySelectorAll(
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

export default SettingsModal;