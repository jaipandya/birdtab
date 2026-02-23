/**
 * Pro Welcome Modal Component
 * One-time celebratory welcome shown after a user activates their Pro license.
 * Distinct from the trial welcome modal – this is for paid subscribers only.
 */

import { getMessage } from './i18n.js';
import { isPro, getLicenseStatus } from './licenseManager.js';
import { log } from './logger.js';
import { isTourActive } from './featureTour.js';
import { isUpgradeModalOpen } from './upgradeModal.js';

const PRO_WELCOME_SHOWN_KEY = 'proWelcomeShown';

const MAX_WAIT_TIME = 30000;
const CHECK_INTERVAL = 500;

const PRO_FEATURES = [
  {
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polygon points="23 7 16 12 23 17 23 7"/>
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
    </svg>`,
    titleKey: 'proWelcomeVideoTitle',
    descKey: 'proWelcomeVideoDesc'
  },
  {
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>`,
    titleKey: 'proWelcomeHighResTitle',
    descKey: 'proWelcomeHighResDesc'
  },
  {
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>`,
    titleKey: 'proWelcomeRegionTitle',
    descKey: 'proWelcomeRegionDesc'
  },
  {
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>`,
    titleKey: 'proWelcomeClockTitle',
    descKey: 'proWelcomeClockDesc'
  }
];

let modalInstance = null;

/**
 * Check if any blocking UI element is currently visible
 */
function isScreenBusy() {
  if (isTourActive()) return true;
  if (isUpgradeModalOpen()) return true;

  const reviewPrompt = document.getElementById('review-prompt');
  if (reviewPrompt) return true;

  const footerNotification = document.querySelector('.chrome-footer-notification.visible');
  if (footerNotification) return true;

  const settingsSidebar = document.getElementById('settings-sidebar');
  if (settingsSidebar?.classList.contains('open')) return true;

  const featureSpotlight = document.querySelector('.feature-spotlight-overlay');
  if (featureSpotlight) return true;

  const trialModal = document.querySelector('.trial-modal.open');
  if (trialModal) return true;

  return false;
}

/**
 * Wait until the screen is clear of overlays
 */
function waitForClearScreen(timeout = MAX_WAIT_TIME) {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const checkScreen = () => {
      if (!isScreenBusy()) {
        log('Screen is clear for pro welcome modal');
        resolve(true);
        return;
      }

      if (Date.now() - startTime > timeout) {
        log('Timed out waiting for clear screen for pro welcome modal');
        resolve(false);
        return;
      }

      setTimeout(checkScreen, CHECK_INTERVAL);
    };

    checkScreen();
  });
}

/**
 * Check and show Pro welcome modal if the user just activated a paid license.
 * Called on page load alongside trial modal checks.
 */
export async function checkAndShowProWelcome() {
  try {
    const { [PRO_WELCOME_SHOWN_KEY]: alreadyShown } = await new Promise((resolve) => {
      chrome.storage.local.get([PRO_WELCOME_SHOWN_KEY], resolve);
    });

    if (alreadyShown !== false) {
      return;
    }

    const hasPro = await isPro();
    if (!hasPro) {
      return;
    }

    const licenseStatus = await getLicenseStatus();
    if (licenseStatus.status !== 'active' || !licenseStatus.type || licenseStatus.type === 'trial') {
      return;
    }

    log('Waiting for clear screen to show pro welcome modal...');
    const screenClear = await waitForClearScreen();

    if (!screenClear) {
      log('Could not get clear screen for pro welcome modal, skipping');
      return;
    }

    showProWelcomeModal(licenseStatus.type);

    chrome.storage.local.set({ [PRO_WELCOME_SHOWN_KEY]: true });
  } catch (error) {
    log(`Error checking pro welcome modal: ${error.message}`);
  }
}

/**
 * Show the Pro welcome modal
 * @param {string} licenseType - 'yearly' or 'lifetime'
 */
