/**
 * Chrome Footer Notification Module
 * 
 * Displays a one-time notification informing users about Chrome's new footer
 * on new tab pages and how to hide it.
 * 
 * Features:
 * - Only shows on Chrome browser (not Edge or others)
 * - Waits for feature tour to complete before showing
 * - Persists dismissed state in chrome.storage.sync
 * - Subtle, non-intrusive UI matching BirdTab's design language
 */

import { log } from './logger.js';
import { isTourCompleted, isTourActive } from './featureTour.js';

// Storage key for dismissed state
const STORAGE_KEY = 'chromeFooterNotificationDismissed';

// Notification element reference
let notificationElement = null;

/**
 * Get localized message with fallback
 */
function getMessage(key, fallback) {
  try {
    const message = chrome.i18n?.getMessage(key);
    return message || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Check if the current browser is Chrome (not Edge, Brave, etc.)
 */
function isChromeBrowser() {
  const userAgent = navigator.userAgent;
  // Check for Chrome but exclude Edge, Brave, Opera, etc.
  const isChrome = /Chrome/.test(userAgent) && /Google Inc/.test(navigator.vendor);
  const isEdge = /Edg/.test(userAgent);
  const isBrave = navigator.brave !== undefined;
  const isOpera = /OPR/.test(userAgent);
  
  return isChrome && !isEdge && !isBrave && !isOpera;
}

/**
 * Check if the notification has been dismissed
 */
export async function isChromeFooterNotificationDismissed() {
  return new Promise((resolve) => {
    if (!chrome?.storage?.sync) {
      resolve(false);
      return;
    }
    chrome.storage.sync.get([STORAGE_KEY], (result) => {
      resolve(result[STORAGE_KEY] === true);
    });
  });
}

/**
 * Mark the notification as dismissed
 */
async function markNotificationDismissed() {
  return new Promise((resolve) => {
    if (!chrome?.storage?.sync) {
      resolve();
      return;
    }
    chrome.storage.sync.set({ [STORAGE_KEY]: true }, resolve);
  });
}

/**
 * Reset the notification dismissed state (for testing or re-showing)
 */
export async function resetChromeFooterNotification() {
  return new Promise((resolve) => {
    if (!chrome?.storage?.sync) {
      resolve();
      return;
    }
    chrome.storage.sync.remove([STORAGE_KEY], () => {
      log('Chrome footer notification reset');
      resolve();
    });
  });
}

/**
 * Create the notification element
 */
function createNotificationElement() {
  const notification = document.createElement('div');
  notification.className = 'chrome-footer-notification';
  notification.setAttribute('role', 'dialog');
  notification.setAttribute('aria-labelledby', 'chrome-footer-notification-title');
  notification.setAttribute('aria-describedby', 'chrome-footer-notification-desc');
  
  const title = getMessage('chromeFooterTitle', 'Seeing a banner at the bottom?');
  const description = getMessage('chromeFooterDescription', "That's Chrome's new footer. To hide it, right-click it and select 'Hide Footer on New Tab Page'.");
  const learnMore = getMessage('chromeFooterLearnMore', 'Learn more');
  const closeLabel = getMessage('chromeFooterClose', 'Close notification');
  
  notification.innerHTML = `
    <button class="chrome-footer-notification-close" aria-label="${closeLabel}">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>
    <div class="chrome-footer-notification-content">
      <div class="chrome-footer-notification-image">
        <img src="images/chrome-footer.jpg" alt="" loading="lazy">
      </div>
      <div class="chrome-footer-notification-text">
        <h3 id="chrome-footer-notification-title" class="chrome-footer-notification-title">${title}</h3>
        <p id="chrome-footer-notification-desc" class="chrome-footer-notification-description">${description}</p>
        <div class="chrome-footer-notification-actions">
          <a href="https://support.google.com/chrome/answer/11032183#zippy=%2Cturn-new-tab-page-footer-on-or-off" 
             target="_blank" 
             rel="noopener noreferrer" 
             class="chrome-footer-notification-link">
            ${learnMore}
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4.5 2.5H9.5V7.5M9.5 2.5L2.5 9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </a>
          <button class="chrome-footer-notification-dismiss">${getMessage('tourGotIt', 'Got it')}</button>
        </div>
      </div>
    </div>
  `;
  
  return notification;
}

/**
 * Dismiss the notification with animation
 */
export async function dismissChromeFooterNotification() {
  if (!notificationElement) return;
  
  log('Chrome footer notification dismissed');
  
  // Add exit animation class
  notificationElement.classList.add('exiting');
  
  // Mark as dismissed in storage
  await markNotificationDismissed();
  
  // Remove element after animation
  setTimeout(() => {
    if (notificationElement) {
      notificationElement.remove();
      notificationElement = null;
    }
  }, 300);
}

/**
 * Check if the review prompt is currently showing
 */
function isReviewPromptShowing() {
  return document.getElementById('review-prompt') !== null;
}

/**
 * Show the Chrome footer notification
 * Only shows if:
 * - Browser is Chrome
 * - Feature tour is completed
 * - Notification hasn't been dismissed before
 * - Review prompt is not showing
 */
export async function showChromeFooterNotification() {
  // Check if this is Chrome browser
  if (!isChromeBrowser()) {
    log('Chrome footer notification: Not Chrome browser, skipping');
    return false;
  }
  
  // Check if already dismissed
  const isDismissed = await isChromeFooterNotificationDismissed();
  if (isDismissed) {
    log('Chrome footer notification: Already dismissed, skipping');
    return false;
  }
  
  // Check if tour is completed
  const tourCompleted = await isTourCompleted();
  if (!tourCompleted) {
    log('Chrome footer notification: Tour not completed, skipping');
    return false;
  }
  
  // Check if tour is currently active
  if (isTourActive()) {
    log('Chrome footer notification: Tour is active, skipping');
    return false;
  }
  
  // Check if review prompt is showing (review prompt takes priority)
  if (isReviewPromptShowing()) {
    log('Chrome footer notification: Review prompt is showing, skipping');
    return false;
  }
  
  // Check if notification already exists
  if (notificationElement) {
    log('Chrome footer notification: Already showing');
    return false;
  }
  
  log('Showing Chrome footer notification');
  
  // Create and append notification
  notificationElement = createNotificationElement();
  document.body.appendChild(notificationElement);
  
  // Bind close button event (X button)
  const closeBtn = notificationElement.querySelector('.chrome-footer-notification-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      dismissChromeFooterNotification();
    });
  }
  
  // Bind dismiss button event ("Got it" button)
  const dismissBtn = notificationElement.querySelector('.chrome-footer-notification-dismiss');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', (e) => {
      e.preventDefault();
      dismissChromeFooterNotification();
    });
  }
  
  // Also dismiss when clicking the learn more link (user has engaged)
  const learnMoreLink = notificationElement.querySelector('.chrome-footer-notification-link');
  if (learnMoreLink) {
    learnMoreLink.addEventListener('click', () => {
      // Dismiss after a short delay to allow the link to open
      setTimeout(() => dismissChromeFooterNotification(), 100);
    });
  }
  
  // Trigger entrance animation
  requestAnimationFrame(() => {
    notificationElement?.classList.add('visible');
  });
  
  return true;
}

/**
 * Initialize Chrome footer notification with delay
 * Call this after page load and tour completion
 */
export async function initChromeFooterNotification(delayMs = 2500) {
  // Wait for the specified delay
  setTimeout(async () => {
    await showChromeFooterNotification();
  }, delayMs);
}

export default {
  showChromeFooterNotification,
  dismissChromeFooterNotification,
  isChromeFooterNotificationDismissed,
  initChromeFooterNotification,
  resetChromeFooterNotification
};
