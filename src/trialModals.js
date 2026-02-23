/**
 * Trial Modals Component
 * Shows informational modals for trial start and expiration
 */

import { getMessage } from './i18n.js';
import { CONFIG } from './config.js';
import { isTrialActive, getTrialDaysRemaining, isPro, getLicenseStatus } from './licenseManager.js';
import { log } from './logger.js';
import { isTourActive } from './featureTour.js';
import { isUpgradeModalOpen } from './upgradeModal.js';
import { isProWelcomeModalOpen } from './proWelcomeModal.js';
import { trackTrialExpiredModalShown, trackProUpgradeClicked, trackProTrialStarted } from './analytics.js';

// Storage keys for tracking modal display
const TRIAL_WELCOME_SHOWN_KEY = 'trialWelcomeModalShown';
const TRIAL_EXPIRED_SHOWN_KEY = 'trialExpiredModalShown';

// Max wait time for clear screen (in ms)
const MAX_WAIT_TIME = 30000;
// Check interval for clear screen (in ms)
const CHECK_INTERVAL = 500;

// Pricing URL
const PRICING_URL = `${CONFIG.WEBSITE_URL}/pricing`;

// Pro features list for the modals
const PRO_FEATURES = [
  {
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polygon points="23 7 16 12 23 17 23 7"/>
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
    </svg>`,
    title: 'Video Mode',
    description: 'Watch birds come alive with stunning videos'
  },
  {
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>`,
    title: 'High-Res Photos',
    description: 'Crystal clear 2400px images for stunning detail'
  },
  {
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>`,
    title: 'World Regions',
    description: 'Discover birds from any country in the world'
  },
  {
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>`,
    title: 'Clock & Timer',
    description: 'Keep track of time while enjoying nature'
  }
];

let welcomeModalInstance = null;
let expiredModalInstance = null;

/**
 * Check if any blocking UI element is currently visible
 * This includes: feature tour, upgrade modal, review prompt, 
 * chrome footer notification, settings sidebar, and feature spotlights
 */
function isScreenBusy() {
  // Check if feature tour is active
  if (isTourActive()) {
    return true;
  }
  
  // Check if upgrade modal is open
  if (isUpgradeModalOpen()) {
    return true;
  }

  // Check if pro welcome modal is open
  if (isProWelcomeModalOpen()) {
    return true;
  }
  
  // Check if review prompt is showing
  const reviewPrompt = document.getElementById('review-prompt');
  if (reviewPrompt) {
    return true;
  }
  
  // Check if chrome footer notification is visible
  const footerNotification = document.querySelector('.chrome-footer-notification.visible');
  if (footerNotification) {
    return true;
  }
  
  // Check if settings sidebar is open
  const settingsSidebar = document.getElementById('settings-sidebar');
  if (settingsSidebar?.classList.contains('open')) {
    return true;
  }
  
  // Check if feature spotlight is visible
  const featureSpotlight = document.querySelector('.feature-spotlight-overlay');
  if (featureSpotlight) {
    return true;
  }
  
  // Check if onboarding is showing (though we shouldn't get here if it is)
  const onboardingContainer = document.querySelector('.onboarding-container');
  if (onboardingContainer) {
    return true;
  }
  
  return false;
}

/**
 * Wait until the screen is clear of any overlays/modals
 * @param {number} timeout - Maximum time to wait in ms
 * @returns {Promise<boolean>} - True if screen became clear, false if timed out
 */
function waitForClearScreen(timeout = MAX_WAIT_TIME) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    const checkScreen = () => {
      if (!isScreenBusy()) {
        log('Screen is clear for trial modal');
        resolve(true);
        return;
      }
      
      if (Date.now() - startTime > timeout) {
        log('Timed out waiting for clear screen');
        resolve(false);
        return;
      }
      
      // Check again after interval
      setTimeout(checkScreen, CHECK_INTERVAL);
    };
    
    // Start checking
    checkScreen();
  });
}

/**
 * Check and show trial welcome modal if needed
 * Called on page load for fresh installs and updates
 * Waits for screen to be clear of other modals/overlays before showing
 */
export async function checkAndShowTrialWelcome() {
  try {
    // Check if modal was already shown
    const { [TRIAL_WELCOME_SHOWN_KEY]: alreadyShown, trialStartDate } = await new Promise((resolve) => {
      chrome.storage.local.get([TRIAL_WELCOME_SHOWN_KEY, 'trialStartDate'], resolve);
    });

    if (alreadyShown || !trialStartDate) {
      return;
    }

    // Check if user is on active trial
    const trialActive = await isTrialActive();
    if (!trialActive) {
      return;
    }

    // Skip if user has a paid Pro license (upgraded during trial)
    const licenseStatus = await getLicenseStatus();
    if (licenseStatus.status === 'active' && licenseStatus.type && licenseStatus.type !== 'trial') {
      return;
    }

    // Get days remaining
    const daysRemaining = await getTrialDaysRemaining();
    
    // Only show welcome modal if trial just started (within 24 hours)
    const startDate = new Date(trialStartDate);
    const now = new Date();
    const hoursSinceStart = (now - startDate) / (1000 * 60 * 60);
    
    if (hoursSinceStart > 24) {
      // Trial started more than 24 hours ago, don't show welcome
      chrome.storage.local.set({ [TRIAL_WELCOME_SHOWN_KEY]: true });
      return;
    }

    // Wait for screen to be clear before showing
    log('Waiting for clear screen to show trial welcome modal...');
    const screenClear = await waitForClearScreen();
    
    if (!screenClear) {
      log('Could not get clear screen for trial welcome modal, skipping');
      return;
    }

    // Show the welcome modal
    showTrialWelcomeModal(daysRemaining);
    trackProTrialStarted();
    
    // Mark as shown
    chrome.storage.local.set({ [TRIAL_WELCOME_SHOWN_KEY]: true });
    
  } catch (error) {
    log(`Error checking trial welcome modal: ${error.message}`);
  }
}

