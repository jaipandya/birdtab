import { populateRegionSelect } from './shared.js';
import { getTourVersion } from './featureTour.js';
import { getQuietHoursText } from './quietHours.js';
import { localizeHtml, getMessage } from './i18n.js';
import { log, warn } from './logger.js';
import { handleQuickAccessToggle } from './quickAccessPermissions.js';
import { resetChromeFooterNotification } from './chromeFooterNotification.js';
import { IS_EDGE } from './browserInfo.js';
import { isPro, getLicenseStatus, deactivateLicense, verifyLicense, openCustomerPortal, resetProFeatureSettings } from './licenseManager.js';
import { CONFIG } from './config.js';
import { showUpgradeModal } from './upgradeModal.js';
import { escapeHtml } from './utils/escapeHtml.js';
import { showToast } from './loadingIndicators.js';
import { trackProUpgradeClicked, trackLicenseDeactivated } from './analytics.js';

// Dev-only: User state presets for debugging license states
// All license data is now stored in local storage (device-specific)
const USER_STATE_PRESETS = process.env.NODE_ENV === 'development' ? {
  'free-new': {
    name: 'Free (No Trial)',
    local: {
      licenseKey: null,
      licenseStatus: null,
      licenseType: null,
      licenseExpiresAt: null,
      licenseEmail: null,
      fullLicenseKey: null,
      licenseCache: null,
      trialStartDate: null,
      trialExpired: true // No trial for this preset
    }
  },
  'free-trial-fresh': {
    name: 'Free Trial (Fresh Install)',
    local: {
      licenseKey: null,
      licenseStatus: 'free',
      licenseType: null,
      licenseExpiresAt: null,
      licenseEmail: null,
      fullLicenseKey: null,
      licenseCache: null,
      trialStartDate: new Date().toISOString(), // Trial starts now (14 days remaining)
      trialExpired: false,
      trialWelcomeModalShown: false // Reset to show welcome modal
    }
  },
  'free-trial-updated': {
    name: 'Free Trial (Updated User)',
    local: {
      licenseKey: null,
      licenseStatus: 'free',
      licenseType: null,
      licenseExpiresAt: null,
      licenseEmail: null,
      fullLicenseKey: null,
      licenseCache: null,
      trialStartDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago (9 days remaining)
      trialExpired: false
    }
  },
  'free-trial-ending': {
    name: 'Free Trial (Ending Soon)',
    local: {
      licenseKey: null,
      licenseStatus: 'free',
      licenseType: null,
      licenseExpiresAt: null,
      licenseEmail: null,
      fullLicenseKey: null,
      licenseCache: null,
      trialStartDate: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(), // 12 days ago (2 days remaining)
      trialExpired: false
    }
  },
  'free-trial-expired': {
    name: 'Free Trial (Expired)',
    local: {
      licenseKey: null,
      licenseStatus: 'free',
      licenseType: null,
      licenseExpiresAt: null,
      licenseEmail: null,
      fullLicenseKey: null,
      licenseCache: null,
      trialStartDate: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(), // 20 days ago (expired)
      trialExpired: false, // Let natural expiration logic trigger resetProFeatureSettings()
      trialExpiredModalShown: false // Reset to show expired modal
    }
  },
  'pro-yearly-newly-activated': {
    name: 'Pro Yearly (Newly Activated)',
    local: {
      licenseKey: 'BRDTB-XXXX-XXXX-XXXX',
      licenseStatus: 'active',
      licenseType: 'yearly',
      licenseExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      licenseEmail: 'user@example.com',
      fullLicenseKey: 'BRDTB-TEST-YEAR-NEW',
      proWelcomeShown: false,
      licenseCache: {
        status: 'active',
        type: 'yearly',
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        email: 'user@example.com',
        lastVerified: Date.now()
      }
    }
  },
  'pro-lifetime-newly-activated': {
    name: 'Pro Lifetime (Newly Activated)',
    local: {
      licenseKey: 'BRDTB-XXXX-XXXX-XXXX',
      licenseStatus: 'active',
      licenseType: 'lifetime',
      licenseExpiresAt: null,
      licenseEmail: 'user@example.com',
      fullLicenseKey: 'BRDTB-TEST-LIFE-NEW',
      proWelcomeShown: false,
      licenseCache: {
        status: 'active',
        type: 'lifetime',
        expiresAt: null,
        email: 'user@example.com',
        lastVerified: Date.now()
      }
    }
  },
  'pro-yearly-active': {
    name: 'Pro Yearly (Active)',
    local: {
      licenseKey: 'BRDTB-XXXX-XXXX-XXXX',
      licenseStatus: 'active',
      licenseType: 'yearly',
      licenseExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      licenseEmail: 'user@example.com',
      fullLicenseKey: 'BRDTB-TEST-YEAR-ACTV',
      licenseCache: {
        status: 'active',
        type: 'yearly',
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        email: 'user@example.com',
        lastVerified: Date.now()
      }
    }
  },
  'pro-yearly-grace': {
    name: 'Pro Yearly (Grace Period)',
    local: {
      licenseKey: 'BRDTB-XXXX-XXXX-XXXX',
      licenseStatus: 'grace',
      licenseType: 'yearly',
      licenseExpiresAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      licenseEmail: 'user@example.com',
      fullLicenseKey: 'BRDTB-TEST-YEAR-GRCE',
      licenseCache: {
        status: 'grace',
        type: 'yearly',
        expiresAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        email: 'user@example.com',
        lastVerified: Date.now()
      }
    }
  },
  'pro-yearly-expired': {
    name: 'Pro Yearly (Expired)',
    local: {
      licenseKey: 'BRDTB-XXXX-XXXX-XXXX',
      licenseStatus: 'expired',
      licenseType: 'yearly',
      licenseExpiresAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      licenseEmail: 'user@example.com',
      fullLicenseKey: 'BRDTB-TEST-YEAR-EXPD',
      licenseCache: {
        status: 'expired',
        type: 'yearly',
        expiresAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        email: 'user@example.com',
        lastVerified: Date.now()
      }
    }
  },
  'pro-lifetime-active': {
    name: 'Pro Lifetime (Active)',
    local: {
      licenseKey: 'BRDTB-XXXX-XXXX-XXXX',
      licenseStatus: 'active',
      licenseType: 'lifetime',
      licenseExpiresAt: null,
      licenseEmail: 'user@example.com',
      fullLicenseKey: 'BRDTB-TEST-LIFE-ACTV',
      licenseCache: {
        status: 'active',
        type: 'lifetime',
        expiresAt: null,
        email: 'user@example.com',
        lastVerified: Date.now()
      }
    }
  },
  'disabled-yearly': {
    name: 'Disabled (Was Yearly)',
    local: {
      licenseKey: 'BRDTB-XXXX-XXXX-XXXX',
      licenseStatus: 'disabled',
      licenseType: 'yearly',
      licenseExpiresAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      licenseEmail: 'user@example.com',
      fullLicenseKey: 'BRDTB-TEST-YEAR-DSBL',
      licenseCache: {
        status: 'disabled',
        type: 'yearly',
        expiresAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        email: 'user@example.com',
        lastVerified: Date.now()
      }
    }
  },
  'disabled-lifetime': {
    name: 'Disabled (Was Lifetime)',
    local: {
      licenseKey: 'BRDTB-XXXX-XXXX-XXXX',
      licenseStatus: 'disabled',
      licenseType: 'lifetime',
      licenseExpiresAt: null,
      licenseEmail: 'user@example.com',
      fullLicenseKey: 'BRDTB-TEST-LIFE-DSBL',
      licenseCache: {
        status: 'disabled',
        type: 'lifetime',
        expiresAt: null,
        email: 'user@example.com',
        lastVerified: Date.now()
      }
    }
  },
  'offline-within-grace': {
    name: 'Offline (Within Grace)',
    local: {
      licenseKey: 'BRDTB-XXXX-XXXX-XXXX',
      licenseStatus: 'active',
      licenseType: 'yearly',
      licenseExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      licenseEmail: 'user@example.com',
      fullLicenseKey: 'BRDTB-TEST-OFFL-INGR',
      licenseCache: {
        status: 'active',
        type: 'yearly',
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        email: 'user@example.com',
        lastVerified: Date.now() - 48 * 60 * 60 * 1000, // 48 hours ago (within 72-hour grace)
        lastVerifyResponse: { valid: true, status: 'active' }
      }
    }
  },
  'offline-grace-expired': {
    name: 'Offline (Grace Expired)',
    local: {
      licenseKey: 'BRDTB-XXXX-XXXX-XXXX',
      licenseStatus: 'active',
      licenseType: 'yearly',
      licenseExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      licenseEmail: 'user@example.com',
      fullLicenseKey: 'BRDTB-TEST-OFFL-EXPD',
      licenseCache: {
        status: 'active',
        type: 'yearly',
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        email: 'user@example.com',
        lastVerified: Date.now() - 96 * 60 * 60 * 1000, // 96 hours ago (past 72-hour grace)
        lastVerifyResponse: { valid: true, status: 'active' }
      }
    }
  }
} : null;

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
              <img src="images/svg/close.svg" data-i18n-alt="closeAlt" alt="Close" width="20" height="20">
            </button>
          </div>

          <!-- PRO Status Section - at the top -->
          <div id="license-status-section" class="license-status-section license-status-top">
            <!-- Populated by JavaScript -->
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

            <!-- Media & Playback Category -->
            <div class="settings-category-title" data-i18n="settingsCategoryMedia">Media & Playback</div>
            
            <div class="setting">
              <div class="toggle-container">
                <div class="toggle-text">
                  <span class="setting-label-with-icon">
                    <img src="images/svg/microphone.svg" alt="" width="18" height="18" class="setting-icon">
                    <span data-i18n="autoPlayBirdCalls">Auto-play media</span>
                  </span>
                  <p class="help-text" data-i18n="autoPlayHelpText">Automatically play bird calls in photo mode or videos in video mode with each new tab. Quiet hours will override this when active.</p>
                </div>
                <label class="switch" data-i18n-title="autoPlayTooltip" title="Enable to automatically play bird calls or videos when you open a new tab">
                  <input type="checkbox" id="modal-auto-play">
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
                  <p class="help-text" id="modal-video-mode-help" data-i18n="videoModeHelpText">Show bird videos instead of photos when available.</p>
                </div>
                <label class="switch" data-i18n-title="videoModeTooltip" title="Enable to show bird videos instead of photos when available">
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

            <!-- Productivity & Interface Category -->
            <div class="settings-category-title" data-i18n="settingsCategoryProductivity">Productivity & Interface</div>

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
              --debug-accent: #f44336;
              --debug-accent-5: rgba(244, 67, 54, 0.05);
              --debug-accent-10: rgba(244, 67, 54, 0.1);
              --debug-accent-20: rgba(244, 67, 54, 0.2);
              --debug-accent-30: rgba(244, 67, 54, 0.3);
              --debug-accent-50: rgba(244, 67, 54, 0.5);
              --debug-accent-70: rgba(244, 67, 54, 0.7);
              --debug-accent-80: rgba(244, 67, 54, 0.8);
              margin-top: 16px;
              padding: 16px var(--modal-spacing, 16px);
              border-top: 1px solid var(--modal-border, var(--white-10));
            }
            .debug-section-header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              cursor: pointer;
              padding: 8px 0;
              user-select: none;
            }
            .debug-section-header:hover .debug-section-title {
              color: var(--modal-text-primary, var(--white-90));
            }
            .debug-header-controls {
              display: flex;
              align-items: center;
              gap: 12px;
            }
            .debug-close-btn {
              width: 20px;
              height: 20px;
              border: none;
              background: transparent;
              color: var(--debug-accent);
              font-size: 18px;
              line-height: 1;
              cursor: pointer;
              opacity: 0.6;
              transition: opacity 0.2s ease;
              padding: 0;
            }
            .debug-close-btn:hover {
              opacity: 1;
            }
            .settings-debug-section .debug-section-title {
              font-size: 13px;
              font-weight: 600;
              color: var(--modal-text-secondary, var(--white-70));
              text-transform: uppercase;
              letter-spacing: 0.5px;
              margin: 0;
              transition: color 0.2s ease;
            }
            .debug-chevron {
              width: 0;
              height: 0;
              border-left: 5px solid transparent;
              border-right: 5px solid transparent;
              border-top: 6px solid var(--debug-accent);
              transition: transform 0.2s ease;
            }
            .debug-section-header.expanded .debug-chevron {
              transform: rotate(180deg);
            }
            .debug-buttons-wrapper {
              display: grid;
              grid-template-rows: 0fr;
              transition: grid-template-rows 0.3s ease, opacity 0.2s ease;
              opacity: 0;
            }
            .debug-buttons-wrapper > div {
              overflow: hidden;
            }
            .debug-buttons-wrapper.expanded {
              grid-template-rows: 1fr;
              opacity: 1;
            }
            .debug-buttons-wrapper.expanded > div {
              overflow: visible;
            }
            .debug-subsection {
              margin-top: 16px;
              padding-top: 16px;
              border-top: 1px dashed var(--debug-accent-30);
            }
            .debug-subsection-title {
              font-size: 11px;
              font-weight: 600;
              color: var(--debug-accent-70);
              text-transform: uppercase;
              letter-spacing: 0.5px;
              margin: 0 0 12px 0;
            }
            .debug-current-state {
              font-family: monospace;
              font-size: 12px;
              color: var(--debug-accent-80);
              background: var(--debug-accent-5);
              padding: 8px 10px;
              border-radius: 6px;
              margin-bottom: 12px;
              word-break: break-all;
            }
            .debug-state-selector {
              display: flex;
              gap: 8px;
              align-items: center;
            }
            .debug-select {
              flex: 1;
              height: 40px;
              padding: 8px 10px;
              border-radius: 8px;
              background: var(--debug-accent-10);
              color: var(--debug-accent);
              border: 1px solid var(--debug-accent-30);
              font-size: 13px;
              line-height: 1.4;
              cursor: pointer;
            }
            .debug-select:hover {
              border-color: var(--debug-accent-50);
            }
            .debug-select optgroup {
              color: var(--debug-accent);
              background: var(--surface-dark);
            }
            .debug-select option {
              color: var(--white-80);
              background: var(--surface-dark);
            }
            .settings-debug-section .debug-buttons {
              display: flex;
              flex-direction: column;
              gap: 8px;
              padding-top: 12px;
            }
            .settings-debug-section .debug-button {
              width: 100%;
              padding: 10px 14px;
              border-radius: 8px;
              border: 1px solid var(--debug-accent-30);
              font-size: 13px;
              font-weight: 500;
              background-color: var(--debug-accent-10);
              color: var(--debug-accent);
              cursor: pointer;
              transition: all 0.2s ease;
            }
            .settings-debug-section .debug-button:hover {
              background-color: var(--debug-accent-20);
              border-color: var(--debug-accent-50);
            }
            .settings-debug-section .debug-button:active {
              background-color: var(--debug-accent-30);
            }
          </style>
          <div class="settings-debug-section" id="settings-debug-section">
            <div class="debug-section-header" id="debug-section-toggle">
              <h3 class="debug-section-title" data-i18n="debugOptions">Debug Options</h3>
              <div class="debug-header-controls">
                <span class="debug-chevron"></span>
                <button class="debug-close-btn" id="debug-section-close" title="Hide debug section until refresh">×</button>
              </div>
            </div>
            <div class="debug-buttons-wrapper" id="debug-buttons-wrapper">
              <div class="debug-buttons">
                <div style="display: flex; gap: 8px; align-items: center;">
                  <select id="sidebar-tour-version" class="debug-select" style="width: 60px; height: 36px; padding: 0 8px; font-size: 14px; text-align: center;">
                    <!-- Populated by JS -->
                  </select>
                  <button id="sidebar-reset-tour" class="debug-button" style="flex: 1;" data-i18n="resetTour">Reset Feature Tour</button>
                </div>
                <button id="sidebar-reset-onboarding" class="debug-button" data-i18n="resetOnboarding">Reset Onboarding</button>
                <button id="sidebar-delete-cache" class="debug-button" data-i18n="deleteCache">Delete Cache</button>
                <div class="debug-subsection">
                  <h4 class="debug-subsection-title">User State Simulator</h4>
                  <div id="debug-current-state" class="debug-current-state">Loading...</div>
                  <div class="debug-state-selector">
                    <select id="debug-user-state-select" class="debug-select">
                      <option value="">-- Select State --</option>
                      <optgroup label="Free Users">
                        <option value="free-new">Free (No Trial)</option>
                      </optgroup>
                      <optgroup label="Free Trial (14 Days)">
                        <option value="free-trial-fresh">Trial (Fresh Install - 14 days)</option>
                        <option value="free-trial-updated">Trial (Updated User - 9 days)</option>
                        <option value="free-trial-ending">Trial (Ending Soon - 2 days)</option>
                        <option value="free-trial-expired">Trial (Expired)</option>
                      </optgroup>
                      <optgroup label="Pro Yearly">
                        <option value="pro-yearly-newly-activated">Pro Yearly (Newly Activated)</option>
                        <option value="pro-yearly-active">Pro Yearly (Active)</option>
                        <option value="pro-yearly-grace">Pro Yearly (Grace Period)</option>
                        <option value="pro-yearly-expired">Pro Yearly (Expired)</option>
                      </optgroup>
                      <optgroup label="Pro Lifetime">
                        <option value="pro-lifetime-newly-activated">Pro Lifetime (Newly Activated)</option>
                        <option value="pro-lifetime-active">Pro Lifetime (Active)</option>
                      </optgroup>
                      <optgroup label="Disabled">
                        <option value="disabled-yearly">Disabled (Was Yearly)</option>
                        <option value="disabled-lifetime">Disabled (Was Lifetime)</option>
                      </optgroup>
                      <optgroup label="Offline Scenarios">
                        <option value="offline-within-grace">Offline (Within Grace)</option>
                        <option value="offline-grace-expired">Offline (Grace Expired)</option>
                      </optgroup>
                    </select>
                    <button id="debug-apply-state" class="debug-button" style="flex: 0 0 auto; width: auto;">Apply</button>
                  </div>
                </div>
              </div>
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

    if (IS_EDGE && this.sidebar) {
      const googleAppsToggle = this.sidebar.querySelector('#modal-google-apps');
      const googleAppsSetting = googleAppsToggle?.closest('.setting');
      if (googleAppsSetting) {
        googleAppsSetting.remove();
      }
    }

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
    // NOTE: Settings button click is now handled by the control options menu in script.js
    // The options menu calls SettingsSidebar.getInstance().open() when "Settings" is selected

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
    // Region select - non-US requires Pro
    if (this.regionSelect) {
      this.regionSelect.addEventListener('change', async (e) => {
        if (e.target.value !== 'US' && !(await isPro())) {
          e.target.value = 'US';
          showUpgradeModal('region');
          return;
        }
        this.saveSettings();
      });
    }
    if (this.autoPlayCheckbox) {
      this.autoPlayCheckbox.addEventListener('change', () => this.saveSettings());
    }
    if (this.quietHoursCheckbox) {
      this.quietHoursCheckbox.addEventListener('change', () => this.saveSettings());
    }
    // Clock display - requires Pro
    if (this.clockDisplayCheckbox) {
      this.clockDisplayCheckbox.addEventListener('change', async (e) => {
        if (e.target.checked && !(await isPro())) {
          e.target.checked = false;
          showUpgradeModal('clockTimer');
          return;
        }
        this.saveSettings();
      });
    }
    // Special handler for productivity features with permission request
    if (this.enableProductivityCheckbox) {
      this.enableProductivityCheckbox.addEventListener('change', async (e) => {
        await this.handleProductivityToggle(e.target.checked);
      });
    }
    // Video mode - requires Pro
    if (this.videoModeCheckbox) {
      this.videoModeCheckbox.addEventListener('change', async (e) => {
        if (e.target.checked && !(await isPro())) {
          e.target.checked = false;
          showUpgradeModal('videoMode');
          return;
        }
        this.saveSettings();
      });
    }
    // High-res images - requires Pro
    if (this.highResCheckbox) {
      this.highResCheckbox.addEventListener('change', async (e) => {
        if (e.target.checked && !(await isPro())) {
          e.target.checked = false;
          showUpgradeModal('highResImages');
          return;
        }
        this.saveSettings();
      });
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
        }
        // Pro feature: Video Mode
        else if (checkbox.id === 'modal-video-mode') {
          const newValue = !checkbox.checked;
          if (newValue && !(await isPro())) {
            showUpgradeModal('videoMode');
            return;
          }
          checkbox.checked = newValue;
          this.saveSettings();
        }
        // Pro feature: High-Res Images
        else if (checkbox.id === 'modal-high-res') {
          const newValue = !checkbox.checked;
          if (newValue && !(await isPro())) {
            showUpgradeModal('highResImages');
            return;
          }
          checkbox.checked = newValue;
          this.saveSettings();
        }
        // Pro feature: Clock Display
        else if (checkbox.id === 'modal-clock-display') {
          const newValue = !checkbox.checked;
          if (newValue && !(await isPro())) {
            showUpgradeModal('clockTimer');
            return;
          }
          checkbox.checked = newValue;
          this.saveSettings();
        }
        else {
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
    // Debug section collapse/expand toggle (collapsed by default)
    const debugSection = document.getElementById('settings-debug-section');
    const debugToggle = document.getElementById('debug-section-toggle');
    const debugButtonsWrapper = document.getElementById('debug-buttons-wrapper');
    const debugCloseBtn = document.getElementById('debug-section-close');

    if (debugToggle && debugButtonsWrapper) {
      debugToggle.addEventListener('click', (e) => {
        // Don't toggle if clicking the close button
        if (e.target.closest('#debug-section-close')) return;

        const isExpanded = debugButtonsWrapper.classList.contains('expanded');
        if (isExpanded) {
          debugButtonsWrapper.classList.remove('expanded');
          debugToggle.classList.remove('expanded');
        } else {
          debugButtonsWrapper.classList.add('expanded');
          debugToggle.classList.add('expanded');
        }
      });
    }

    // Close button to hide entire debug section (dev-only, resets on refresh)
    if (debugCloseBtn && debugSection) {
      debugCloseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        debugSection.style.display = 'none';
      });
    }

    const resetTourButton = document.getElementById('sidebar-reset-tour');
    const resetOnboardingButton = document.getElementById('sidebar-reset-onboarding');
    const deleteCacheButton = document.getElementById('sidebar-delete-cache');

    if (resetTourButton) {
      // Populate version dropdown
      const versionSelect = document.getElementById('sidebar-tour-version');
      if (versionSelect) {
        const currentMaxVersion = getTourVersion();
        for (let i = 0; i <= currentMaxVersion; i++) {
          const option = document.createElement('option');
          option.value = i;
          option.textContent = `v${i}`;
          versionSelect.appendChild(option);
        }
        versionSelect.value = 0;
      }

      resetTourButton.addEventListener('click', async () => {
        try {
          const targetVersion = versionSelect ? parseInt(versionSelect.value, 10) : 0;

          // Reset the feature tour version
          await new Promise((resolve, reject) => {
            chrome.storage.sync.set({ featureTourVersion: targetVersion }, function () {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
              } else {
                resolve();
              }
            });
          });

          // Also reset the Chrome footer notification
          await resetChromeFooterNotification();

          const successMsg = `Tour version set to ${targetVersion}. Reload to see effect.`;
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
          // Reset local storage settings to their default values
          await new Promise((resolve, reject) => {
            chrome.storage.local.clear(function () {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve();
              }
            });
          });

          // Set default values in local storage (device-specific settings)
          await new Promise((resolve, reject) => {
            chrome.storage.local.set({
              region: 'US',
              autoPlay: false,
              quietHours: false,
              clockDisplayMode: 'clock',
              quickAccessEnabled: true,
              hideTopSites: true
            }, function () {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve();
              }
            });
          });

          // Reset sync storage for cross-device state
          await new Promise((resolve, reject) => {
            chrome.storage.sync.set({
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

          // Also clear custom shortcuts from local storage
          await new Promise((resolve, reject) => {
            chrome.storage.local.remove(['customShortcuts'], function () {
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

    // User State Simulator (dev-only)
    const debugCurrentState = document.getElementById('debug-current-state');
    const debugUserStateSelect = document.getElementById('debug-user-state-select');
    const debugApplyStateButton = document.getElementById('debug-apply-state');

    if (debugCurrentState) {
      this.updateDebugCurrentState(debugCurrentState);
    }

    if (debugApplyStateButton && debugUserStateSelect) {
      debugApplyStateButton.addEventListener('click', async () => {
        const selectedPreset = debugUserStateSelect.value;

        if (!selectedPreset) {
          alert('Please select a user state to apply.');
          return;
        }

        if (!USER_STATE_PRESETS || !USER_STATE_PRESETS[selectedPreset]) {
          alert('Invalid preset selected.');
          return;
        }

        const preset = USER_STATE_PRESETS[selectedPreset];

        if (!confirm(`Apply "${preset.name}" state?\n\nThis will clear all license data and apply the selected state. The page will reload.`)) {
          return;
        }

        try {
          // Clear all existing license data first
          await this.clearAllLicenseData();

          // Apply the new state
          await this.applyUserState(preset);

          // Reload the page to apply changes
          window.location.reload();
        } catch (error) {
          log('Error applying user state: ' + error.message);
          alert('Error applying user state: ' + error.message);
        }
      });
    }

  }

  /**
   * Clear all license data from storage (dev-only helper)
   * All license data is now in local storage
   */
  async clearAllLicenseData() {
    const localKeys = [
      'licenseKey', 'licenseStatus', 'licenseType', 'licenseExpiresAt',
      'licenseEmail', 'fullLicenseKey', 'licenseCache', 'trialStartDate', 'trialExpired',
      'trialWelcomeModalShown', 'trialExpiredModalShown'
    ];

    await new Promise((resolve, reject) => {
      chrome.storage.local.remove(localKeys, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    });
  }

  /**
   * Apply a user state preset (dev-only helper)
   * All license data is now stored in local storage (device-specific)
   *
   * After applying the preset, checks if the resulting state is non-Pro
   * and resets Pro feature settings accordingly (mimics what verifyLicense() does)
   */
  async applyUserState(preset) {
    // Apply local storage values (all license data is now in local)
    const localValues = {};
    for (const [key, value] of Object.entries(preset.local)) {
      if (value !== null) {
        localValues[key] = value;
      }
    }
    if (Object.keys(localValues).length > 0) {
      await new Promise((resolve, reject) => {
        chrome.storage.local.set(localValues, () => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve();
        });
      });
    }

    // Clean up one-time modal flags when the preset doesn't explicitly set them,
    // so they don't leak across debug state switches.
    const oneTimeFlags = ['proWelcomeShown', 'trialWelcomeModalShown', 'trialExpiredModalShown'];
    const flagsToRemove = oneTimeFlags.filter(key => !(key in preset.local));
    if (flagsToRemove.length > 0) {
      await new Promise((resolve) => {
        chrome.storage.local.remove(flagsToRemove, resolve);
      });
    }

    // Check if applied state represents a non-Pro user and reset Pro settings
    // This mimics what verifyLicense() does when detecting a Pro → non-Pro transition
    const isNonProState = this.isNonProPreset(preset);
    if (isNonProState) {
      log('Applied non-Pro state, resetting Pro feature settings');
      await resetProFeatureSettings();
    }
  }

  /**
   * Check if a preset represents a non-Pro state (dev-only helper)
   * Returns true if the preset would result in isPro() returning false
   */
  isNonProPreset(preset) {
    const local = preset.local;

    // Check license status - Pro requires 'active' or 'grace'
    const hasProLicense = local.licenseStatus === 'active' || local.licenseStatus === 'grace';
    if (hasProLicense) {
      return false; // Has Pro license
    }

    // Check trial status - Pro if trial is active (not expired and within 14 days)
    if (local.trialStartDate && !local.trialExpired) {
      // Calculate if trial would still be active
      const trialStart = new Date(local.trialStartDate);
      const now = new Date();
      const daysSinceStart = (now - trialStart) / (1000 * 60 * 60 * 24);
      if (daysSinceStart < CONFIG.LICENSE.TRIAL_DURATION_DAYS) {
        return false; // Trial is active
      }
    }

    // No Pro license and no active trial = non-Pro state
    return true;
  }

  /**
   * Update the debug current state display (dev-only helper)
   * License data is now in local storage (device-specific)
   */
  async updateDebugCurrentState(element) {
    if (!element) return;

    try {
      const localData = await new Promise((resolve) => {
        chrome.storage.local.get(['licenseKey', 'licenseStatus', 'licenseType', 'trialStartDate', 'trialExpired'], resolve);
      });

      const status = localData.licenseStatus || 'none';
      const type = localData.licenseType || 'free';
      const hasKey = localData.licenseKey ? 'yes' : 'no';

      // Calculate trial info
      let trialInfo = 'none';
      if (localData.trialStartDate && !localData.trialExpired) {
        const startDate = new Date(localData.trialStartDate);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const daysRemaining = Math.max(0, 14 - daysSinceStart);
        trialInfo = daysRemaining > 0 ? `${daysRemaining}d left` : 'expired';
      } else if (localData.trialExpired) {
        trialInfo = 'expired';
      }

      element.textContent = `Status: ${status} | Type: ${type} | Key: ${hasKey} | Trial: ${trialInfo}`;
    } catch (error) {
      element.textContent = 'Error loading state';
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
    // Load current settings from local storage (device-specific)
    if (!chrome?.storage?.local) {
      warn('Chrome storage API not available');
      return;
    }

    chrome.storage.local.get(['region', 'autoPlay', 'quietHours', 'clockDisplayMode', 'quickAccessEnabled', 'videoMode', 'highResImages', 'googleAppsEnabled', 'chromeTabEnabled'], (result) => {

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
        // Default to 'clock' for fresh installs where clockDisplayMode is undefined
        const clockMode = result.clockDisplayMode !== undefined ? result.clockDisplayMode : 'clock';
        this.clockDisplayCheckbox.checked = (clockMode === 'clock' || clockMode === 'timer');
      }
      if (this.enableProductivityCheckbox) {
        // Default quickAccessEnabled to true for fresh installs
        this.enableProductivityCheckbox.checked = result.quickAccessEnabled !== undefined ? result.quickAccessEnabled : true;
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

    // Update license status section
    this.updateLicenseStatusSection();
  }

  /**
   * Update the license status section in the sidebar
   */
  async updateLicenseStatusSection() {
    const statusSection = document.getElementById('license-status-section');
    if (!statusSection) return;

    try {
      const licenseStatus = await getLicenseStatus();
      const { isPro: hasPro, status, type, expiresAt, email, maskedKey, isTrialActive, trialDaysRemaining, isOfflineGraceExpired } = licenseStatus;

      if (hasPro) {
        // Check if user is on free trial (no paid license, but has trial access)
        const isOnFreeTrial = isTrialActive && status === 'trial' && type === 'trial';

        if (isOnFreeTrial) {
          // Free trial user - show trial status with days remaining and upgrade CTA
          const daysText = trialDaysRemaining === 1
            ? (getMessage('trialDayLeft') || '1 day left')
            : (getMessage('trialDaysLeft', [trialDaysRemaining]) || `${trialDaysRemaining} days left`);

          statusSection.innerHTML = `
            <div class="license-compact license-compact-trial">
              <div class="license-compact-info">
                <img src="images/svg/crown.svg" alt="" width="16" height="16" class="license-compact-icon">
                <span class="license-compact-label">${getMessage('proBadgeLabel') || 'Pro'}</span>
                <span class="license-status-dot trial"></span>
                <span class="license-compact-status trial">${getMessage('licenseTrial') || 'Trial'}</span>
                <span class="license-compact-days">${daysText}</span>
              </div>
              <div class="license-compact-actions">
                <button class="license-compact-btn primary" id="trial-upgrade-btn">${getMessage('upgradeToPro') || 'Upgrade'}</button>
              </div>
            </div>
          `;

          // Bind trial upgrade button to show modal
          const trialUpgradeBtn = document.getElementById('trial-upgrade-btn');
          trialUpgradeBtn?.addEventListener('click', () => {
            trackProUpgradeClicked('settings_trial');
            showUpgradeModal();
          });

          // No deactivate or manage needed for free trial
          return;
        }

        // Paid Pro user display - single row design
        const statusBadgeClass = status === 'active' ? 'active' : (status === 'grace' ? 'grace' : 'expired');
        const statusLabel = status === 'active'
          ? (getMessage('licenseActive') || 'Active')
          : (status === 'grace'
            ? (getMessage('licenseGrace') || 'Renew Soon')
            : (getMessage('licenseExpired') || 'Expired'));

        const typeLabel = type === 'lifetime'
          ? (getMessage('licenseLifetime') || 'Lifetime')
          : (getMessage('licenseYearly') || 'Yearly');

        // Build the actions based on status and type
        // Keep the top row minimal: refresh icon + manage toggle (+ renew CTA for grace)
        // Subscription/Billing actions are inside the expandable manage panel
        let actionsHtml = '';
        const refreshBtnHtml = `
            <button class="license-compact-btn icon-btn" id="refresh-status-btn" title="${getMessage('refreshStatus') || 'Refresh status'}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M23 4v6h-6M1 20v-6h6"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
            </button>`;

        if (status === 'grace') {
          // Grace period: refresh + manage + renew CTA (renew is primary action, stays in top row)
          actionsHtml = `
            ${refreshBtnHtml}
            <button class="license-compact-btn" id="manage-license-btn">${getMessage('manage') || 'Manage'}</button>
            <button class="license-compact-btn primary" id="renew-btn">${getMessage('renew') || 'Renew'}</button>
          `;
        } else if (status === 'active') {
          // Active license (yearly or lifetime): refresh + manage toggle only
          actionsHtml = `
            ${refreshBtnHtml}
            <button class="license-compact-btn" id="manage-license-btn">${getMessage('manage') || 'Manage'}</button>
          `;
        } else {
          // Other status: manage toggle only
          actionsHtml = `
            <button class="license-compact-btn" id="manage-license-btn">${getMessage('manage') || 'Manage'}</button>
          `;
        }

        // Build the subscription/billing action for the details panel
        let panelActionHtml = '';
        if (status === 'grace') {
          panelActionHtml = `
            <button class="license-detail-portal-btn" id="renew-btn-panel">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              ${getMessage('manageSubscription') || 'Manage Subscription'}
            </button>`;
        } else if (type === 'yearly' && status === 'active') {
          panelActionHtml = `
            <button class="license-detail-portal-btn" id="manage-subscription-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              ${getMessage('manageSubscription') || 'Manage Subscription'}
            </button>`;
        } else if (type === 'lifetime' && status === 'active') {
          panelActionHtml = `
            <button class="license-detail-portal-btn" id="manage-subscription-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              ${getMessage('billingHistory') || 'Billing & Invoices'}
            </button>`;
        }

        statusSection.innerHTML = `
          <div class="license-compact">
            <div class="license-compact-info">
              <img src="images/svg/crown.svg" alt="" width="16" height="16" class="license-compact-icon">
              <span class="license-compact-label">Pro</span>
              <span class="license-status-dot ${statusBadgeClass}"></span>
              <span class="license-compact-status ${statusBadgeClass}">${statusLabel}</span>
              ${status !== 'grace' ? `<span class="license-compact-type">${typeLabel}</span>` : ''}
            </div>
            <div class="license-compact-actions">
              ${actionsHtml}
            </div>
          </div>
          <div class="license-details-panel hidden" id="license-details-panel">
            <div class="license-details-content">
              ${email ? `
              <div class="license-detail-row">
                <span>${getMessage('email') || 'Email'}</span>
                <span>${escapeHtml(email)}</span>
              </div>
              ` : ''}
              ${maskedKey ? `
              <div class="license-detail-row">
                <span>${getMessage('licenseKey') || 'License'}</span>
                <span style="font-family: monospace; font-size: 11px;">${escapeHtml(maskedKey)}</span>
              </div>
              ` : ''}
              ${expiresAt && type !== 'lifetime' ? `
              <div class="license-detail-row">
                <span>${getMessage('expires') || 'Expires'}</span>
                <span>${new Date(expiresAt).toLocaleDateString()}</span>
              </div>
              ` : ''}
              <div class="license-detail-actions">
                ${panelActionHtml}
                <button class="license-detail-deactivate" id="deactivate-license-btn">
                  ${getMessage('deactivate') || 'Deactivate'}
                </button>
              </div>
            </div>
          </div>
        `;

        // Bind manage button to toggle details panel
        const manageBtn = document.getElementById('manage-license-btn');
        const detailsPanel = document.getElementById('license-details-panel');
        manageBtn?.addEventListener('click', () => {
          detailsPanel?.classList.toggle('hidden');
          manageBtn.textContent = detailsPanel?.classList.contains('hidden')
            ? (getMessage('manage') || 'Manage')
            : (getMessage('close') || 'Close');
        });

        // Bind refresh button for grace period
        const refreshBtn = document.getElementById('refresh-status-btn');
        refreshBtn?.addEventListener('click', async () => {
          refreshBtn.disabled = true;
          refreshBtn.classList.add('spinning');
          try {
            await verifyLicense();
            await this.updateLicenseStatusSection();
          } catch (error) {
            log(`Error refreshing license status: ${error.message}`);
          } finally {
            refreshBtn.disabled = false;
            refreshBtn.classList.remove('spinning');
          }
        });

        // Bind renew button (grace period) - opens Lemon Squeezy Customer Portal
        const renewBtn = document.getElementById('renew-btn');
        renewBtn?.addEventListener('click', async () => {
          const originalText = renewBtn.textContent;
          renewBtn.disabled = true;
          renewBtn.textContent = getMessage('loading') || 'Loading...';

          try {
            const result = await openCustomerPortal();
            if (!result.success) {
              log(`Portal error: ${result.error}`);
              // Fallback to pricing page
              chrome.tabs.create({ url: `${CONFIG.WEBSITE_URL}/pricing` });
            }
          } catch (error) {
            log(`Error opening customer portal: ${error.message}`);
            // Fallback to pricing page
            chrome.tabs.create({ url: `${CONFIG.WEBSITE_URL}/pricing` });
          } finally {
            renewBtn.disabled = false;
            renewBtn.textContent = originalText;
          }
        });

        // Bind portal buttons (manage subscription / billing / renew panel) - opens Lemon Squeezy Customer Portal
        // These are inside the expandable details panel
        const portalBtns = [
          document.getElementById('manage-subscription-btn'),
          document.getElementById('renew-btn-panel'),
        ].filter(Boolean);

        portalBtns.forEach(btn => {
          btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.classList.add('loading');

            try {
              const result = await openCustomerPortal();
              if (!result.success) {
                log(`Portal error: ${result.error}`);
                chrome.tabs.create({ url: `${CONFIG.WEBSITE_URL}/pricing` });
              }
            } catch (error) {
              log(`Error opening customer portal: ${error.message}`);
              chrome.tabs.create({ url: `${CONFIG.WEBSITE_URL}/pricing` });
            } finally {
              btn.disabled = false;
              btn.classList.remove('loading');
            }
          });
        });

      } else if (status === 'expired' || status === 'disabled') {
        // Expired or disabled license - show upgrade prompt with manage option
        statusSection.innerHTML = `
          <div class="license-compact license-compact-expired">
            <div class="license-compact-info">
              <img src="images/svg/crown.svg" alt="" width="16" height="16" class="license-compact-icon" style="opacity: 0.5;">
              <span class="license-compact-label" style="opacity: 0.7;">Pro</span>
              <span class="license-status-dot expired"></span>
              <span class="license-compact-status expired">${getMessage('licenseExpired') || 'Expired'}</span>
            </div>
            <div class="license-compact-actions">
              <button class="license-compact-btn primary" id="upgrade-expired-btn">${getMessage('upgradeToPro') || 'Upgrade'}</button>
              <button class="license-compact-btn" id="manage-expired-btn">${getMessage('manage') || 'Manage'}</button>
            </div>
          </div>
          <div class="license-details-panel hidden" id="license-details-panel">
            <div class="license-details-content">
              ${email ? `
              <div class="license-detail-row">
                <span>${getMessage('email') || 'Email'}</span>
                <span>${escapeHtml(email)}</span>
              </div>
              ` : ''}
              ${maskedKey ? `
              <div class="license-detail-row">
                <span>${getMessage('licenseKey') || 'License'}</span>
                <span style="font-family: monospace; font-size: 11px;">${escapeHtml(maskedKey)}</span>
              </div>
              ` : ''}
              ${expiresAt ? `
              <div class="license-detail-row">
                <span>${getMessage('expiredOn') || 'Expired on'}</span>
                <span>${new Date(expiresAt).toLocaleDateString()}</span>
              </div>
              ` : ''}
              <button class="license-detail-deactivate" id="deactivate-license-btn">
                ${getMessage('deactivate') || 'Deactivate'}
              </button>
            </div>
          </div>
        `;

        // Bind upgrade button to show upgrade modal
        const upgradeExpiredBtn = document.getElementById('upgrade-expired-btn');
        upgradeExpiredBtn?.addEventListener('click', () => {
          trackProUpgradeClicked('settings_expired');
          showUpgradeModal();
        });

        // Bind manage button to toggle details panel
        const manageExpiredBtn = document.getElementById('manage-expired-btn');
        const detailsPanel = document.getElementById('license-details-panel');
        manageExpiredBtn?.addEventListener('click', () => {
          detailsPanel?.classList.toggle('hidden');
          manageExpiredBtn.textContent = detailsPanel?.classList.contains('hidden')
            ? (getMessage('manage') || 'Manage')
            : (getMessage('close') || 'Close');
        });

      } else if (isOfflineGraceExpired) {
        // Offline grace expired - user has a paid license but hasn't verified in 72+ hours
        // Pro features are disabled, but this isn't a license problem — just connectivity
        statusSection.innerHTML = `
          <div class="license-compact license-compact-offline">
            <div class="license-compact-info">
              <img src="images/svg/crown.svg" alt="" width="16" height="16" class="license-compact-icon" style="opacity: 0.5;">
              <span class="license-compact-label" style="opacity: 0.7;">Pro</span>
              <span class="license-status-dot offline"></span>
              <span class="license-compact-status offline">${getMessage('licenseOffline') || 'Offline'}</span>
            </div>
            <div class="license-compact-actions">
              <button class="license-compact-btn icon-btn" id="refresh-status-btn" title="${getMessage('refreshStatus') || 'Refresh status'}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M23 4v6h-6M1 20v-6h6"/>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                </svg>
              </button>
              <button class="license-compact-btn" id="manage-license-btn">${getMessage('manage') || 'Manage'}</button>
            </div>
          </div>
          <div class="license-offline-notice">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span>${getMessage('offlineGraceExpiredNotice') || 'Connect to the internet to verify your license and restore Pro features.'}</span>
          </div>
          <div class="license-details-panel hidden" id="license-details-panel">
            <div class="license-details-content">
              ${email ? `
              <div class="license-detail-row">
                <span>${getMessage('email') || 'Email'}</span>
                <span>${escapeHtml(email)}</span>
              </div>
              ` : ''}
              ${maskedKey ? `
              <div class="license-detail-row">
                <span>${getMessage('licenseKey') || 'License'}</span>
                <span style="font-family: monospace; font-size: 11px;">${escapeHtml(maskedKey)}</span>
              </div>
              ` : ''}
              ${expiresAt && type !== 'lifetime' ? `
              <div class="license-detail-row">
                <span>${getMessage('expires') || 'Expires'}</span>
                <span>${new Date(expiresAt).toLocaleDateString()}</span>
              </div>
              ` : ''}
              <div class="license-detail-actions">
                <button class="license-detail-deactivate" id="deactivate-license-btn">
                  ${getMessage('deactivate') || 'Deactivate'}
                </button>
              </div>
            </div>
          </div>
        `;

        // Bind manage button to toggle details panel
        const manageBtn = document.getElementById('manage-license-btn');
        const detailsPanel = document.getElementById('license-details-panel');
        manageBtn?.addEventListener('click', () => {
          detailsPanel?.classList.toggle('hidden');
          manageBtn.textContent = detailsPanel?.classList.contains('hidden')
            ? (getMessage('manage') || 'Manage')
            : (getMessage('close') || 'Close');
        });

        // Bind refresh button - attempts to verify license online
        const refreshBtn = document.getElementById('refresh-status-btn');
        refreshBtn?.addEventListener('click', async () => {
          refreshBtn.disabled = true;
          refreshBtn.classList.add('spinning');
          try {
            await verifyLicense();
            await this.updateLicenseStatusSection();
          } catch (error) {
            log(`Error refreshing license status: ${error.message}`);
          } finally {
            refreshBtn.disabled = false;
            refreshBtn.classList.remove('spinning');
          }
        });

      } else {
        // Free user (no trial, no paid license) - show upgrade prompt
        statusSection.innerHTML = `
          <div class="license-compact license-compact-free">
            <span class="license-compact-prompt">${getMessage('unlockProFeatures') || 'Unlock Pro features'}</span>
            <button class="license-compact-btn primary" id="upgrade-btn">${getMessage('upgradeToPro') || 'Upgrade'}</button>
          </div>
        `;

        // Bind upgrade button
        const upgradeBtn = document.getElementById('upgrade-btn');
        upgradeBtn?.addEventListener('click', () => {
          trackProUpgradeClicked('settings_free');
          showUpgradeModal();
        });
      }

      // Bind deactivate button (present in active, expired/disabled, and offline-grace-expired states)
      const deactivateBtn = document.getElementById('deactivate-license-btn');
      deactivateBtn?.addEventListener('click', async () => {
        if (confirm(getMessage('confirmDeactivate') || 'Are you sure you want to deactivate your license?')) {
          deactivateBtn.disabled = true;
          deactivateBtn.textContent = getMessage('deactivating') || 'Deactivating…';
          await deactivateLicense();
          trackLicenseDeactivated();
          showToast(getMessage('licenseDeactivated') || 'License deactivated. Reloading…', 'success');
          setTimeout(() => window.location.reload(), 1800);
        }
      });
    } catch (error) {
      log(`Error updating license status: ${error.message}`);
      statusSection.innerHTML = `
        <div class="license-compact license-compact-error">
          <span>${getMessage('licenseStatusError') || 'Unable to load license status'}</span>
        </div>
      `;
    }
  }

  saveSettings() {
    if (!chrome?.storage?.local) {
      warn('Chrome storage API not available');
      return;
    }

    // For clock display, we need to check current mode to preserve timer state
    chrome.storage.local.get(['clockDisplayMode'], (currentSettings) => {
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

      chrome.storage.local.set(settings, () => {
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
