/**
 * Chrome Tab Module
 * Manages the Chrome Tab shortcut link visibility and functionality
 */

import { log } from './logger.js';
import { trackFeature } from './analytics.js';

// Module state
let chromeTabLink = null;
let isInitialized = false;

/**
 * Update Chrome tab link visibility based on settings
 * Default is visible (enabled)
 */
export async function updateChromeTabVisibility() {
  if (!chromeTabLink) {
    chromeTabLink = document.getElementById('chrome-tab-link');
  }
  
  if (!chromeTabLink) return;

  const result = await chrome.storage.sync.get(['chromeTabEnabled']);
  // Default is true (visible) - only hide if explicitly set to false
  const isEnabled = result.chromeTabEnabled !== false;

  if (isEnabled) {
    chromeTabLink.classList.remove('hidden');
  } else {
    chromeTabLink.classList.add('hidden');
  }
  
  log(`Chrome Tab visibility updated: ${isEnabled ? 'visible' : 'hidden'}`);
}

/**
 * Handle Chrome tab link click
 * Opens the default Chrome new tab page
 */
function handleChromeTabClick(e) {
  e.preventDefault();
  e.stopPropagation();
  trackFeature('chrome_tab_click');
  chrome.tabs.create({ url: 'chrome://new-tab-page' });
}

/**
 * Setup storage listener for Chrome tab setting changes
 */
function setupStorageListener() {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.chromeTabEnabled) {
      updateChromeTabVisibility();
    }
  });
}

/**
 * Initialize the Chrome Tab functionality
 */
export function initializeChromeTab() {
  if (isInitialized) return;

  chromeTabLink = document.getElementById('chrome-tab-link');
  
  if (!chromeTabLink) {
    log('Chrome Tab link element not found');
    return;
  }

  // Add click handler
  chromeTabLink.addEventListener('click', handleChromeTabClick);

  // Update visibility based on settings
  updateChromeTabVisibility();

  // Setup storage listener
  setupStorageListener();

  isInitialized = true;
  log('Chrome Tab initialized');
}

/**
 * Cleanup the Chrome Tab functionality
 */
export function destroyChromeTab() {
  if (chromeTabLink) {
    chromeTabLink.removeEventListener('click', handleChromeTabClick);
  }
  
  chromeTabLink = null;
  isInitialized = false;
  log('Chrome Tab destroyed');
}
