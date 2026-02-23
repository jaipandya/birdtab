/**
 * Upgrade Modal Component
 * A conversion-optimized modal that showcases Pro benefits
 */

import { activateLicense, getLicenseStatus } from './licenseManager.js';
import { log } from './logger.js';
import { CONFIG } from './config.js';
import { trackProUpgradeClicked, trackLicenseActivated } from './analytics.js';

// Pricing page URL - uses website URL from config
const PRICING_URL = `${CONFIG.WEBSITE_URL}/pricing`;

let modalInstance = null;
let escHandler = null;

/**
 * Create and show the upgrade modal
 * @param {string} triggerFeature - The feature that triggered the modal (for highlighting)
 */
export function showUpgradeModal(triggerFeature = null) {
  if (modalInstance) {
    modalInstance.classList.add('open');
    document.body.style.overflow = 'hidden';
    return;
  }

  // Get the trigger feature name for personalized messaging
  const featureNames = {
    videoMode: chrome.i18n.getMessage('proFeatureVideoMode') || 'Video Mode',
    highResImages: chrome.i18n.getMessage('proFeatureHighRes') || 'High-Resolution Images',
    region: chrome.i18n.getMessage('proFeatureRegion') || 'International Regions',
    clockTimer: chrome.i18n.getMessage('proFeatureClock') || 'Clock & Timer'
  };
  const triggerName = triggerFeature ? featureNames[triggerFeature] : null;

  // Build title and subtitle
  const title = triggerName
    ? (chrome.i18n.getMessage('unlockFeature', [triggerName]) || `Unlock ${triggerName}`)
    : (chrome.i18n.getMessage('unlockFullExperience') || 'Unlock the Full Experience');
  const subtitle = triggerName
    ? (chrome.i18n.getMessage('upgradeFeatureSubtitle', [triggerName.toLowerCase()]) || `This feature is part of BirdTab Pro. Upgrade to access ${triggerName.toLowerCase()} and all premium features.`)
    : (chrome.i18n.getMessage('upgradePrompt') || 'Get Video Mode, High-Res Images, International Regions, and Clock/Timer.');

  // Create modal HTML - clean, focused design
  const modalHTML = `
    <div id="upgrade-modal" class="upgrade-modal" role="dialog" aria-modal="true" aria-labelledby="upgrade-modal-title">
      <div class="upgrade-modal-backdrop"></div>
      <div class="upgrade-modal-content">
        <button class="upgrade-modal-close" aria-label="${chrome.i18n.getMessage('close') || 'Close'}">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>

        <div class="upgrade-hero">
          <div class="upgrade-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
            </svg>
            <span>${chrome.i18n.getMessage('birdtabPro') || 'BirdTab Pro'}</span>
          </div>
          <h2 id="upgrade-modal-title" class="upgrade-title">
            ${title}
          </h2>
          <p class="upgrade-subtitle">
            ${subtitle}
          </p>
        </div>

        <div class="upgrade-features">
          <div class="upgrade-feature ${triggerFeature === 'videoMode' ? 'active' : ''}">
            <div class="feature-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="23 7 16 12 23 17 23 7"/>
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
              </svg>
            </div>
            <span>${chrome.i18n.getMessage('proFeatureVideoMode') || 'Video Mode'}</span>
          </div>
          <div class="upgrade-feature ${triggerFeature === 'highResImages' ? 'active' : ''}">
            <div class="feature-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
            </div>
            <span>${chrome.i18n.getMessage('proFeatureHighRes') || 'High-Res Photos'}</span>
          </div>
          <div class="upgrade-feature ${triggerFeature === 'region' ? 'active' : ''}">
            <div class="feature-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
            </div>
            <span>${chrome.i18n.getMessage('proFeatureRegion') || 'World Regions'}</span>
          </div>
          <div class="upgrade-feature ${triggerFeature === 'clockTimer' ? 'active' : ''}">
            <div class="feature-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <span>${chrome.i18n.getMessage('proFeatureClock') || 'Clock & Timer'}</span>
          </div>
        </div>

        <button class="upgrade-cta" id="upgrade-cta-btn">
          ${chrome.i18n.getMessage('upgradeNow') || 'Upgrade Now'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="5" y1="12" x2="19" y2="12"/>
            <polyline points="12 5 19 12 12 19"/>
          </svg>
        </button>

        <div class="upgrade-license">
          <span class="license-label">${chrome.i18n.getMessage('alreadyHaveLicense') || 'Have a license key?'}</span>
          <div class="license-input-row">
            <input
              type="text"
              id="license-key-input"
              class="license-input"
              placeholder="${chrome.i18n.getMessage('enterLicenseKey') || 'XXXX-XXXX-XXXX-XXXX'}"
              autocomplete="off"
              spellcheck="false"
            >
            <button id="activate-license-btn" class="license-btn">${chrome.i18n.getMessage('activate') || 'Activate'}</button>
          </div>
          <p id="license-error" class="license-message error hidden"></p>
          <p id="license-success" class="license-message success hidden"></p>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);
  modalInstance = document.getElementById('upgrade-modal');

  bindModalEvents();

  requestAnimationFrame(() => {
    modalInstance.classList.add('open');
    document.body.style.overflow = 'hidden';
  });
}

/**
 * Hide and destroy the upgrade modal
 */
export function hideUpgradeModal() {
  if (!modalInstance) return;

  modalInstance.classList.remove('open');
  document.body.style.overflow = '';

  if (escHandler) {
    document.removeEventListener('keydown', escHandler);
    escHandler = null;
  }

  setTimeout(() => {
    if (modalInstance && modalInstance.parentNode) {
      modalInstance.remove();
      modalInstance = null;
    }
  }, 250);
}

/**
 * Bind event handlers for the modal
 */
function bindModalEvents() {
  if (!modalInstance) return;

  // Close button
  const closeBtn = modalInstance.querySelector('.upgrade-modal-close');
  closeBtn?.addEventListener('click', hideUpgradeModal);

  // Backdrop click - stop propagation to prevent clicks reaching elements behind
  const backdrop = modalInstance.querySelector('.upgrade-modal-backdrop');
  backdrop?.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    hideUpgradeModal();
  });

  // ESC key
  escHandler = (e) => {
    if (e.key === 'Escape' && modalInstance?.classList.contains('open')) {
      hideUpgradeModal();
    }
  };
  document.addEventListener('keydown', escHandler);

  // Upgrade button - opens pricing page
  const upgradeBtn = modalInstance.querySelector('#upgrade-cta-btn');
  upgradeBtn?.addEventListener('click', () => {
    trackProUpgradeClicked('upgrade_modal', triggerFeature);
    window.open(PRICING_URL, '_blank');
  });

  // Activate license button
  const activateBtn = modalInstance.querySelector('#activate-license-btn');
  const licenseInput = modalInstance.querySelector('#license-key-input');
  const errorEl = modalInstance.querySelector('#license-error');
  const successEl = modalInstance.querySelector('#license-success');

  activateBtn?.addEventListener('click', async () => {
    const licenseKey = licenseInput?.value?.trim();

    errorEl?.classList.add('hidden');
    successEl?.classList.add('hidden');

    if (!licenseKey) {
      showError(chrome.i18n.getMessage('enterValidKey') || 'Please enter a license key');
      return;
    }

    activateBtn.disabled = true;
    activateBtn.textContent = chrome.i18n.getMessage('activating') || 'Activating...';

    try {
      const result = await activateLicense(licenseKey);

      if (result.success) {
        trackLicenseActivated({
          type: result.data?.type,
          status: result.data?.status,
        });
        showActivationSuccess();
        setTimeout(() => window.location.reload(), 2200);
      } else if (result.error === 'activation_limit_reached') {
        showActivationLimitReached();
      } else {
        showError(result.error || (chrome.i18n.getMessage('activationFailed') || 'Invalid license key'));
        activateBtn.disabled = false;
        activateBtn.textContent = chrome.i18n.getMessage('activate') || 'Activate';
      }
    } catch (error) {
      log(`License activation error: ${error.message}`);
      showError(chrome.i18n.getMessage('activationError') || 'Something went wrong. Try again.');
      activateBtn.disabled = false;
      activateBtn.textContent = chrome.i18n.getMessage('activate') || 'Activate';
    }
  });

  licenseInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') activateBtn?.click();
  });

  function showError(message) {
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.remove('hidden');
    }
  }

  function showActivationSuccess() {
    const content = modalInstance.querySelector('.upgrade-modal-content');
    if (!content) return;

    content.innerHTML = `
      <div class="upgrade-success-state">
        <div class="upgrade-success-icon">
          <svg viewBox="0 0 64 64" fill="none" width="64" height="64">
            <circle cx="32" cy="32" r="30" stroke="currentColor" stroke-width="2" opacity="0.3"/>
            <circle cx="32" cy="32" r="30" stroke="currentColor" stroke-width="2"
              stroke-dasharray="188" stroke-dashoffset="188"
              style="animation: draw-circle 0.5s 0.1s ease forwards;"/>
            <polyline points="18,34 27,43 46,24" stroke="currentColor" stroke-width="3"
              stroke-linecap="round" stroke-linejoin="round"
              stroke-dasharray="40" stroke-dashoffset="40"
              style="animation: draw-check 0.4s 0.5s ease forwards;"/>
          </svg>
        </div>
        <h2 class="upgrade-success-title">${chrome.i18n.getMessage('licenseActivated') || 'BirdTab Pro activated!'}</h2>
        <p class="upgrade-success-body">${chrome.i18n.getMessage('proActivatedBody') || 'Every new tab is now a window to the natural world. Reloading in a moment…'}</p>
      </div>
    `;
  }

  function showActivationLimitReached() {
    const content = modalInstance.querySelector('.upgrade-modal-content');
    if (!content) return;

    content.innerHTML = `
      <div class="upgrade-success-state">
        <div class="upgrade-success-icon" style="color: var(--orange, #f97316);">
          <svg viewBox="0 0 64 64" fill="none" width="64" height="64">
            <circle cx="32" cy="32" r="30" stroke="currentColor" stroke-width="2" opacity="0.3"/>
            <circle cx="32" cy="32" r="30" stroke="currentColor" stroke-width="2"
              stroke-dasharray="188" stroke-dashoffset="188"
              style="animation: draw-circle 0.5s 0.1s ease forwards;"/>
            <line x1="20" y1="32" x2="44" y2="32" stroke="currentColor" stroke-width="3"
              stroke-linecap="round"
              stroke-dasharray="30" stroke-dashoffset="30"
              style="animation: draw-check 0.3s 0.5s ease forwards;"/>
          </svg>
        </div>
        <h2 class="upgrade-success-title">${chrome.i18n.getMessage('deviceLimitTitle') || 'Device limit reached'}</h2>
        <p class="upgrade-success-body">
          ${chrome.i18n.getMessage('deviceLimitBody') || 'All device slots on your license are in use. To activate here, free up a slot first: go to Settings → Manage → Deactivate on another device where BirdTab is installed, or remove a device from your account.'}
        </p>
        <a href="https://birdtab.lemonsqueezy.com/billing" target="_blank" class="upgrade-cta" style="display:inline-flex;text-decoration:none;margin-top:8px;">
          ${chrome.i18n.getMessage('manageDevices') || 'Manage Devices'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="5" y1="12" x2="19" y2="12"/>
            <polyline points="12 5 19 12 12 19"/>
          </svg>
        </a>
      </div>
    `;
  }

  // Prevent content click from closing
  const content = modalInstance.querySelector('.upgrade-modal-content');
  content?.addEventListener('click', (e) => e.stopPropagation());
}

/**
 * Check if the upgrade modal is currently open
 */
export function isUpgradeModalOpen() {
  return modalInstance?.classList.contains('open') || false;
}

export default {
  showUpgradeModal,
  hideUpgradeModal,
  isUpgradeModalOpen,
};
