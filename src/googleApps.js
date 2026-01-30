/**
 * Google Apps Module
 * Displays a grid of Google app shortcuts in a slide-in panel
 */

import { localizeHtml } from './i18n.js';
import { log } from './logger.js';

// Google Apps data organized in two sections
const GOOGLE_APPS = {
  primary: [
    { id: 'account', name: 'Account', url: 'https://myaccount.google.com', domain: 'myaccount.google.com' },
    { id: 'drive', name: 'Drive', url: 'https://drive.google.com', domain: 'drive.google.com' },
    { id: 'business', name: 'Business Profile', url: 'https://business.google.com', domain: 'business.google.com' },
    { id: 'gmail', name: 'Gmail', url: 'https://mail.google.com', domain: 'mail.google.com' },
    { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com', domain: 'youtube.com' },
    { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com', domain: 'gemini.google.com' },
    { id: 'maps', name: 'Maps', url: 'https://maps.google.com', domain: 'maps.google.com' },
    { id: 'search', name: 'Search', url: 'https://www.google.com', domain: 'google.com' },
    { id: 'calendar', name: 'Calendar', url: 'https://calendar.google.com', domain: 'calendar.google.com' },
    { id: 'news', name: 'News', url: 'https://news.google.com', domain: 'news.google.com' },
    { id: 'meet', name: 'Meet', url: 'https://meet.google.com', domain: 'meet.google.com' },
    { id: 'photos', name: 'Photos', url: 'https://photos.google.com', domain: 'photos.google.com' },
    { id: 'translate', name: 'Translate', url: 'https://translate.google.com', domain: 'translate.google.com' },
    { id: 'vids', name: 'Vids', url: 'https://vids.google.com', domain: 'vids.google.com' },
    { id: 'sheets', name: 'Sheets', url: 'https://sheets.google.com', domain: 'sheets.google.com' },
    { id: 'docs', name: 'Docs', url: 'https://docs.google.com', domain: 'docs.google.com' },
    { id: 'slides', name: 'Slides', url: 'https://slides.google.com', domain: 'slides.google.com' },
    { id: 'one', name: 'Google One', url: 'https://one.google.com', domain: 'one.google.com' }
  ],
  secondary: [
    { id: 'shopping', name: 'Shopping', url: 'https://shopping.google.com', domain: 'shopping.google.com' },
    { id: 'store', name: 'Store', url: 'https://store.google.com', domain: 'store.google.com' },
    { id: 'play', name: 'Play', url: 'https://play.google.com', domain: 'play.google.com' },
    { id: 'finance', name: 'Finance', url: 'https://finance.google.com', domain: 'finance.google.com' },
    { id: 'keep', name: 'Keep', url: 'https://keep.google.com', domain: 'keep.google.com' },
    { id: 'adcenter', name: 'My Ad Center', url: 'https://myadcenter.google.com', domain: 'myadcenter.google.com' },
    { id: 'classroom', name: 'Classroom', url: 'https://classroom.google.com', domain: 'classroom.google.com' },
    { id: 'chat', name: 'Chat', url: 'https://chat.google.com', domain: 'chat.google.com' },
    { id: 'earth', name: 'Earth', url: 'https://earth.google.com', domain: 'earth.google.com' },
    { id: 'saved', name: 'Saved', url: 'https://www.google.com/saved', domain: 'google.com' },
    { id: 'artsculture', name: 'Arts & Culture', url: 'https://artsandculture.google.com', domain: 'artsandculture.google.com' },
    { id: 'ads', name: 'Google Ads', url: 'https://ads.google.com', domain: 'ads.google.com' },
    { id: 'merchant', name: 'Merchant Center', url: 'https://merchants.google.com', domain: 'merchants.google.com' },
    { id: 'contacts', name: 'Contacts', url: 'https://contacts.google.com', domain: 'contacts.google.com' },
    { id: 'travel', name: 'Travel', url: 'https://travel.google.com', domain: 'travel.google.com' },
    { id: 'forms', name: 'Forms', url: 'https://docs.google.com/forms', domain: 'docs.google.com' },
    { id: 'books', name: 'Books', url: 'https://books.google.com', domain: 'books.google.com' },
    { id: 'webstore', name: 'Chrome Web Store', url: 'https://chromewebstore.google.com', domain: 'chromewebstore.google.com' },
    { id: 'passwords', name: 'Password Manager', url: 'https://passwords.google.com', domain: 'passwords.google.com' },
    { id: 'analytics', name: 'Google Analytics', url: 'https://analytics.google.com', domain: 'analytics.google.com' },
    { id: 'blogger', name: 'Blogger', url: 'https://www.blogger.com', domain: 'blogger.com' },
    { id: 'youtubemusic', name: 'YouTube Music', url: 'https://music.youtube.com', domain: 'music.youtube.com' },
    { id: 'wallet', name: 'Wallet', url: 'https://wallet.google.com', domain: 'wallet.google.com' },
    { id: 'notebooklm', name: 'NotebookLM', url: 'https://notebooklm.google.com', domain: 'notebooklm.google.com' },
    { id: 'tasks', name: 'Tasks', url: 'https://tasks.google.com', domain: 'tasks.google.com' }
  ]
};

// Module state
let panel = null;
let isOpen = false;
let triggerButton = null;

// Apps that have local SVG icons - all 43 apps covered
const LOCAL_ICONS = {
  // Primary apps
  'account': 'images/google-apps/account.svg',
  'drive': 'images/google-apps/drive.svg',
  'business': 'images/google-apps/business.svg',
  'gmail': 'images/google-apps/gmail.svg',
  'youtube': 'images/google-apps/youtube.svg',
  'gemini': 'images/google-apps/gemini.svg',
  'maps': 'images/google-apps/maps.svg',
  'search': 'images/google-apps/google.svg',
  'calendar': 'images/google-apps/calendar.svg',
  'news': 'images/google-apps/news.svg',
  'meet': 'images/google-apps/meet.svg',
  'photos': 'images/google-apps/photos.svg',
  'translate': 'images/google-apps/translate.svg',
  'vids': 'images/google-apps/vids.svg',
  'sheets': 'images/google-apps/sheets.svg',
  'docs': 'images/google-apps/docs.svg',
  'slides': 'images/google-apps/slides.svg',
  'one': 'images/google-apps/one.svg',
  // Secondary apps
  'shopping': 'images/google-apps/shopping.svg',
  'store': 'images/google-apps/store.svg',
  'play': 'images/google-apps/play.svg',
  'finance': 'images/google-apps/finance.svg',
  'keep': 'images/google-apps/keep.svg',
  'adcenter': 'images/google-apps/adcenter.svg',
  'classroom': 'images/google-apps/classroom.svg',
  'chat': 'images/google-apps/chat.svg',
  'earth': 'images/google-apps/earth.svg',
  'saved': 'images/google-apps/saved.svg',
  'artsculture': 'images/google-apps/artsculture.svg',
  'ads': 'images/google-apps/ads.svg',
  'merchant': 'images/google-apps/merchant.svg',
  'contacts': 'images/google-apps/contacts.svg',
  'travel': 'images/google-apps/travel.svg',
  'forms': 'images/google-apps/forms.svg',
  'books': 'images/google-apps/books.svg',
  'webstore': 'images/google-apps/chrome.svg',
  'passwords': 'images/google-apps/passwords.svg',
  'analytics': 'images/google-apps/analytics.svg',
  'blogger': 'images/google-apps/blogger.svg',
  'youtubemusic': 'images/google-apps/youtubemusic.svg',
  'wallet': 'images/google-apps/wallet.svg',
  'notebooklm': 'images/google-apps/notebooklm.svg',
  'tasks': 'images/google-apps/tasks.svg'
};

/**
 * Get icon URL for a Google app - uses local SVG if available, otherwise favicon service
 * @param {string} appId - App identifier
 * @param {string} domain - Domain for fallback favicon
 * @returns {string} Icon URL
 */
function getIconUrl(appId, domain) {
  if (LOCAL_ICONS[appId]) {
    return LOCAL_ICONS[appId];
  }
  // Fallback to Google's favicon service
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

/**
 * Create the Google Apps panel HTML
 * @returns {string} HTML string for the panel
 */
function createPanelHTML() {
  const createAppItem = (app) => `
    <a href="${app.url}" target="_blank" rel="noopener noreferrer" class="google-app-item" title="${app.name}">
      <div class="google-app-icon-wrapper">
        <img src="${getIconUrl(app.id, app.domain)}" alt="" class="google-app-icon" loading="lazy">
      </div>
      <span class="google-app-name">${app.name}</span>
    </a>
  `;

  const primaryApps = GOOGLE_APPS.primary.map(createAppItem).join('');
  const secondaryApps = GOOGLE_APPS.secondary.map(createAppItem).join('');

  return `
    <div id="google-apps-panel" class="settings-sidebar" role="dialog" aria-modal="true" aria-labelledby="google-apps-title">
      <div class="settings-content google-apps-content">
        <div class="settings-header">
          <h2 id="google-apps-title" data-i18n="googleAppsTitle">Google Apps</h2>
          <button id="close-google-apps" class="close-button" data-i18n-aria-label="closeGoogleApps" aria-label="Close Google Apps">
            <img src="images/svg/close.svg" alt="Close" width="20" height="20">
          </button>
        </div>
        <div class="settings-body">
          <div class="google-apps-grid">
            ${primaryApps}
          </div>
          <div class="google-apps-divider"></div>
          <div class="google-apps-grid">
            ${secondaryApps}
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Create the trigger button HTML (Google Apps grid icon)
 * @returns {string} SVG icon for the trigger button
 */
function getTriggerIconSvg() {
  return `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <circle cx="5" cy="5" r="2.5"/>
      <circle cx="12" cy="5" r="2.5"/>
      <circle cx="19" cy="5" r="2.5"/>
      <circle cx="5" cy="12" r="2.5"/>
      <circle cx="12" cy="12" r="2.5"/>
      <circle cx="19" cy="12" r="2.5"/>
      <circle cx="5" cy="19" r="2.5"/>
      <circle cx="12" cy="19" r="2.5"/>
      <circle cx="19" cy="19" r="2.5"/>
    </svg>
  `;
}

/**
 * Open the Google Apps panel
 */
export function openGoogleApps() {
  if (isOpen) return;

  if (!panel) {
    document.body.insertAdjacentHTML('beforeend', createPanelHTML());
    panel = document.getElementById('google-apps-panel');
    localizeHtml();
    bindPanelEvents();
    // Force reflow to ensure initial state is rendered before animation
    panel.offsetHeight;
  }

  isOpen = true;
  panel.classList.add('open');
  document.body.style.overflow = 'hidden';
  log('Google Apps panel opened');
}

/**
 * Close the Google Apps panel
 */
export function closeGoogleApps() {
  if (!isOpen || !panel) return;

  isOpen = false;
  panel.classList.remove('open');
  document.body.style.overflow = '';
  log('Google Apps panel closed');
}

/**
 * Toggle the Google Apps panel
 */
export function toggleGoogleApps() {
  if (isOpen) {
    closeGoogleApps();
  } else {
    openGoogleApps();
  }
}

/**
 * Bind event listeners to the panel
 */
function bindPanelEvents() {
  const closeBtn = document.getElementById('close-google-apps');

  // Close button
  if (closeBtn) {
    closeBtn.addEventListener('click', closeGoogleApps);
  }

  // Click outside to close
  panel.addEventListener('click', (e) => {
    if (e.target === panel) {
      closeGoogleApps();
    }
  });

  // ESC key to close
  document.addEventListener('keydown', handleEscapeKey);
}

/**
 * Handle escape key press
 * @param {KeyboardEvent} e - Keyboard event
 */
function handleEscapeKey(e) {
  if (e.key === 'Escape' && isOpen) {
    closeGoogleApps();
  }
}

/**
 * Create and insert the Google Apps trigger button
 */
function createTriggerButton() {
  // Check if button already exists
  if (document.getElementById('google-apps-trigger')) {
    triggerButton = document.getElementById('google-apps-trigger');
    return;
  }

  // Create the trigger button
  triggerButton = document.createElement('button');
  triggerButton.id = 'google-apps-trigger';
  triggerButton.className = 'google-apps-trigger hidden';
  triggerButton.setAttribute('aria-label', chrome.i18n.getMessage('googleAppsTriggerAriaLabel') || 'Open Google Apps');
  triggerButton.setAttribute('title', chrome.i18n.getMessage('googleAppsTriggerTooltip') || 'Google Apps');
  triggerButton.innerHTML = getTriggerIconSvg();

  // Add click handler
  triggerButton.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleGoogleApps();
  });

  // Insert button right before the Chrome tab link (top right area)
  const chromeTabLink = document.getElementById('chrome-tab-link');
  if (chromeTabLink && chromeTabLink.parentNode) {
    chromeTabLink.parentNode.insertBefore(triggerButton, chromeTabLink);
  } else {
    // Fallback: append to body
    document.body.appendChild(triggerButton);
  }
}

/**
 * Show the trigger button
 */
function showTriggerButton() {
  if (triggerButton) {
    triggerButton.classList.remove('hidden');
    document.body.classList.add('google-apps-enabled');
  }
}

/**
 * Hide the trigger button
 */
function hideTriggerButton() {
  if (triggerButton) {
    triggerButton.classList.add('hidden');
    document.body.classList.remove('google-apps-enabled');
  }
}

/**
 * Update visibility based on settings
 */
async function updateVisibility() {
  const result = await chrome.storage.sync.get(['googleAppsEnabled']);
  const isEnabled = result.googleAppsEnabled || false;

  if (isEnabled) {
    if (!triggerButton) {
      createTriggerButton();
    }
    showTriggerButton();
  } else {
    hideTriggerButton();
    closeGoogleApps();
  }
}

/**
 * Initialize the Google Apps feature
 */
export async function initializeGoogleApps() {
  // Create trigger button
  createTriggerButton();

  // Update visibility based on settings
  await updateVisibility();

  // Listen for storage changes
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.googleAppsEnabled) {
      updateVisibility();
    }
  });

  log('Google Apps initialized');
}

/**
 * Check if Google Apps panel is open
 * @returns {boolean} Whether the panel is open
 */
export function isGoogleAppsOpen() {
  return isOpen;
}

/**
 * Cleanup the Google Apps feature
 */
export function destroyGoogleApps() {
  // Remove event listener
  document.removeEventListener('keydown', handleEscapeKey);

  // Remove panel
  if (panel) {
    panel.remove();
    panel = null;
  }

  // Remove trigger button
  if (triggerButton) {
    triggerButton.remove();
    triggerButton = null;
  }

  isOpen = false;
  log('Google Apps destroyed');
}