/**
 * Check and show trial expired modal if needed
 * Called on page load after trial period ends
 * Waits for screen to be clear of other modals/overlays before showing
 */
export async function checkAndShowTrialExpired() {
  try {
    // Check if modal was already shown
    const { [TRIAL_EXPIRED_SHOWN_KEY]: alreadyShown, trialStartDate } = await new Promise((resolve) => {
      chrome.storage.local.get([TRIAL_EXPIRED_SHOWN_KEY, 'trialStartDate'], resolve);
    });

    if (alreadyShown || !trialStartDate) {
      return;
    }

    // Check if trial has actually expired
    const trialActive = await isTrialActive();
    
    // User has paid Pro? Don't show expired modal
    const licenseStatus = await getLicenseStatus();
    if (licenseStatus.status === 'active' && licenseStatus.type !== 'trial') {
      return;
    }

    if (trialActive) {
      // Trial still active, nothing to do
      return;
    }

    // Trial has expired and user hasn't upgraded — show the expired modal.
    // Wait for screen to be clear before showing
    log('Waiting for clear screen to show trial expired modal...');
    const screenClear = await waitForClearScreen();
    
    if (!screenClear) {
      log('Could not get clear screen for trial expired modal, skipping');
      return;
    }
    
    showTrialExpiredModal();
    trackTrialExpiredModalShown();
    
    // Mark as shown
    chrome.storage.local.set({ [TRIAL_EXPIRED_SHOWN_KEY]: true });
    
  } catch (error) {
    log(`Error checking trial expired modal: ${error.message}`);
  }
}

/**
 * Show trial welcome modal
 */
