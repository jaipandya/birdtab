/**
 * License Manager Module
 * Handles BirdTab Pro license verification, activation, and feature gating
 * 
 * License priority (checked in order):
 * 1. Paid license active (yearly/lifetime)
 * 2. Paid license in grace period
 * 3. Free trial active (14 days from install/update)
 * 4. Offline grace period (cached verification)
 * 5. Free user
 */

import { CONFIG } from './config.js';
import { log } from './logger.js';

// Pro features list
const PRO_FEATURES = ['videoMode', 'highResImages', 'region', 'clockTimer'];

/**
 * Get stored license data from chrome.storage.local (device-specific)
 */
export async function getLicenseData() {
  return new Promise((resolve) => {
    chrome.storage.local.get([
      'licenseKey',
      'licenseStatus',
      'licenseType',
      'licenseExpiresAt',
      'licenseEmail',
      'licenseInstanceId'
    ], (result) => {
      resolve(result);
    });
  });
}

/**
 * Get license cache from chrome.storage.local
 */
async function getLicenseCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['licenseCache'], (result) => {
      resolve(result.licenseCache || {
        lastVerified: null,
        lastVerifyResponse: null,
        verifyFailCount: 0,
        offlineGraceStart: null
      });
    });
  });
}

/**
 * Save license cache to chrome.storage.local
 */
async function saveLicenseCache(cache) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ licenseCache: cache }, resolve);
  });
}

/**
 * Get trial data from chrome.storage.local
 */
async function getTrialData() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['trialStartDate', 'trialExpired'], (result) => {
      resolve({
        trialStartDate: result.trialStartDate || null,
        trialExpired: result.trialExpired || false
      });
    });
  });
}

/**
 * Check if the free trial is currently active
 * Trial is active if:
 * - trialStartDate exists
 * - trialExpired flag is not set
 * - Current date is within TRIAL_DURATION_DAYS of trialStartDate
 */
export async function isTrialActive() {
  const { trialStartDate, trialExpired } = await getTrialData();

  // No trial started
  if (!trialStartDate) {
    return false;
  }

  // Trial already marked as expired (optimization)
  if (trialExpired) {
    return false;
  }

  const startDate = new Date(trialStartDate);
  const now = new Date();
  const daysSinceStart = (now - startDate) / (1000 * 60 * 60 * 24);

  const isActive = daysSinceStart < CONFIG.LICENSE.TRIAL_DURATION_DAYS;

  // Mark trial as expired to avoid recalculation on subsequent calls
  if (!isActive) {
    chrome.storage.local.set({ trialExpired: true });
  }

  return isActive;
}

/**
 * Get remaining days in the free trial
 * Returns null if no trial or trial expired
 */
export async function getTrialDaysRemaining() {
  const { trialStartDate, trialExpired } = await getTrialData();

  if (!trialStartDate || trialExpired) {
    return null;
  }

  const startDate = new Date(trialStartDate);
  const now = new Date();
  const daysSinceStart = (now - startDate) / (1000 * 60 * 60 * 24);
  const daysRemaining = CONFIG.LICENSE.TRIAL_DURATION_DAYS - daysSinceStart;

  return Math.max(0, Math.ceil(daysRemaining));
}

/**
 * Check if user has Pro access
 * 
 * Priority order:
 * 1. Paid license active (yearly/lifetime) → true
 * 2. Paid license in grace period → true
 * 3. Free trial active (14 days) → true
 * 4. Offline grace period → true
 * 5. Otherwise → false
 */
export async function isPro() {
  const licenseData = await getLicenseData();
  const { licenseStatus, licenseType, licenseExpiresAt } = licenseData;

  // 1. Check for active paid license
  // If status is 'active', verify that the license has been verified recently enough.
  // When a user goes offline, verifyLicense() doesn't change licenseStatus in storage,
  // so we must cross-check with the cache to enforce the offline grace period.
  if (licenseStatus === 'active') {
    const cache = await getLicenseCache();
    if (cache.lastVerified) {
      const lastVerified = new Date(cache.lastVerified);
      const now = new Date();
      const hoursSinceVerify = (now - lastVerified) / (1000 * 60 * 60);

      // If last verification is within the offline grace window, grant Pro
      if (hoursSinceVerify < CONFIG.LICENSE.OFFLINE_GRACE_HOURS) {
        return true;
      }
      // If verification is stale BUT we have a prior valid response, deny Pro
      // (the user needs to re-verify online)
      if (cache.lastVerifyResponse?.valid) {
        return false;
      }
    }
    // No cache data yet (fresh activation) — trust the stored status
    return true;
  }

  // 2. Check grace period for paid subscriptions (subscription expired but within grace window)
  if (licenseStatus === 'grace') {
    if (licenseExpiresAt) {
      const expiryDate = new Date(licenseExpiresAt);
      const now = new Date();

      // For subscription grace, add 7 days to expiry
      const gracePeriodEnd = new Date(expiryDate);
      gracePeriodEnd.setDate(gracePeriodEnd.getDate() + CONFIG.LICENSE.SUBSCRIPTION_GRACE_DAYS);
      return now < gracePeriodEnd;
    }
  }

  // 3. Check free trial (14 days from install/update)
  if (await isTrialActive()) {
    return true;
  }

  // 4. No Pro access
  return false;
}

