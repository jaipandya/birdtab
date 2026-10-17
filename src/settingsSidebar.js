import { getTourVersion } from './featureTour.js';
import { getQuietHoursText } from './quietHours.js';
import { localizeHtml, getMessage } from './i18n.js';
import { log, warn } from './logger.js';
import { handleQuickAccessToggle } from './quickAccessPermissions.js';
import { resetChromeFooterNotification, showChromeFooterNotification } from './chromeFooterNotification.js';
import { IS_EDGE, canOpenBrowserNewTab } from './browserInfo.js';
import { RegionSelector } from './regionSelector.js';
import CONFIG from './config.js';
import { updateUserContext } from './sentry.js';
import { announce } from './loadingIndicators.js';
import { html, insertHtml } from './utils/html.js';
import { setNewTabMode, isPinnedToToolbar, maybeOfferToStepAside } from './newTabMode.js';
import { showSeenMilestone, clearSeenBirds } from './seenBirds.js';
import { showPinCoach } from './pinCoach.js';
import { trustedHtml } from './utils/html.js';

// Small pictures of a browser window for the "Open BirdTab" choices
const BIRD_GLYPH = '<g class="art-bird" transform="translate(32 18) scale(1.05)"><path d="M16 7h.01"/><path d="M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20"/><path d="m20 7 2 .5-2 .5"/><path d="M10 18v3"/><path d="M14 17.75V21"/><path d="M7 18a6 6 0 0 0 3.84-10.61"/></g>';
function modeArt(mode) {
  const frame = '<rect class="art-frame" x="1" y="1" width="86" height="54" rx="7"/>'
    + '<path class="art-strip" d="M1 8a7 7 0 0 1 7-7h72a7 7 0 0 1 7 7v4H1z"/>';
  const photo = '<rect class="art-photo" x="5" y="15" width="78" height="36" rx="4"/>';
  const art = {
    every: frame + '<rect class="art-tab active" x="6" y="4" width="16" height="6" rx="2"/>'
      + '<rect class="art-tab" x="25" y="4" width="16" height="6" rx="2"/><rect class="art-tab" x="44" y="4" width="16" height="6" rx="2"/>'
      + photo + BIRD_GLYPH,
    hourly: frame + '<rect class="art-tab active" x="6" y="4" width="16" height="6" rx="2"/><rect class="art-tab" x="25" y="4" width="16" height="6" rx="2"/>'
      + photo + BIRD_GLYPH
      + '<circle class="art-badge" cx="72" cy="40" r="8"/><path class="art-badge-hands" d="M72 35.5V40l3 2"/>',
    button: frame + '<rect class="art-tab active" x="6" y="4" width="16" height="6" rx="2"/>'
      + '<rect class="art-chrome-page" x="5" y="15" width="78" height="36" rx="4"/>'
      + '<rect class="art-line" x="26" y="27" width="36" height="5" rx="2.5"/><rect class="art-line faint" x="30" y="37" width="28" height="3" rx="1.5"/>'
      + '<circle class="art-button" cx="78" cy="7" r="5"/><path class="art-cursor" d="M79 9.5l5.5 2.2-2.4 1 1.6 2.6-1.3.8-1.6-2.6-1.8 1.8z"/>',
  }[mode];
  return trustedHtml(`<svg class="mode-art" viewBox="0 0 88 56" aria-hidden="true">${art}</svg>`);
}

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
    const sidebarHTML = html`
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

          <div class="settings-body settings-grouped">
            <!-- Birds -->
            <section class="settings-group" aria-labelledby="settings-group-birds">
              <h3 class="settings-category-title" id="settings-group-birds" data-i18n="settingsGroupBirds">Birds</h3>
              <div class="settings-card">
                <div class="setting setting-region" data-i18n-title="regionHelpText" title="New tabs show birds from this region.">
                  <div class="setting-inline">
                    <label for="modal-region" class="setting-label-with-icon">
                      <img src="images/svg/location.svg" alt="" width="18" height="18" class="setting-icon">
                      <span data-i18n="birdingRegion">Birding Region</span>
                    </label>
                    <select id="modal-region" aria-describedby="modal-region-status modal-region-help">
                      <option value="WLD" selected data-i18n="regionWorld">World</option>
                    </select>
                  </div>
                  <!-- Status and help share one slot, so loading/failure text never shifts the layout -->
                  <div class="region-message">
                    <p id="modal-region-status" class="help-text region-status" role="status" aria-live="polite" hidden></p>
                    <p id="modal-region-help" class="help-text" data-i18n="regionHelpText">New tabs show birds from this region.</p>
                  </div>
                </div>

                ${CONFIG.FEATURES.birdRotation ? html`
                <div class="setting setting-stack">
                  <span class="setting-label-with-icon" id="bird-rotation-label">
                    <img src="images/svg/refresh.svg" alt="" width="18" height="18" class="setting-icon">
                    <span data-i18n="birdRotationLabel">New bird</span>
                  </span>
                  <div class="segmented" role="radiogroup" aria-labelledby="bird-rotation-label" aria-describedby="modal-bird-rotation-help">
                    <label class="segment"><input type="radio" name="bird-rotation" value="every"><span data-i18n="birdRotationEvery">Every tab</span></label>
                    <label class="segment"><input type="radio" name="bird-rotation" value="hourly"><span data-i18n="birdRotationHourly">Hourly</span></label>
                    <label class="segment"><input type="radio" name="bird-rotation" value="daily"><span data-i18n="birdRotationDaily">Daily</span></label>
                  </div>
                  <p id="modal-bird-rotation-help" class="help-text visually-hidden" data-i18n="birdRotationHelp">The refresh button always brings a new bird.</p>
                </div>` : ''}

                ${CONFIG.FEATURES.quickGuess ? html`
                <div class="setting" data-i18n-title="quickGuessHelp" title="Hide the bird’s name until you click it, so every new tab is a tiny quiz.">
                  <div class="toggle-container">
                    <div class="toggle-text">
                      <span class="setting-label-with-icon">
                        <img src="images/svg/quiz.svg" alt="" width="18" height="18" class="setting-icon">
                        <span data-i18n="quickGuessLabel">Guess the Bird</span>
                      </span>
                      <p class="help-text" id="modal-quick-guess-help" data-i18n="quickGuessShort">Hide the name until you click it</p>
                    </div>
                    <label class="switch">
                      <input type="checkbox" id="modal-quick-guess" aria-describedby="modal-quick-guess-help">
                      <span class="slider round"></span>
                    </label>
                  </div>
                </div>` : ''}
              </div>
            </section>

            ${CONFIG.FEATURES.newTabMode ? html`
            <!-- New tab -->
            <section class="settings-group" aria-labelledby="settings-group-new-tab">
              <h3 class="settings-category-title" id="settings-group-new-tab" data-i18n="settingsCategoryNewTab">New Tab</h3>
              <div class="settings-card">
                <div class="setting setting-stack">
                  <span class="setting-label-with-icon" id="new-tab-mode-label">
                    <img src="images/svg/external-link.svg" alt="" width="18" height="18" class="setting-icon">
                    <span data-i18n="newTabModeLabel">Open BirdTab</span>
                  </span>
                  <div class="mode-cards" role="radiogroup" aria-labelledby="new-tab-mode-label" aria-describedby="modal-new-tab-caption">
                    ${['every', 'hourly', 'button'].map(mode => html`
                    <label class="mode-card">
                      <input type="radio" name="new-tab-mode" value="${mode}">
                      ${modeArt(mode)}
                      <span class="mode-card-name" data-i18n="${{ every: 'newTabModeEvery', hourly: 'newTabModeHourly', button: 'newTabModeButton' }[mode]}"></span>
                    </label>`)}
                  </div>
                  <p id="modal-new-tab-caption" class="help-text mode-caption" aria-live="polite"></p>
                  <div class="pin-row" hidden>
                    <span class="pin-status"><span class="pin-status-dot" aria-hidden="true"></span><span class="pin-status-text"></span></span>
                    <button type="button" class="pin-show-me" data-i18n="pinShowMe">Show me how</button>
                  </div>
                  <p class="keyword-tip" hidden></p>
                </div>

                <div class="setting" data-i18n-title="showChromeTabHelpText" title="Show a shortcut to quickly access the default Chrome new tab page.">
                  <div class="toggle-container">
                    <div class="toggle-text">
                      <span class="setting-label-with-icon">
                        <img src="images/svg/chrome-tab.svg" alt="" width="18" height="18" class="setting-icon">
                        <span data-i18n="showChromeTab">Chrome Tab Shortcut</span>
                      </span>
                      <p class="help-text visually-hidden" id="modal-chrome-tab-help" data-i18n="showChromeTabHelpText">Show a shortcut to quickly access the default Chrome new tab page.</p>
                    </div>
                    <label class="switch">
                      <input type="checkbox" id="modal-chrome-tab" aria-describedby="modal-chrome-tab-help">
                      <span class="slider round"></span>
                    </label>
                  </div>
                </div>
              </div>
            </section>` : ''}

            <!-- Sound -->
            <section class="settings-group" aria-labelledby="settings-group-sound">
              <h3 class="settings-category-title" id="settings-group-sound" data-i18n="settingsGroupSound">Sound</h3>
              <div class="settings-card">
                <div class="setting" data-i18n-title="autoPlayHelpText" title="Automatically play bird calls with each new tab. Quiet hours will override this when active.">
                  <div class="toggle-container">
                    <div class="toggle-text">
                      <span class="setting-label-with-icon">
                        <img src="images/svg/microphone.svg" alt="" width="18" height="18" class="setting-icon">
                        <span data-i18n="autoPlayBirdCalls">Auto-play media</span>
                      </span>
                      <p class="help-text visually-hidden" id="modal-auto-play-help" data-i18n="autoPlayHelpText">Automatically play bird calls with each new tab. Quiet hours will override this when active.</p>
                    </div>
                    <label class="switch">
                      <input type="checkbox" id="modal-auto-play" aria-describedby="modal-auto-play-help">
                      <span class="slider round"></span>
                    </label>
                  </div>
                </div>

                <div class="setting" data-i18n-title="quietHoursHelpText" title="Mute bird songs during specified quiet hours.">
                  <div class="toggle-container">
                    <div class="toggle-text">
                      <span class="setting-label-with-icon">
                        <img src="images/svg/moon.svg" alt="" width="18" height="18" class="setting-icon">
                        <span data-i18n="quietHours">Quiet Hours</span>
                      </span>
                      <p class="help-text" id="modal-quiet-hours-text"></p>
                    </div>
                    <label class="switch">
                      <input type="checkbox" id="modal-quiet-hours" aria-describedby="modal-quiet-hours-text">
                      <span class="slider round"></span>
                    </label>
                  </div>
                </div>
              </div>
            </section>

            <!-- On the page -->
            <section class="settings-group" aria-labelledby="settings-group-page">
              <h3 class="settings-category-title" id="settings-group-page" data-i18n="settingsGroupPage">On the Page</h3>
              <div class="settings-card">
                <div class="setting" data-i18n-title="clockDisplayHelpText" title="Display a large clock in the center of your new tab.">
                  <div class="toggle-container">
                    <div class="toggle-text">
                      <span class="setting-label-with-icon">
                        <img src="images/svg/clock.svg" alt="" width="18" height="18" class="setting-icon">
                        <span data-i18n="clockDisplay">Show Clock</span>
                      </span>
                      <p class="help-text visually-hidden" id="modal-clock-help" data-i18n="clockDisplayHelpText">Display a large clock in the center of your new tab.</p>
                    </div>
                    <label class="switch">
                      <input type="checkbox" id="modal-clock-display" aria-describedby="modal-clock-help">
                      <span class="slider round"></span>
                    </label>
                  </div>
                </div>

                <div class="setting" data-i18n-title="productivityHelpText" title="Enable search box, top sites, and custom shortcuts for enhanced productivity.">
                  <div class="toggle-container">
                    <div class="toggle-text">
                      <span class="setting-label-with-icon">
                        <img src="images/svg/search.svg" alt="" width="18" height="18" class="setting-icon">
                        <span data-i18n="quickAccessFeatures">Quick Access Features</span>
                      </span>
                      <p class="help-text visually-hidden" id="modal-productivity-help" data-i18n="productivityHelpText">Enable search box, top sites, and custom shortcuts for enhanced productivity.</p>
                    </div>
                    <label class="switch">
                      <input type="checkbox" id="modal-enable-productivity" aria-describedby="modal-productivity-help">
                      <span class="slider round"></span>
                    </label>
                  </div>
                </div>

                <div class="setting" data-i18n-title="googleAppsHelpText" title="Show a quick access button to open Google apps like Gmail, Drive, YouTube, and more.">
                  <div class="toggle-container">
                    <div class="toggle-text">
                      <span class="setting-label-with-icon">
                        <img src="images/svg/apps.svg" alt="" width="18" height="18" class="setting-icon">
                        <span data-i18n="googleApps">Google Apps</span>
                      </span>
                      <p class="help-text visually-hidden" id="modal-google-apps-help" data-i18n="googleAppsHelpText">Show a quick access button to open Google apps like Gmail, Drive, YouTube, and more.</p>
                    </div>
                    <label class="switch">
                      <input type="checkbox" id="modal-google-apps" aria-describedby="modal-google-apps-help">
                      <span class="slider round"></span>
                    </label>
                  </div>
                </div>

                ${CONFIG.FEATURES.newTabMode ? '' : html`
                <div class="setting" data-i18n-title="showChromeTabHelpText" title="Show a shortcut to quickly access the default Chrome new tab page.">
                  <div class="toggle-container">
                    <div class="toggle-text">
                      <span class="setting-label-with-icon">
                        <img src="images/svg/external-link.svg" alt="" width="18" height="18" class="setting-icon">
                        <span data-i18n="showChromeTab">Chrome Tab Shortcut</span>
                      </span>
                      <p class="help-text visually-hidden" id="modal-chrome-tab-help" data-i18n="showChromeTabHelpText">Show a shortcut to quickly access the default Chrome new tab page.</p>
                    </div>
                    <label class="switch">
                      <input type="checkbox" id="modal-chrome-tab" aria-describedby="modal-chrome-tab-help">
                      <span class="slider round"></span>
                    </label>
                  </div>
                </div>`}
              </div>
            </section>
          </div>

          <a href="mailto:support@birdtab.app" class="settings-footer feedback-link">
            <img src="images/svg/message.svg" alt="" width="16" height="16" class="feedback-icon">
            <span data-i18n="sendFeedback">Send Feedback</span>
          </a>
          ${process.env.NODE_ENV === 'development' ? html`
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
              margin-top: 0;
              padding: 8px var(--modal-spacing, 16px) 0;
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
              padding-bottom: 16px;
            }
            .debug-buttons-wrapper.expanded > div {
              overflow: visible;
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
                <button id="sidebar-reset-review" class="debug-button">Reset Review Prompt</button>
                <button class="debug-button" data-debug="footer-notice">Show Chrome Footer Tip</button>
                ${CONFIG.FEATURES.newTabMode ? html`
                <button class="debug-button" data-debug="pin-coach-steps">Show Pin Coach</button>
                <button class="debug-button" data-debug="pin-coach-done">Show Pin Coach: Pinned</button>
                <button class="debug-button" data-debug="step-aside-offer">Show “Prefer Chrome’s Page?” Offer</button>
                <button class="debug-button" data-debug="reset-new-tab-mode">Reset Open BirdTab to Every Tab</button>` : ''}
                ${CONFIG.FEATURES.yourBirds ? html`
                <button class="debug-button" data-debug="milestone">Show “Different Birds Seen” Milestone</button>
                <button class="debug-button" data-debug="reset-your-birds">Clear Your Birds (and History)</button>
                <button class="debug-button" data-debug="refill-your-birds">Refill Your Birds from History</button>` : ''}
                ${CONFIG.FEATURES.favorites ? html`
                <button class="debug-button" data-debug="reset-favorites">Reset Favorites</button>` : ''}
                ${CONFIG.FEATURES.birdRotation ? html`
                <button class="debug-button" data-debug="clear-held-bird">Clear Held Bird</button>` : ''}
                <p class="debug-status" id="debug-status" role="status" style="margin: 4px 0 0; font-size: 12px; color: var(--white-60);"></p>
              </div>
            </div>
          </div>
          ` : ''}
        </div>
      </div>
    `;

    // Add sidebar to body
    insertHtml(document.body, 'beforeend', sidebarHTML);

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

    if (!canOpenBrowserNewTab() && this.sidebar) {
      this.sidebar.querySelector('#modal-chrome-tab')?.closest('.setting')?.remove();
    }

    // Localize the newly created sidebar
    localizeHtml();
  }

  initializeElements() {
    // Get all the sidebar form elements
    this.autoPlayCheckbox = document.getElementById('modal-auto-play');
    this.quietHoursCheckbox = document.getElementById('modal-quiet-hours');
    this.clockDisplayCheckbox = document.getElementById('modal-clock-display');
    this.enableProductivityCheckbox = document.getElementById('modal-enable-productivity');
    this.googleAppsCheckbox = document.getElementById('modal-google-apps');
    this.chromeTabCheckbox = document.getElementById('modal-chrome-tab');
    this.newTabModeRadios = [...document.querySelectorAll('input[name="new-tab-mode"]')];
    this.newTabCaption = document.getElementById('modal-new-tab-caption');
    this.pinRow = this.sidebar?.querySelector('.pin-row');
    this.keywordTip = this.sidebar?.querySelector('.keyword-tip');
    this.birdRotationRadios = [...document.querySelectorAll('input[name="bird-rotation"]')];
    this.quickGuessCheckbox = document.getElementById('modal-quick-guess');
    this.quietHoursTextElement = document.getElementById('modal-quiet-hours-text');

    const regionSelect = document.getElementById('modal-region');
    const regionStatus = document.getElementById('modal-region-status');
    this.regionSelector = regionSelect && regionStatus ? new RegionSelector({
      select: regionSelect,
      status: regionStatus,
      onRegionChanged: (region) => {
        this.showSaveNotification();
        updateUserContext({ region });
      }
    }) : null;

    // Update quiet hours text
    if (this.quietHoursTextElement) {
      this.quietHoursTextElement.textContent = getQuietHoursText();
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
    if (this.autoPlayCheckbox) {
      this.autoPlayCheckbox.addEventListener('change', () => this.saveSettings());
    }
    if (this.quietHoursCheckbox) {
      this.quietHoursCheckbox.addEventListener('change', () => this.saveSettings());
    }
    if (this.clockDisplayCheckbox) {
      this.clockDisplayCheckbox.addEventListener('change', () => this.saveSettings());
    }
    if (this.enableProductivityCheckbox) {
      this.enableProductivityCheckbox.addEventListener('change', async (e) => {
        await this.handleProductivityToggle(e.target.checked);
      });
    }
    if (this.googleAppsCheckbox) {
      this.googleAppsCheckbox.addEventListener('change', () => this.saveSettings());
    }
    if (this.chromeTabCheckbox) {
      this.chromeTabCheckbox.addEventListener('change', () => this.saveSettings());
    }
    for (const radio of this.newTabModeRadios) {
      radio.addEventListener('change', async () => {
        if (!radio.checked) return;
        await setNewTabMode(radio.value);
        this.syncNewTabNote();
        this.showSaveNotification();
        // Stepping aside makes the toolbar button the way back: help pin it
        if (radio.value !== 'every') showPinCoach();
      });
    }
    this.sidebar?.querySelector('.pin-show-me')?.addEventListener('click', () => showPinCoach());
    for (const radio of this.birdRotationRadios) {
      radio.addEventListener('change', () => this.saveSettings());
    }
    if (this.quickGuessCheckbox) {
      this.quickGuessCheckbox.addEventListener('change', () => this.saveSettings());
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
              region: CONFIG.STORAGE_DEFAULTS.region,
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

    // Chrome-first features: show each one's states on demand
    const status = document.getElementById('debug-status');
    const done = (text) => { if (status) status.textContent = text; };
    const actions = {
      'footer-notice': async () => {
        await resetChromeFooterNotification();
        this.close();
        showChromeFooterNotification();
      },
      'pin-coach-steps': () => showPinCoach({ preview: 'steps' }),
      'pin-coach-done': () => showPinCoach({ preview: 'done' }),
      'step-aside-offer': async () => {
        await chrome.storage.local.set({ chromeTabUses: 3, stepAsideOfferDismissed: false, newTabMode: 'every' });
        document.getElementById('step-aside-offer')?.remove();
        this.close();
        maybeOfferToStepAside();
      },
      'reset-new-tab-mode': async () => {
        await setNewTabMode('every');
        await chrome.storage.local.remove(['chromeTabUses', 'stepAsideOfferDismissed']);
        this.loadSettings();
        done('Open BirdTab: every tab. Chrome Tab uses and the offer reset.');
      },
      'milestone': () => {
        this.close();
        showSeenMilestone(50, { force: true });
      },
      'reset-your-birds': async () => {
        await clearSeenBirds();
        done('Your Birds and History cleared.');
      },
      'refill-your-birds': async () => {
        await chrome.storage.local.remove(['seenBirdsBackfilled']);
        done('Your Birds refills from History the next time it opens.');
      },
      'reset-favorites': async () => {
        await chrome.storage.sync.set({ favoriteSpecies: [] });
        await chrome.storage.local.remove(['favoriteBirds']);
        document.getElementById('favorite-button')?.setAttribute('aria-pressed', 'false');
        done('Favorites cleared.');
      },
      'clear-held-bird': async () => {
        await chrome.storage.local.remove(['currentBird']);
        done('Held bird cleared: the next new tab shows a new bird.');
      },
    };
    for (const button of this.sidebar.querySelectorAll('[data-debug]')) {
      button.addEventListener('click', () => actions[button.dataset.debug]?.());
    }

    const resetReviewButton = document.getElementById('sidebar-reset-review');
    if (resetReviewButton) {
      resetReviewButton.addEventListener('click', () => {
        chrome.storage.local.set({
          installTime: Date.now() - 2 * 60 * 1000,
          newTabCount: 10,
          lastReviewPrompt: 0,
          reviewDismissed: false,
          reviewLeft: false
        }, () => {
          alert('Review prompt reset. Open a new tab to see it.');
        });
      });
    }

  }

  open() {
    if (!this.sidebar) return;

    this.loadSettings(); // Refresh settings when opening
    // The region list is read (and fetched if missing) only when settings open
    if (this.regionSelector) {
      this.regionSelector.load().catch(error => warn('Region list failed to load: ' + error.message));
    }
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

    chrome.storage.local.get(['autoPlay', 'quietHours', 'clockDisplayMode', 'quickAccessEnabled', 'googleAppsEnabled', 'chromeTabEnabled', 'newTabMode', 'birdRotation', 'quickGuess'], (result) => {
      const newTabMode = result.newTabMode || CONFIG.STORAGE_DEFAULTS.newTabMode;
      this.newTabModeRadios.forEach(r => { r.checked = r.value === newTabMode; });
      this.syncNewTabNote();
      const birdRotation = result.birdRotation || CONFIG.STORAGE_DEFAULTS.birdRotation;
      this.birdRotationRadios.forEach(r => { r.checked = r.value === birdRotation; });
      if (this.quickGuessCheckbox) {
        this.quickGuessCheckbox.checked = result.quickGuess === true;
      }
      if (this.autoPlayCheckbox) {
        this.autoPlayCheckbox.checked = result.autoPlay || false;
      }
      if (this.quietHoursCheckbox) {
        this.quietHoursCheckbox.checked = result.quietHours || false;
      }
      if (this.clockDisplayCheckbox) {
        const clockMode = result.clockDisplayMode !== undefined ? result.clockDisplayMode : 'clock';
        this.clockDisplayCheckbox.checked = (clockMode === 'clock' || clockMode === 'timer');
      }
      if (this.enableProductivityCheckbox) {
        this.enableProductivityCheckbox.checked = result.quickAccessEnabled !== undefined ? result.quickAccessEnabled : true;
      }
      if (this.googleAppsCheckbox) {
        this.googleAppsCheckbox.checked = result.googleAppsEnabled || false;
      }
      if (this.chromeTabCheckbox) {
        this.chromeTabCheckbox.checked = result.chromeTabEnabled !== false;
      }
    });
  }

  saveSettings() {
    if (!chrome?.storage?.local) {
      warn('Chrome storage API not available');
      return;
    }

    // For clock display, we need to check current mode to preserve timer state
    chrome.storage.local.get(['clockDisplayMode'], (currentSettings) => {
      const settings = {};

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
      if (this.googleAppsCheckbox) {
        settings.googleAppsEnabled = this.googleAppsCheckbox.checked;
      }
      if (this.chromeTabCheckbox) {
        settings.chromeTabEnabled = this.chromeTabCheckbox.checked;
      }
      const birdRotation = this.birdRotationRadios.find(r => r.checked);
      if (birdRotation) {
        settings.birdRotation = birdRotation.value;
      }
      if (this.quickGuessCheckbox) {
        settings.quickGuess = this.quickGuessCheckbox.checked;
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

  /**
   * What the chosen "Open BirdTab" mode does, in one line; and for the modes where
   * BirdTab steps aside, whether its toolbar button is pinned (checked every 1.5 s
   * while the sidebar is open, so it changes the moment it's pinned) and the
   * address-bar keyword.
   */
  syncNewTabNote() {
    if (!this.newTabModeRadios.length || !this.newTabCaption) return;
    clearInterval(this.pinPoll);
    this.pinPoll = 0;
    const mode = this.newTabModeRadios.find(r => r.checked)?.value || 'every';
    // Also as a class: :has() needs Chrome 105
    this.newTabModeRadios.forEach(r => r.closest('.mode-card')?.classList.toggle('selected', r.checked));
    const captions = {
      every: ['newTabModeEveryHelp', 'A bird on every new tab.'],
      hourly: ['newTabModeHourlyHelp', 'A bird on your first new tab after an hour away; Chrome’s own page the rest of the time.'],
      button: ['newTabModeButtonHelp', 'Chrome’s own new tab page. Click BirdTab’s toolbar button whenever you want a bird.'],
    };
    const [key, fallback] = captions[mode];
    this.newTabCaption.textContent = getMessage(key) || fallback;

    const stepsAside = mode !== 'every';
    if (this.pinRow) this.pinRow.hidden = !stepsAside;
    if (this.keywordTip) {
      this.keywordTip.hidden = !stepsAside;
      if (stepsAside && !this.keywordTip.childElementCount) {
        // "Or type $1 and a space in the address bar": the keyword as a key cap
        const [before, after = ''] = (chrome.i18n.getMessage('newTabModeKeyword', ['\u2063']) || 'Or type \u2063 and a space in the address bar').split('\u2063');
        const kbd = document.createElement('kbd');
        kbd.textContent = 'bird';
        this.keywordTip.replaceChildren(document.createTextNode(before), kbd, document.createTextNode(after));
      }
    }
    if (!stepsAside || !this.pinRow) return;

    const update = async () => {
      if (!this.isOpen && this.pinPoll) {
        clearInterval(this.pinPoll);
        this.pinPoll = 0;
        return;
      }
      const pinned = await isPinnedToToolbar();
      this.pinRow.classList.toggle('pinned', pinned === true);
      this.pinRow.querySelector('.pin-status-text').textContent = pinned
        ? (getMessage('newTabModePinned') || 'Pinned to your toolbar')
        : (getMessage('newTabModeNotPinned') || 'Not pinned yet');
      this.pinRow.querySelector('.pin-show-me').hidden = pinned === true;
    };
    update();
    this.pinPoll = setInterval(update, 1500);
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
    announce(notification.textContent);

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
