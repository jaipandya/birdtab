/**
 * Share Menu Module
 * Handles share URL generation, social sharing, and share menu UI
 */

import { trackFeature } from './analytics.js';

// Module state
let showShareMenu = false;
let getBirdInfo = () => null;

/**
 * Initialize share menu with birdInfo getter
 * @param {Function} birdInfoGetter - Function that returns current birdInfo
 */
export function initShareMenu(birdInfoGetter) {
  getBirdInfo = birdInfoGetter;
}

/**
 * Get the share state
 * @returns {boolean} Whether share menu is open
 */
export function getShowShareMenu() {
  return showShareMenu;
}

/**
 * Set the share state
 * @param {boolean} value - Whether share menu is open
 */
export function setShowShareMenu(value) {
  showShareMenu = value;
}

// ===== URL and Text Generation =====

/**
 * Get the share URL for the current bird
 * @returns {string} Share URL
 */
function getShareUrl() {
  const birdInfo = getBirdInfo();
  return `https://birdtab.app/species/${birdInfo?.speciesCode || ''}`;
}

/**
 * Get the share text for the current bird
 * @returns {string} Share text
 */
function getShareText() {
  const birdInfo = getBirdInfo();
  const template = chrome.i18n.getMessage('shareText') || 'Check out this beautiful {birdName}!';
  return template.replace('{birdName}', birdInfo?.name || '');
}

// ===== Sharing Actions =====

/**
 * Copy share URL to clipboard
 */
function copyToClipboard() {
  const shareUrl = getShareUrl();
  navigator.clipboard.writeText(shareUrl).then(() => {
    trackFeature('share', { method: 'copy_link' });
    const copyBtn = document.querySelector('.share-menu-copy-btn');
    if (copyBtn) {
      copyBtn.textContent = chrome.i18n.getMessage('linkCopied') || 'Copied!';
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.textContent = chrome.i18n.getMessage('copyLink') || 'Copy';
        copyBtn.classList.remove('copied');
      }, 2000);
    }
  }).catch(err => {
    console.error('Failed to copy:', err);
  });
}

/**
 * Share to Twitter/X
 */
function shareToTwitter() {
  trackFeature('share', { method: 'twitter' });
  const shareUrl = getShareUrl();
  const shareText = getShareText();
  window.open(
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`,
    '_blank',
    'width=550,height=420'
  );
  closeShareMenu();
}

/**
 * Share to Facebook
 */
function shareToFacebook() {
  trackFeature('share', { method: 'facebook' });
  const shareUrl = getShareUrl();
  window.open(
    `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
    '_blank',
    'width=550,height=420'
  );
  closeShareMenu();
}

/**
 * Share to WhatsApp
 */
function shareToWhatsApp() {
  trackFeature('share', { method: 'whatsapp' });
  const shareUrl = getShareUrl();
  const shareText = getShareText();
  window.open(
    `https://wa.me/?text=${encodeURIComponent(shareText + ' ' + shareUrl)}`,
    '_blank'
  );
  closeShareMenu();
}

// ===== Share Menu UI =====

/**
 * Create share menu HTML
 * @returns {string} HTML string for share menu
 */
function createShareMenuHTML() {
  const shareUrl = getShareUrl();
  return `
    <div class="share-menu">
      <div class="share-menu-section">
        <p class="share-menu-label">${chrome.i18n.getMessage('shareLink') || 'Share link'}</p>
        <div class="share-menu-url-row">
          <div class="share-menu-url">
            <span class="share-menu-url-text">${shareUrl}</span>
          </div>
          <button class="share-menu-copy-btn">${chrome.i18n.getMessage('copyLink') || 'Copy'}</button>
        </div>
      </div>
      <div class="share-menu-section">
        <p class="share-menu-label">${chrome.i18n.getMessage('shareOn') || 'Share on'}</p>
        <div class="share-menu-social">
          <button class="share-social-btn share-twitter" title="${chrome.i18n.getMessage('shareToX') || 'Share on X'}">
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
          </button>
          <button class="share-social-btn share-facebook" title="${chrome.i18n.getMessage('shareToFacebook') || 'Share on Facebook'}">
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
            </svg>
          </button>
          <button class="share-social-btn share-whatsapp" title="${chrome.i18n.getMessage('shareToWhatsApp') || 'Share on WhatsApp'}">
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Handle click outside share menu
 * @param {Event} event - Click event
 */
function handleClickOutsideShareMenu(event) {
  const shareContainer = document.getElementById('share-container');
  if (shareContainer && !shareContainer.contains(event.target)) {
    closeShareMenu();
  }
}

/**
 * Handle escape key to close share menu
 * @param {KeyboardEvent} event - Keyboard event
 */
function handleEscapeShareMenu(event) {
  if (event.key === 'Escape') {
    closeShareMenu();
  }
}

/**
 * Open the share menu
 */
export function openShareMenu() {
  const shareContainer = document.getElementById('share-container');
  if (!shareContainer || showShareMenu) return;

  showShareMenu = true;
  shareContainer.insertAdjacentHTML('beforeend', createShareMenuHTML());

  // Add event listeners to share menu buttons
  const copyBtn = shareContainer.querySelector('.share-menu-copy-btn');
  const twitterBtn = shareContainer.querySelector('.share-twitter');
  const facebookBtn = shareContainer.querySelector('.share-facebook');
  const whatsappBtn = shareContainer.querySelector('.share-whatsapp');

  if (copyBtn) copyBtn.addEventListener('click', copyToClipboard);
  if (twitterBtn) twitterBtn.addEventListener('click', shareToTwitter);
  if (facebookBtn) facebookBtn.addEventListener('click', shareToFacebook);
  if (whatsappBtn) whatsappBtn.addEventListener('click', shareToWhatsApp);

  // Close on click outside
  setTimeout(() => {
    document.addEventListener('mousedown', handleClickOutsideShareMenu);
    document.addEventListener('keydown', handleEscapeShareMenu);
  }, 10);
}

/**
 * Close the share menu
 */
export function closeShareMenu() {
  const shareMenu = document.querySelector('.share-menu');
  if (shareMenu) {
    shareMenu.remove();
  }
  showShareMenu = false;
  document.removeEventListener('mousedown', handleClickOutsideShareMenu);
  document.removeEventListener('keydown', handleEscapeShareMenu);
}

/**
 * Handle share button click - toggle share menu
 */
export function handleShare() {
  // Always show the custom share menu popup in the extension
  // (Native share API is not used since this is a Chrome extension that always runs in a browser)
  if (showShareMenu) {
    closeShareMenu();
  } else {
    openShareMenu();
  }
}

/**
 * Setup share button event listener
 */
export function setupShareButton() {
  const shareButton = document.getElementById('share-button');
  if (shareButton) {
    shareButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleShare();
    });
  }
}
