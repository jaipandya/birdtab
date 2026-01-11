/**
 * Quick Access Permissions Module
 * Handles permission requests for quick access features (top sites, search, shortcuts)
 * Shared between popup.js and settingsModal.js to avoid code duplication
 */

import { log } from './logger.js';
import { getMessage } from './i18n.js';
import { captureException, addBreadcrumb } from './sentry.js';
import { showPermissionDialog } from './permissionDialog.js';

/**
 * Required permissions for quick access features
 */
const QUICK_ACCESS_PERMISSIONS = ['topSites', 'favicon'];

/**
 * Check if quick access permissions are already granted
 * @returns {Promise<boolean>}
 */
export async function hasQuickAccessPermissions() {
  try {
    return await chrome.permissions.contains({
      permissions: QUICK_ACCESS_PERMISSIONS
    });
  } catch (error) {
    log('Error checking permissions: ' + error.message);
    return false;
  }
}

/**
 * Request quick access permissions with user confirmation dialog
 * @param {Object} callbacks - Callback functions for handling results
 * @param {Function} callbacks.onGranted - Called when permissions are granted
 * @param {Function} callbacks.onDenied - Called when user denies permissions
 * @param {Function} callbacks.onCancelled - Called when user cancels the dialog
 * @param {Function} callbacks.onError - Called when an error occurs
 * @param {string} [component='unknown'] - Component name for error tracking
 * @returns {Promise<boolean>} - True if permissions were granted
 */
export async function requestQuickAccessPermissions(callbacks = {}, component = 'unknown') {
  const { onGranted, onDenied, onCancelled, onError } = callbacks;

  try {
    // First check if we already have the required permissions
    const hasPermissions = await hasQuickAccessPermissions();

    if (hasPermissions) {
      // Permissions already granted
      log('Quick access permissions already granted');
      if (onGranted) onGranted();
      return true;
    }

    log('Showing permission dialog before Chrome permission request');
    addBreadcrumb('Permission dialog shown', 'ui', 'info', { component });

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
      // User clicked "Go back"
      log('User cancelled permission dialog');
      addBreadcrumb('Permission dialog cancelled', 'ui', 'info', { component });
      if (onCancelled) onCancelled();
      return false;
    }

    // User clicked "Continue", now request Chrome permissions
    addBreadcrumb('Requesting Chrome permissions', 'ui', 'info', { 
      component, 
      permissions: QUICK_ACCESS_PERMISSIONS 
    });
    
    const granted = await chrome.permissions.request({
      permissions: QUICK_ACCESS_PERMISSIONS
    });

    if (granted) {
      log('Quick access permissions granted');
      addBreadcrumb('Permissions granted', 'ui', 'info', { component });
      if (onGranted) onGranted();
      return true;
    } else {
      log('Quick access permissions denied by user');
      addBreadcrumb('Permissions denied', 'ui', 'warning', { component });
      alert(getMessage('permissionRequired'));
      if (onDenied) onDenied();
      return false;
    }
  } catch (error) {
    log('Error requesting quick access permissions: ' + error.message);
    captureException(error, {
      tags: { operation: 'requestQuickAccessPermissions', component },
      extra: { permissions: QUICK_ACCESS_PERMISSIONS }
    });
    alert(getMessage('somethingWentWrong'));
    if (onError) onError(error);
    return false;
  }
}

/**
 * Handle the productivity/quick access toggle
 * Encapsulates the full flow: check permissions, request if needed, save setting
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

  if (!isEnabled) {
    // Disabling - just save the setting
    // Note: We intentionally keep the permissions so the user doesn't have to re-grant them
    // if they re-enable the feature later. Users can revoke via Chrome's extension settings.
    try {
      await chrome.storage.sync.set({ quickAccessEnabled: false });
      if (onSuccess) onSuccess();
      return true;
    } catch (error) {
      log('Error saving quick access setting: ' + error.message);
      if (onRevert) onRevert();
      return false;
    }
  }

  // Enabling - need to check/request permissions
  const granted = await requestQuickAccessPermissions({
    onGranted: async () => {
      try {
        await chrome.storage.sync.set({ quickAccessEnabled: true });
        if (onSuccess) onSuccess();
      } catch (error) {
        log('Error saving quick access setting: ' + error.message);
        if (onRevert) onRevert();
      }
    },
    onDenied: () => {
      if (onRevert) onRevert();
    },
    onCancelled: () => {
      if (onRevert) onRevert();
    },
    onError: () => {
      if (onRevert) onRevert();
    }
  }, component);

  return granted;
}