/**
 * Check if a specific Pro feature is available
 */
export async function isFeatureAvailable(feature) {
  if (!PRO_FEATURES.includes(feature)) {
    // Not a Pro feature, always available
    return true;
  }

  return await isPro();
}

/**
 * Activate a license key
 * @param {string} licenseKey - The license key to activate
 * @returns {Promise<{success: boolean, error?: string, data?: object}>}
 */
export async function activateLicense(licenseKey) {
  if (!licenseKey || typeof licenseKey !== 'string') {
    return { success: false, error: 'Invalid license key' };
  }

  // Clean up the license key
  const cleanKey = licenseKey.trim();

  // Validate format
  const uuidPattern = /^[A-Za-z0-9]{8}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{12}$/;
  if (!uuidPattern.test(cleanKey)) {
    return { success: false, error: 'Invalid license key format' };
  }

  try {
    const { licenseInstanceId: storedInstanceId } = await new Promise((resolve) => {
      chrome.storage.local.get(['licenseInstanceId'], resolve);
    });

    const response = await fetch(`${CONFIG.API_SERVER_URL}/license/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        licenseKey: cleanKey,
        instanceName: `BirdTab - ${navigator.platform || 'Chrome'}`,
        ...(storedInstanceId && { instanceId: storedInstanceId }),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      log(`License activation failed: ${data.error || 'Unknown error'}`);
      return {
        success: false,
        error: data.error || data.message || 'License activation failed',
      };
    }

    if (!data.valid) {
      return {
        success: false,
        error: data.error || 'Invalid license key',
      };
    }

    // Store license data in chrome.storage.local (device-specific)
    await new Promise((resolve) => {
      chrome.storage.local.set({
        licenseKey: data.maskedKey || cleanKey.slice(0, 4) + '...' + cleanKey.slice(-4),
        licenseStatus: data.status,
        licenseType: data.type,
        licenseExpiresAt: data.expiresAt,
        licenseEmail: data.email,
        ...(data.instanceId && { licenseInstanceId: data.instanceId }),
        proWelcomeShown: false,
      }, resolve);
    });

    // Update license cache
    const cache = await getLicenseCache();
    await saveLicenseCache({
      ...cache,
      lastVerified: new Date().toISOString(),
      lastVerifyResponse: data,
      verifyFailCount: 0,
      offlineGraceStart: null,
    });

    // Store the full license key securely in local storage (not synced)
    await new Promise((resolve) => {
      chrome.storage.local.set({ fullLicenseKey: cleanKey }, resolve);
    });

    log('License activated successfully');
    return {
      success: true,
      data: {
        status: data.status,
        type: data.type,
        expiresAt: data.expiresAt,
        email: data.email,
      },
    };

  } catch (error) {
    log(`License activation error: ${error.message}`);
    return {
      success: false,
      error: 'Network error. Please check your connection and try again.',
    };
  }
}

/**
 * Reset Pro feature settings to their free-tier defaults.
 * Called when user loses Pro access (license expiry, trial end, etc.)
 * This ensures no Pro features remain active and no wasteful requests are made.
 * Settings are only reset if they are currently set to Pro values.
 */
export async function resetProFeatureSettings() {
  const proSettings = await new Promise((resolve) => {
    chrome.storage.local.get(['videoMode', 'highResImages', 'region', 'clockDisplayMode'], resolve);
  });

  const resets = {};

  // Video mode: reset to false
  if (proSettings.videoMode) {
    resets.videoMode = false;
  }

  // High-res images: reset to false
  if (proSettings.highResImages) {
    resets.highResImages = false;
  }

  // Region: reset to US if non-US
  if (proSettings.region && proSettings.region !== 'US') {
    resets.region = 'US';
  }

  // Clock/Timer: reset to off if enabled
  if (proSettings.clockDisplayMode && proSettings.clockDisplayMode !== 'off') {
    resets.clockDisplayMode = 'off';
  }

  if (Object.keys(resets).length > 0) {
    await new Promise((resolve) => {
      chrome.storage.local.set(resets, resolve);
    });

    log(`Pro feature settings reset: ${Object.keys(resets).join(', ')}`);
  }
}

/**
 * Verify current license (called periodically)
 * @returns {Promise<{valid: boolean, status: string}>}
 */
export async function verifyLicense() {
  // Get the full license key from local storage
  const { fullLicenseKey } = await new Promise((resolve) => {
    chrome.storage.local.get(['fullLicenseKey'], resolve);
  });

  if (!fullLicenseKey) {
    log('No license key to verify');
    return { valid: false, status: 'free' };
  }

  // Get previous status to detect transitions
  const { licenseStatus: previousStatus } = await new Promise((resolve) => {
    chrome.storage.local.get(['licenseStatus'], resolve);
  });

  const cache = await getLicenseCache();

  try {
    const response = await fetch(
      `${CONFIG.API_SERVER_URL}/license/status`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: fullLicenseKey }),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    // Update cache on successful verification
    await saveLicenseCache({
      lastVerified: new Date().toISOString(),
      lastVerifyResponse: data,
      verifyFailCount: 0,
      offlineGraceStart: null,
    });

    // Update license status in local storage
    await new Promise((resolve) => {
      chrome.storage.local.set({
        licenseStatus: data.status,
        licenseType: data.type,
      }, resolve);
    });

    // Detect transition from Pro to non-Pro and reset feature settings
    const wasProStatus = ['active', 'grace'].includes(previousStatus);
    const isProStatus = ['active', 'grace'].includes(data.status);

    if (wasProStatus && !isProStatus) {
      log(`License transitioned from ${previousStatus} to ${data.status}, resetting Pro features`);
      await resetProFeatureSettings();
    }

    log(`License verified: status=${data.status}, type=${data.type}`);
    return { valid: data.valid, status: data.status };

  } catch (error) {
    log(`License verification failed: ${error.message}`);

    // Increment fail count
    const newFailCount = (cache.verifyFailCount || 0) + 1;

    // Start offline grace if this is the first failure
    const offlineGraceStart = cache.offlineGraceStart || new Date().toISOString();

    await saveLicenseCache({
      ...cache,
      verifyFailCount: newFailCount,
      offlineGraceStart,
    });

    // Check if we're still within offline grace period
    if (cache.lastVerifyResponse?.valid) {
      const graceStart = new Date(offlineGraceStart);
      const now = new Date();
      const hoursSinceGraceStart = (now - graceStart) / (1000 * 60 * 60);

      if (hoursSinceGraceStart < CONFIG.LICENSE.OFFLINE_GRACE_HOURS) {
        log(`Within offline grace period (${Math.round(hoursSinceGraceStart)}h of ${CONFIG.LICENSE.OFFLINE_GRACE_HOURS}h)`);
        return { valid: true, status: cache.lastVerifyResponse.status };
      }
    }

    // Offline grace expired, mark as requiring verification
    return { valid: false, status: 'offline' };
  }
}

/**
 * Deactivate license (log out)
 */
export async function deactivateLicense() {
  // Read keys before clearing so we can notify the backend
  const { fullLicenseKey, licenseInstanceId } = await new Promise((resolve) => {
    chrome.storage.local.get(['fullLicenseKey', 'licenseInstanceId'], resolve);
  });

  // Notify backend to deactivate instance in LemonSqueezy.
  // Must be awaited — caller does window.location.reload() immediately after,
  // which would cancel an in-flight fire-and-forget fetch before it completes.
  if (fullLicenseKey && licenseInstanceId) {
    try {
      await fetch(`${CONFIG.API_SERVER_URL}/license/deactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: fullLicenseKey, instanceId: licenseInstanceId }),
      });
    } catch (err) {
      log(`Deactivation request failed (non-critical): ${err.message}`);
    }
  }

  // Clear local storage license data
  await new Promise((resolve) => {
    chrome.storage.local.set({
      licenseKey: null,
      licenseStatus: 'free',
      licenseType: null,
      licenseExpiresAt: null,
      licenseEmail: null,
    }, resolve);
  });

  // Clear local storage
  await new Promise((resolve) => {
    chrome.storage.local.remove(['fullLicenseKey', 'licenseCache', 'licenseInstanceId'], resolve);
  });

  // Reset Pro feature settings to free defaults
  await resetProFeatureSettings();

  log('License deactivated');
  return { success: true };
}