export function showTrialWelcomeModal(daysRemaining = 14) {
  if (welcomeModalInstance) {
    welcomeModalInstance.classList.add('open');
    document.body.style.overflow = 'hidden';
    return;
  }

  const featuresHTML = PRO_FEATURES.map(f => `
    <div class="trial-feature">
      <div class="trial-feature-icon">${f.icon}</div>
      <span class="trial-feature-title">${f.title}</span>
    </div>
  `).join('');

  const modalHTML = `
    <div id="trial-welcome-modal" class="trial-modal" role="dialog" aria-modal="true" aria-labelledby="trial-welcome-title">
      <div class="trial-modal-backdrop"></div>
      <div class="trial-modal-content">
        <button class="trial-modal-close" aria-label="${getMessage('close') || 'Close'}">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>

        <div class="trial-header">
          <div class="trial-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
            </svg>
            <span>Pro Trial Active</span>
          </div>
          <h2 id="trial-welcome-title" class="trial-title">
            Welcome to BirdTab Pro
          </h2>
          <p class="trial-subtitle">
            Your <strong>${daysRemaining}-day free trial</strong> has started. Enjoy all Pro features and discover the full beauty of birds worldwide.
          </p>
        </div>

        <div class="trial-features-grid">
          ${featuresHTML}
        </div>

        <div class="trial-timeline">
          <div class="trial-timeline-bar">
            <div class="trial-timeline-progress" style="width: 0%"></div>
          </div>
          <div class="trial-timeline-labels">
            <span>Today</span>
            <span>${daysRemaining} days remaining</span>
          </div>
        </div>

        <div class="trial-actions">
          <button class="trial-btn-primary" id="trial-welcome-start">
            Start Exploring
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="5" y1="12" x2="19" y2="12"/>
              <polyline points="12 5 19 12 12 19"/>
            </svg>
          </button>
          <a href="${PRICING_URL}" target="_blank" class="trial-btn-secondary">
            Upgrade Now
          </a>
        </div>

        <p class="trial-footer-note">
          No credit card required. After your trial, you'll return to the free version.
        </p>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);
  welcomeModalInstance = document.getElementById('trial-welcome-modal');

  // Bind events
  const closeBtn = welcomeModalInstance.querySelector('.trial-modal-close');
  closeBtn?.addEventListener('click', hideTrialWelcomeModal);

  const backdrop = welcomeModalInstance.querySelector('.trial-modal-backdrop');
  backdrop?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideTrialWelcomeModal();
  });

  const startBtn = welcomeModalInstance.querySelector('#trial-welcome-start');
  startBtn?.addEventListener('click', hideTrialWelcomeModal);

  document.addEventListener('keydown', handleWelcomeEsc);

  // Show modal with animation
  requestAnimationFrame(() => {
    welcomeModalInstance.classList.add('open');
    document.body.style.overflow = 'hidden';
  });
}

function handleWelcomeEsc(e) {
  if (e.key === 'Escape' && welcomeModalInstance?.classList.contains('open')) {
    hideTrialWelcomeModal();
  }
}

/**
 * Hide trial welcome modal
 */
export function hideTrialWelcomeModal() {
  if (!welcomeModalInstance) return;

  welcomeModalInstance.classList.remove('open');
  document.body.style.overflow = '';
  document.removeEventListener('keydown', handleWelcomeEsc);

  setTimeout(() => {
    welcomeModalInstance?.remove();
    welcomeModalInstance = null;
  }, 300);
}

/**
 * Show trial expired modal
 */
export function showTrialExpiredModal() {
  if (expiredModalInstance) {
    expiredModalInstance.classList.add('open');
    document.body.style.overflow = 'hidden';
    return;
  }

  const lostFeaturesHTML = PRO_FEATURES.map(f => `
    <div class="trial-lost-feature">
      <div class="trial-lost-icon">${f.icon}</div>
      <span>${f.title}</span>
    </div>
  `).join('');

  const modalHTML = `
    <div id="trial-expired-modal" class="trial-modal trial-modal-expired" role="dialog" aria-modal="true" aria-labelledby="trial-expired-title">
      <div class="trial-modal-backdrop"></div>
      <div class="trial-modal-content">
        <button class="trial-modal-close" aria-label="${getMessage('close') || 'Close'}">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>

        <div class="trial-header">
          <div class="trial-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            <span>Trial Ended</span>
          </div>
          <h2 id="trial-expired-title" class="trial-title">
            Your Free Trial Has Ended
          </h2>
          <p class="trial-subtitle">
            Thank you for trying BirdTab Pro! You can continue using the core features for free, or upgrade to keep enjoying the full experience.
          </p>
        </div>

        <div class="trial-lost-section">
          <p class="trial-lost-heading">Pro features you'll miss:</p>
          <div class="trial-lost-grid">
            ${lostFeaturesHTML}
          </div>
        </div>

        <div class="trial-value-prop">
          <p>
            <strong>Upgrade to Pro</strong> and support independent development while enjoying all features. Your subscription keeps BirdTab ad-free and constantly improving.
          </p>
        </div>

        <div class="trial-actions">
          <a href="${PRICING_URL}" target="_blank" class="trial-btn-primary">
            Upgrade to Pro
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="5" y1="12" x2="19" y2="12"/>
              <polyline points="12 5 19 12 12 19"/>
            </svg>
          </a>
          <button class="trial-btn-secondary" id="trial-expired-continue">
            Continue with Free
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);
  expiredModalInstance = document.getElementById('trial-expired-modal');

  // Bind events
  const closeBtn = expiredModalInstance.querySelector('.trial-modal-close');
  closeBtn?.addEventListener('click', hideTrialExpiredModal);

  const backdrop = expiredModalInstance.querySelector('.trial-modal-backdrop');
  backdrop?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideTrialExpiredModal();
  });

  const upgradeLink = expiredModalInstance.querySelector('.trial-btn-primary');
  upgradeLink?.addEventListener('click', () => {
    trackProUpgradeClicked('trial_expired_modal');
  });

  const continueBtn = expiredModalInstance.querySelector('#trial-expired-continue');
  continueBtn?.addEventListener('click', hideTrialExpiredModal);

  document.addEventListener('keydown', handleExpiredEsc);

  // Show modal with animation
  requestAnimationFrame(() => {
    expiredModalInstance.classList.add('open');
    document.body.style.overflow = 'hidden';
  });
}

function handleExpiredEsc(e) {
  if (e.key === 'Escape' && expiredModalInstance?.classList.contains('open')) {
    hideTrialExpiredModal();
  }
}

/**
 * Hide trial expired modal
 */
export function hideTrialExpiredModal() {
  if (!expiredModalInstance) return;

  expiredModalInstance.classList.remove('open');
  document.body.style.overflow = '';
  document.removeEventListener('keydown', handleExpiredEsc);

  setTimeout(() => {
    expiredModalInstance?.remove();
    expiredModalInstance = null;
  }, 300);
}

/**
 * Force show trial welcome modal (for debugging)
 */
export function debugShowTrialWelcome(daysRemaining = 14) {
  showTrialWelcomeModal(daysRemaining);
}

/**
 * Force show trial expired modal (for debugging)
 */
export function debugShowTrialExpired() {
  showTrialExpiredModal();
}

export default {
  checkAndShowTrialWelcome,
  checkAndShowTrialExpired,
  showTrialWelcomeModal,
  hideTrialWelcomeModal,
  showTrialExpiredModal,
  hideTrialExpiredModal,
  debugShowTrialWelcome,
  debugShowTrialExpired
};
