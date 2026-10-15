/**
 * Quick Access Settings Module
 * Saves the quick access (top sites, search, shortcuts) toggle. The topSites
 * permission itself is requested by TopSites when "Show top sites" is turned on.
 */

import { log } from './logger.js';

/**
 * Handle the productivity/quick access toggle
 * Saves the setting without requesting permissions.
 * Permission is now requested when user toggles "Show top sites" ON in the options menu.
 *
 * @param {boolean} isEnabled - Whether the toggle is being enabled
 * @param {Object} options - Configuration options
 * @param {Function} options.onSuccess - Called after settings are saved successfully
 * @param {Function} options.onRevert - Called when toggle should be reverted
 * @param {string} [options.component='unknown'] - Component name for error tracking
 * @returns {Promise<boolean>} - True if the operation succeeded
 */
export async function handleQuickAccessToggle(isEnabled, options = {}) {
  const { onSuccess, onRevert, component = 'unknown' } = options;

  try {
    await chrome.storage.local.set({ quickAccessEnabled: isEnabled });
    if (onSuccess) onSuccess();
    return true;
  } catch (error) {
    log('Error saving quick access setting: ' + error.message);
    if (onRevert) onRevert();
    return false;
  }
}