/**
 * Open Lemon Squeezy Customer Portal for subscription management
 * Opens the unsigned portal URL where users authenticate via email magic link.
 * This is more secure than pre-authenticated URLs since it requires email access.
 * The portal allows users to renew, update payment, view invoices, etc.
 *
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function openCustomerPortal() {
  // Get license email from storage to pre-fill the login form
  const { licenseEmail } = await getLicenseData();

  // LemonSqueezy's unsigned customer portal URL
  // Users will receive a magic link via email to authenticate
  const LEMONSQUEEZY_PORTAL_URL = 'https://birdtab.lemonsqueezy.com/billing';

  try {
    // Construct portal URL with pre-filled email if available
    let portalUrl = LEMONSQUEEZY_PORTAL_URL;
    if (licenseEmail) {
      portalUrl += `?email=${encodeURIComponent(licenseEmail)}`;
      log('Opening customer portal with pre-filled email');
    } else {
      log('Opening customer portal (email not available for pre-fill)');
    }

    // Open portal in new tab
    // User will enter their email (or it will be pre-filled)
    // LemonSqueezy will send them a magic link to authenticate
    chrome.tabs.create({ url: portalUrl });
    log('Customer portal opened successfully');
    return { success: true };

  } catch (error) {
    log(`Customer portal error: ${error.message}`);
    return {
      success: false,
      error: 'Unable to open customer portal. Please try again.',
    };
  }
}

/**
 * Get license status information for display
 * Includes both paid license and trial information
 */