export function showProWelcomeModal(licenseType = 'yearly') {
  if (modalInstance) {
    modalInstance.classList.add('open');
    document.body.style.overflow = 'hidden';
    return;
  }

  const isLifetime = licenseType === 'lifetime';

  const featuresHTML = PRO_FEATURES.map(f => `
    <div class="pro-welcome-feature">
      <div class="pro-welcome-feature-icon">${f.icon}</div>
      <div class="pro-welcome-feature-text">
        <span class="pro-welcome-feature-title">${getMessage(f.titleKey)}</span>
        <span class="pro-welcome-feature-desc">${getMessage(f.descKey)}</span>
      </div>
    </div>
  `).join('');

  const modalHTML = `
    <div id="pro-welcome-modal" class="pro-welcome-modal" role="dialog" aria-modal="true" aria-labelledby="pro-welcome-title">
      <div class="pro-welcome-backdrop"></div>
      <div class="pro-welcome-content">
        <button class="pro-welcome-close" aria-label="${getMessage('close') || 'Close'}">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>

        <div class="pro-welcome-header">
          <div class="pro-welcome-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
            </svg>
            <span>${getMessage(isLifetime ? 'proWelcomeBadgeLifetime' : 'proWelcomeBadgeYearly')}</span>
          </div>
          <h2 id="pro-welcome-title" class="pro-welcome-title">
            ${getMessage('proWelcomeTitle')}
          </h2>
          <p class="pro-welcome-subtitle">
            ${getMessage(isLifetime ? 'proWelcomeSubtitleLifetime' : 'proWelcomeSubtitleYearly')}
          </p>
        </div>

        <div class="pro-welcome-features">
          ${featuresHTML}
        </div>

        <div class="pro-welcome-thanks">
          <p>
            ${getMessage('proWelcomeThanks')}
          </p>
        </div>

        <div class="pro-welcome-actions">
          <button class="pro-welcome-btn-primary" id="pro-welcome-start">
            ${getMessage('startExploring')}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="5" y1="12" x2="19" y2="12"/>
              <polyline points="12 5 19 12 12 19"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);
  modalInstance = document.getElementById('pro-welcome-modal');

  const closeBtn = modalInstance.querySelector('.pro-welcome-close');
  closeBtn?.addEventListener('click', hideProWelcomeModal);

  const backdrop = modalInstance.querySelector('.pro-welcome-backdrop');
  backdrop?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideProWelcomeModal();
  });

  const startBtn = modalInstance.querySelector('#pro-welcome-start');
  startBtn?.addEventListener('click', hideProWelcomeModal);

  const content = modalInstance.querySelector('.pro-welcome-content');
  content?.addEventListener('click', (e) => e.stopPropagation());

  document.addEventListener('keydown', handleProWelcomeEsc);

  requestAnimationFrame(() => {
    modalInstance.classList.add('open');
    document.body.style.overflow = 'hidden';
  });
}

function handleProWelcomeEsc(e) {
  if (e.key === 'Escape' && modalInstance?.classList.contains('open')) {
    hideProWelcomeModal();
  }
}

/**
 * Hide the Pro welcome modal
 */
export function hideProWelcomeModal() {
  if (!modalInstance) return;

  modalInstance.classList.remove('open');
  document.body.style.overflow = '';
  document.removeEventListener('keydown', handleProWelcomeEsc);

  setTimeout(() => {
    modalInstance?.remove();
    modalInstance = null;
  }, 300);
}

/**
 * Check if the Pro welcome modal is currently open
 */
export function isProWelcomeModalOpen() {
  return modalInstance?.classList.contains('open') || false;
}

/**
 * Force show Pro welcome modal (for debugging)
 */
export function debugShowProWelcome(licenseType = 'yearly') {
  showProWelcomeModal(licenseType);
}

export default {
  checkAndShowProWelcome,
  showProWelcomeModal,
  hideProWelcomeModal,
  isProWelcomeModalOpen,
  debugShowProWelcome
};