export async function getLicenseStatus() {
  const licenseData = await getLicenseData();
  const hasPro = await isPro();
  const trialActive = await isTrialActive();
  const trialDaysRemaining = await getTrialDaysRemaining();

  // Determine the effective status for UI
  let effectiveStatus = licenseData.licenseStatus || 'free';
  let effectiveType = licenseData.licenseType;

  // If user has Pro via trial (not paid license), reflect that
  if (hasPro && trialActive && effectiveStatus === 'free') {
    effectiveStatus = 'trial';
    effectiveType = 'trial';
  }

  // Detect offline grace expired: user has a paid license stored but isPro is false
  // because offline verification grace period (72h) has elapsed.
  // This is distinct from a truly expired subscription — the license may still be valid,
  // the user just needs to go online to re-verify.
  let isOfflineGraceExpired = false;
  if (!hasPro && licenseData.licenseKey && licenseData.licenseStatus === 'active') {
    const cache = await getLicenseCache();
    if (cache.lastVerified && cache.lastVerifyResponse?.valid) {
      const lastVerified = new Date(cache.lastVerified);
      const now = new Date();
      const hoursSinceVerify = (now - lastVerified) / (1000 * 60 * 60);
      if (hoursSinceVerify >= CONFIG.LICENSE.OFFLINE_GRACE_HOURS) {
        isOfflineGraceExpired = true;
      }
    }
  }

  return {
    isPro: hasPro,
    status: effectiveStatus,
    type: effectiveType,
    expiresAt: licenseData.licenseExpiresAt,
    email: licenseData.licenseEmail,
    maskedKey: licenseData.licenseKey,
    // Trial-specific fields
    isTrialActive: trialActive,
    trialDaysRemaining: trialDaysRemaining,
    // Offline grace expired - needs re-verification
    isOfflineGraceExpired: isOfflineGraceExpired,
  };
}

/**
 * Calculate days remaining for subscription
 */
export function getDaysRemaining(expiresAt) {
  if (!expiresAt) return null;

  const now = new Date();
  const expiry = new Date(expiresAt);
  const diffMs = expiry - now;
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  return Math.max(0, diffDays);
}

/**
 * Check if license needs verification based on type
 */
export async function needsVerification() {
  const licenseData = await getLicenseData();
  const cache = await getLicenseCache();

  if (!cache.lastVerified) {
    return true;
  }

  const lastVerified = new Date(cache.lastVerified);
  const now = new Date();
  const hoursSinceVerify = (now - lastVerified) / (1000 * 60 * 60);

  // Different intervals based on license type
  if (licenseData.licenseStatus === 'grace') {
    // Grace period: verify every 24 hours
    return hoursSinceVerify > 24;
  } else if (licenseData.licenseType === 'lifetime') {
    // Lifetime: verify every 7 days
    return hoursSinceVerify > 7 * 24;
  } else {
    // Subscription: verify every 7 days (same as lifetime)
    return hoursSinceVerify > 7 * 24;
  }
}
