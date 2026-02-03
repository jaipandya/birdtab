/**
 * Google Apps Module
 * Displays a grid of Google app shortcuts in a slide-in panel
 */

import { localizeHtml } from './i18n.js';
import { log } from './logger.js';
import { trackFeature } from './analytics.js';

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

// Custom order state
let customOrder = { primary: null, secondary: null };

// Drag state
let dragState = {
  isDragging: false,
  draggedElement: null,
  draggedAppId: null,
  sourceSection: null,
  sourceIndex: -1,  // Track original index for comparison
  targetSection: null,
  ghost: null,
  startX: 0,
  startY: 0,
  hasMoved: false
};

const DRAG_THRESHOLD = 5; // pixels before drag activates
const TOUCH_HOLD_DELAY = 150; // ms before touch drag starts
let touchHoldTimer = null;
let lastDropTargetUpdate = 0;
const DROP_TARGET_THROTTLE = 16; // ~60fps throttle for drop target updates

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
 * Load custom order from storage
 */
async function loadCustomOrder() {
  try {
    const result = await chrome.storage.local.get(['googleAppsCustomOrder']);
    if (result.googleAppsCustomOrder) {
      customOrder = result.googleAppsCustomOrder;
    } else {
      customOrder = { primary: null, secondary: null };
    }
  } catch (e) {
    log('Error loading custom order:', e);
    customOrder = { primary: null, secondary: null };
  }
}

/**
 * Save custom order to storage
 */
async function saveCustomOrder() {
  try {
    await chrome.storage.local.set({
      googleAppsCustomOrder: {
        primary: customOrder.primary,
        secondary: customOrder.secondary,
        version: 1
      }
    });
    log('Custom order saved');
  } catch (e) {
    log('Error saving custom order:', e);
  }
}

/**
 * Reset to default order
 */
async function resetToDefaultOrder() {
  customOrder = { primary: null, secondary: null };
  try {
    await chrome.storage.local.remove(['googleAppsCustomOrder']);
    log('Order reset to default');
    announceToScreenReader(chrome.i18n.getMessage('orderResetToDefault') || 'Order reset to default');
  } catch (e) {
    log('Error resetting order:', e);
  }
}

/**
 * Check if a custom order exists
 * @returns {boolean} True if custom order exists
 */
function hasCustomOrder() {
  return customOrder.primary !== null || customOrder.secondary !== null;
}

/**
 * Get apps in order (custom or default)
 * @param {string} section - 'primary' or 'secondary'
 * @returns {Array} Ordered apps array
 */
function getOrderedApps(section) {
  const defaultApps = GOOGLE_APPS[section];
  const orderArray = customOrder[section];

  if (!orderArray) {
    return defaultApps;
  }

  // Build ordered list from IDs
  const appMap = {};
  defaultApps.forEach(app => {
    appMap[app.id] = app;
  });

  // Also include apps from the other section (for cross-section moves)
  const otherSection = section === 'primary' ? 'secondary' : 'primary';
  GOOGLE_APPS[otherSection].forEach(app => {
    appMap[app.id] = app;
  });

  const orderedApps = [];
  orderArray.forEach(appId => {
    if (appMap[appId]) {
      orderedApps.push(appMap[appId]);
    }
  });

  return orderedApps;
}

/**
 * Move an app to a new section and position
 * @param {string} appId - App ID to move
 * @param {string} sourceSection - Source section ('primary' or 'secondary')
 * @param {string} targetSection - Target section ('primary' or 'secondary')
 * @param {number} targetIndex - Target index in the target section
 */
function moveAppToSection(appId, sourceSection, targetSection, targetIndex) {
  // Initialize custom order arrays if needed
  if (!customOrder.primary) {
    customOrder.primary = GOOGLE_APPS.primary.map(a => a.id);
  }
  if (!customOrder.secondary) {
    customOrder.secondary = GOOGLE_APPS.secondary.map(a => a.id);
  }

  // Remove from source section
  const sourceArray = customOrder[sourceSection];
  const sourceIndex = sourceArray.indexOf(appId);
  if (sourceIndex > -1) {
    sourceArray.splice(sourceIndex, 1);
  }

  // Add to target section at the specified index
  const targetArray = customOrder[targetSection];
  // Adjust target index if moving within same section and removing from before target
  let adjustedIndex = targetIndex;
  if (sourceSection === targetSection && sourceIndex < targetIndex) {
    adjustedIndex = Math.max(0, targetIndex - 1);
  }
  targetArray.splice(adjustedIndex, 0, appId);
}

/**
 * Announce to screen readers
 * @param {string} message - Message to announce
 */
function announceToScreenReader(message) {
  const announcer = document.getElementById('google-apps-announcer');
  if (announcer) {
    announcer.textContent = message;
    setTimeout(() => {
      announcer.textContent = '';
    }, 1000);
  }
}

/**
 * Create an app item HTML
 * @param {Object} app - App object
 * @param {string} section - Section name ('primary' or 'secondary')
 * @param {number} index - Index in the section
 * @param {number} total - Total items in section
 * @returns {string} HTML string for the app item
 */
function createAppItemHTML(app, section, index, total) {
  const ariaLabel = chrome.i18n.getMessage('googleAppPosition', [app.name, String(index + 1), String(total)]) ||
    `${app.name}. Position ${index + 1} of ${total}. Use Ctrl+Arrow to move.`;

  return `
    <a href="${app.url}" target="_blank" rel="noopener noreferrer"
       class="google-app-item"
       title="${app.name}"
       data-app-id="${app.id}"
       data-section="${section}"
       role="option"
       tabindex="0"
       aria-label="${ariaLabel}">
      <div class="google-app-icon-wrapper">
        <img src="${getIconUrl(app.id, app.domain)}" alt="" class="google-app-icon" loading="lazy" draggable="false">
      </div>
      <span class="google-app-name">${app.name}</span>
    </a>
  `;
}

/**
 * Create the Google Apps panel HTML
 * @returns {string} HTML string for the panel
 */
function createPanelHTML() {
  const primaryApps = getOrderedApps('primary');
  const secondaryApps = getOrderedApps('secondary');

  const primaryAppsHtml = primaryApps.map((app, idx) =>
    createAppItemHTML(app, 'primary', idx, primaryApps.length)
  ).join('');

  const secondaryAppsHtml = secondaryApps.map((app, idx) =>
    createAppItemHTML(app, 'secondary', idx, secondaryApps.length)
  ).join('');

  const resetButtonHidden = hasCustomOrder() ? '' : 'hidden';
  const resetButtonText = chrome.i18n.getMessage('resetGoogleAppsOrder') || 'Reset order';

  return `
    <div id="google-apps-panel" class="settings-sidebar" role="dialog" aria-modal="true" aria-labelledby="google-apps-title">
      <div class="settings-content google-apps-content">
        <div class="settings-header">
          <h2 id="google-apps-title" data-i18n="googleAppsTitle">Google Apps</h2>
          <div class="google-apps-header-actions">
            <button id="reset-google-apps-order" class="reset-order-button ${resetButtonHidden}" data-i18n="resetGoogleAppsOrder">
              ${resetButtonText}
            </button>
            <button id="close-google-apps" class="close-button" data-i18n-aria-label="closeGoogleApps" aria-label="Close Google Apps">
              <img src="images/svg/close.svg" alt="Close" width="20" height="20">
            </button>
          </div>
        </div>
        <div class="settings-body">
          <div class="google-apps-grid" data-section="primary">
            ${primaryAppsHtml}
          </div>
          <div class="google-apps-divider"></div>
          <div class="google-apps-grid" data-section="secondary">
            ${secondaryAppsHtml}
          </div>
        </div>
        <!-- Live region for screen reader announcements -->
        <div id="google-apps-announcer" role="status" aria-live="polite" class="visually-hidden"></div>
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
export async function openGoogleApps() {
  if (isOpen) return;

  // Load custom order before creating panel
  await loadCustomOrder();

  if (!panel) {
    document.body.insertAdjacentHTML('beforeend', createPanelHTML());
    panel = document.getElementById('google-apps-panel');
    localizeHtml();
    bindPanelEvents();
    // Force reflow to ensure initial state is rendered before animation
    panel.offsetHeight;
  } else {
    // Re-render with current order if panel already exists
    rerenderGrids();
    // Update reset button visibility
    if (hasCustomOrder()) {
      showResetButton();
    } else {
      hideResetButton();
    }
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

  // Clean up any in-progress drag
  if (dragState.isDragging) {
    cleanupDragElements();
    resetDragState();
  }

  // Remove global event listeners that might have been added during drag
  document.removeEventListener('mousemove', handleMouseMove);
  document.removeEventListener('mouseup', handleMouseUp);

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

// ==================== DRAG AND DROP ====================

/**
 * Reset drag state to initial values
 */
function resetDragState() {
  dragState = {
    isDragging: false,
    draggedElement: null,
    draggedAppId: null,
    sourceSection: null,
    sourceIndex: -1,
    targetSection: null,
    ghost: null,
    startX: 0,
    startY: 0,
    hasMoved: false
  };
}

/**
 * Cleanup drag elements (ghost and classes)
 */
function cleanupDragElements() {
  if (dragState.ghost) {
    dragState.ghost.remove();
  }
  if (dragState.draggedElement) {
    dragState.draggedElement.classList.remove('drag-source');
  }
  document.body.classList.remove('dragging-app');
}

/**
 * Show the reset button
 */
function showResetButton() {
  const resetBtn = document.getElementById('reset-google-apps-order');
  if (resetBtn) {
    resetBtn.classList.remove('hidden');
  }
}

/**
 * Hide the reset button
 */
function hideResetButton() {
  const resetBtn = document.getElementById('reset-google-apps-order');
  if (resetBtn) {
    resetBtn.classList.add('hidden');
  }
}

/**
 * Re-render the grids with current order
 */
function rerenderGrids() {
  const primaryGrid = panel.querySelector('.google-apps-grid[data-section="primary"]');
  const secondaryGrid = panel.querySelector('.google-apps-grid[data-section="secondary"]');

  if (primaryGrid && secondaryGrid) {
    const primaryApps = getOrderedApps('primary');
    const secondaryApps = getOrderedApps('secondary');

    primaryGrid.innerHTML = primaryApps.map((app, idx) =>
      createAppItemHTML(app, 'primary', idx, primaryApps.length)
    ).join('');

    secondaryGrid.innerHTML = secondaryApps.map((app, idx) =>
      createAppItemHTML(app, 'secondary', idx, secondaryApps.length)
    ).join('');
  }
}

/**
 * Initiate the drag operation
 * @param {HTMLElement} element - Element being dragged
 * @param {number} x - Current X position
 * @param {number} y - Current Y position
 */
function initiateDrag(element, x, y) {
  document.body.classList.add('dragging-app');

  // Create ghost element (visual representation during drag)
  const ghost = element.cloneNode(true);
  ghost.classList.add('dragging');
  ghost.style.width = `${element.offsetWidth}px`;
  ghost.style.height = `${element.offsetHeight}px`;
  ghost.style.left = `${x - element.offsetWidth / 2}px`;
  ghost.style.top = `${y - element.offsetHeight / 2}px`;
  document.body.appendChild(ghost);
  dragState.ghost = ghost;

  // The dragged element stays in place as a placeholder (visually hidden via CSS)
  // No separate placeholder element needed - this avoids n+1 grid positions
  element.classList.add('drag-source');
}

/**
 * Update ghost position during drag
 * @param {number} x - Current X position
 * @param {number} y - Current Y position
 */
function updateDragPosition(x, y) {
  if (dragState.ghost) {
    dragState.ghost.style.left = `${x - dragState.ghost.offsetWidth / 2}px`;
    dragState.ghost.style.top = `${y - dragState.ghost.offsetHeight / 2}px`;
  }
}

/**
 * Find the drop target and update dragged element position
 * @param {number} x - Current X position
 * @param {number} y - Current Y position
 */
function updateDropTarget(x, y) {
  // Throttle updates to ~60fps for performance
  const now = Date.now();
  if (now - lastDropTargetUpdate < DROP_TARGET_THROTTLE) {
    return;
  }
  lastDropTargetUpdate = now;

  const grids = panel.querySelectorAll('.google-apps-grid');
  let targetGrid = null;
  let targetSection = null;

  // Find which grid we're over
  grids.forEach((grid) => {
    const rect = grid.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      targetGrid = grid;
      targetSection = grid.dataset.section;
    }
  });

  if (!targetGrid) {
    // If not over any grid, check if we're between them or near them
    const settingsBody = panel.querySelector('.settings-body');
    if (settingsBody) {
      const bodyRect = settingsBody.getBoundingClientRect();
      if (x >= bodyRect.left && x <= bodyRect.right) {
        // Determine closest grid
        let closestGrid = null;
        let closestDistance = Infinity;
        grids.forEach((grid) => {
          const rect = grid.getBoundingClientRect();
          const centerY = rect.top + rect.height / 2;
          const distance = Math.abs(y - centerY);
          if (distance < closestDistance) {
            closestDistance = distance;
            closestGrid = grid;
          }
        });
        if (closestGrid) {
          targetGrid = closestGrid;
          targetSection = closestGrid.dataset.section;
        }
      }
    }
  }

  if (!targetGrid) return;

  dragState.targetSection = targetSection;

  const draggedElement = dragState.draggedElement;
  if (!draggedElement) return;

  // Find drop position within grid (excluding the dragged element)
  const items = Array.from(targetGrid.querySelectorAll('.google-app-item:not(.drag-source)'));
  let insertBefore = null;

  for (const item of items) {
    const rect = item.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // Insert before this item if cursor is above or to the left
    if (y < centerY - rect.height / 4 || (y < centerY + rect.height / 4 && x < centerX)) {
      insertBefore = item;
      break;
    }
  }

  // Move the dragged element (acting as placeholder) to new position
  if (draggedElement.parentNode !== targetGrid) {
    // Moving to a different grid
    if (insertBefore) {
      targetGrid.insertBefore(draggedElement, insertBefore);
    } else {
      targetGrid.appendChild(draggedElement);
    }
    // Update the element's data-section attribute
    draggedElement.dataset.section = targetSection;
  } else {
    // Same grid - reposition if needed
    if (insertBefore) {
      if (draggedElement.nextSibling !== insertBefore && draggedElement !== insertBefore) {
        targetGrid.insertBefore(draggedElement, insertBefore);
      }
    } else {
      // Append to end if not already there
      if (draggedElement.nextSibling !== null) {
        targetGrid.appendChild(draggedElement);
      }
    }
  }
}

/**
 * Finalize the drop operation
 */
function finalizeDrop() {
  const { draggedAppId, sourceSection, sourceIndex, draggedElement } = dragState;
  let { targetSection } = dragState;

  if (!draggedElement || !draggedElement.parentNode) {
    cleanupDragElements();
    return;
  }

  // Determine target section from the dragged element's current parent grid
  const targetGrid = draggedElement.parentNode;
  targetSection = targetGrid.dataset.section || targetSection;

  if (!targetSection) {
    cleanupDragElements();
    return;
  }

  // Calculate target index from the dragged element's current position
  const allItems = Array.from(targetGrid.querySelectorAll('.google-app-item'));
  const targetIndex = allItems.indexOf(draggedElement);

  // Check if position actually changed
  const positionChanged = sourceSection !== targetSection || sourceIndex !== targetIndex;

  if (!positionChanged) {
    // No change - just clean up without saving
    cleanupDragElements();
    return;
  }

  // Move app in data structure
  moveAppToSection(draggedAppId, sourceSection, targetSection, targetIndex);

  // Clean up drag elements before re-rendering
  cleanupDragElements();

  // Re-render grids
  rerenderGrids();

  // Add drop animation to the dropped item
  const droppedItem = panel.querySelector(`[data-app-id="${draggedAppId}"]`);
  if (droppedItem) {
    droppedItem.classList.add('just-dropped');
    setTimeout(() => droppedItem.classList.remove('just-dropped'), 300);
  }

  // Save to storage
  saveCustomOrder();

  // Show reset button (only if custom order now exists)
  if (hasCustomOrder()) {
    showResetButton();
  }

  // Announce for screen readers
  const newIndex = targetIndex + 1;
  announceToScreenReader(
    chrome.i18n.getMessage('appMovedToPosition', [String(newIndex)]) ||
    `Moved to position ${newIndex}`
  );
}

/**
 * Handle mouse down on app items
 * @param {MouseEvent} e - Mouse event
 */
function handleMouseDown(e) {
  const appItem = e.target.closest('.google-app-item');
  if (!appItem) return;

  // Ignore if clicking on link itself (not dragging)
  e.preventDefault();

  // Calculate original index
  const grid = appItem.closest('.google-apps-grid');
  const items = Array.from(grid.querySelectorAll('.google-app-item'));
  const originalIndex = items.indexOf(appItem);

  dragState.startX = e.clientX;
  dragState.startY = e.clientY;
  dragState.hasMoved = false;
  dragState.draggedElement = appItem;
  dragState.draggedAppId = appItem.dataset.appId;
  dragState.sourceSection = appItem.dataset.section;
  dragState.sourceIndex = originalIndex;

  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
}

/**
 * Handle mouse move during potential drag
 * @param {MouseEvent} e - Mouse event
 */
function handleMouseMove(e) {
  const dx = e.clientX - dragState.startX;
  const dy = e.clientY - dragState.startY;

  // Check if moved beyond threshold to start drag
  if (!dragState.hasMoved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
    dragState.hasMoved = true;
    dragState.isDragging = true;
    initiateDrag(dragState.draggedElement, e.clientX, e.clientY);
  }

  if (dragState.isDragging) {
    updateDragPosition(e.clientX, e.clientY);
    updateDropTarget(e.clientX, e.clientY);
  }
}

/**
 * Handle mouse up after potential drag
 * @param {MouseEvent} e - Mouse event
 */
function handleMouseUp(e) {
  document.removeEventListener('mousemove', handleMouseMove);
  document.removeEventListener('mouseup', handleMouseUp);

  if (dragState.isDragging) {
    finalizeDrop();
  } else if (dragState.draggedElement) {
    // Was a click, not a drag - navigate to link
    const url = dragState.draggedElement.href;
    if (url) {
      window.open(url, '_blank');
    }
  }

  resetDragState();
}

// ==================== TOUCH SUPPORT ====================

/**
 * Handle touch start on app items
 * @param {TouchEvent} e - Touch event
 */
function handleTouchStart(e) {
  const touch = e.touches[0];
  const appItem = touch.target.closest('.google-app-item');
  if (!appItem) return;

  // Calculate original index
  const grid = appItem.closest('.google-apps-grid');
  const items = Array.from(grid.querySelectorAll('.google-app-item'));
  const originalIndex = items.indexOf(appItem);

  dragState.startX = touch.clientX;
  dragState.startY = touch.clientY;
  dragState.draggedElement = appItem;
  dragState.draggedAppId = appItem.dataset.appId;
  dragState.sourceSection = appItem.dataset.section;
  dragState.sourceIndex = originalIndex;
  dragState.hasMoved = false;

  // Start hold timer for drag
  touchHoldTimer = setTimeout(() => {
    if (!dragState.hasMoved) {
      dragState.isDragging = true;
      initiateDrag(appItem, touch.clientX, touch.clientY);
      // Haptic feedback if available
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }
  }, TOUCH_HOLD_DELAY);
}

/**
 * Handle touch move during potential drag
 * @param {TouchEvent} e - Touch event
 */
function handleTouchMove(e) {
  const touch = e.touches[0];
  const dx = touch.clientX - dragState.startX;
  const dy = touch.clientY - dragState.startY;

  // Cancel hold timer if moved before delay (allow scroll)
  if (touchHoldTimer && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
    clearTimeout(touchHoldTimer);
    touchHoldTimer = null;
    if (!dragState.isDragging) {
      return; // Allow scroll
    }
  }

  if (dragState.isDragging) {
    e.preventDefault();
    updateDragPosition(touch.clientX, touch.clientY);
    updateDropTarget(touch.clientX, touch.clientY);
    handleAutoScroll(touch.clientY);
  }
}

/**
 * Handle touch end after potential drag
 * @param {TouchEvent} e - Touch event
 */
function handleTouchEnd(e) {
  clearTimeout(touchHoldTimer);
  touchHoldTimer = null;

  if (dragState.isDragging) {
    e.preventDefault();
    finalizeDrop();
  }

  resetDragState();
}

/**
 * Handle auto-scroll when dragging near edges
 * @param {number} y - Current Y position
 */
function handleAutoScroll(y) {
  const settingsBody = panel.querySelector('.settings-body');
  if (!settingsBody) return;

  const rect = settingsBody.getBoundingClientRect();
  const scrollThreshold = 50;
  const scrollSpeed = 10;

  if (y < rect.top + scrollThreshold) {
    settingsBody.scrollTop -= scrollSpeed;
  } else if (y > rect.bottom - scrollThreshold) {
    settingsBody.scrollTop += scrollSpeed;
  }
}

// ==================== KEYBOARD SUPPORT ====================

/**
 * Handle keyboard navigation for reordering
 * @param {KeyboardEvent} e - Keyboard event
 */
function handleKeyboardReorder(e) {
  const focusedItem = document.activeElement;
  if (!focusedItem?.classList.contains('google-app-item')) return;
  if (!e.ctrlKey && !e.metaKey) return;

  const arrowKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  if (!arrowKeys.includes(e.key)) return;

  const appId = focusedItem.dataset.appId;
  const section = focusedItem.dataset.section;
  const grid = focusedItem.closest('.google-apps-grid');
  const items = Array.from(grid.querySelectorAll('.google-app-item'));
  const currentIndex = items.indexOf(focusedItem);

  // Calculate number of columns from grid
  const gridStyle = getComputedStyle(grid);
  const columns = gridStyle.gridTemplateColumns.split(' ').length;

  let targetIndex = currentIndex;
  let targetSection = section;

  switch (e.key) {
    case 'ArrowLeft':
      targetIndex = Math.max(0, currentIndex - 1);
      break;
    case 'ArrowRight':
      targetIndex = Math.min(items.length - 1, currentIndex + 1);
      break;
    case 'ArrowUp':
      targetIndex = Math.max(0, currentIndex - columns);
      break;
    case 'ArrowDown':
      targetIndex = Math.min(items.length - 1, currentIndex + columns);
      break;
    default:
      return;
  }

  if (targetIndex !== currentIndex) {
    e.preventDefault();

    // Move in data structure
    moveAppToSection(appId, section, targetSection, targetIndex);

    // Re-render and save
    rerenderGrids();
    saveCustomOrder();
    showResetButton();

    // Refocus moved item
    const movedItem = panel.querySelector(`[data-app-id="${appId}"]`);
    if (movedItem) {
      movedItem.focus();
    }

    // Announce for screen readers
    announceToScreenReader(
      chrome.i18n.getMessage('appMovedToPosition', [String(targetIndex + 1)]) ||
      `Moved to position ${targetIndex + 1}`
    );
  }
}

/**
 * Handle reset button click
 */
async function handleResetOrder() {
  await resetToDefaultOrder();
  rerenderGrids();
  hideResetButton();
}

/**
 * Bind event listeners to the panel
 */
function bindPanelEvents() {
  const closeBtn = document.getElementById('close-google-apps');
  const resetBtn = document.getElementById('reset-google-apps-order');

  // Close button
  if (closeBtn) {
    closeBtn.addEventListener('click', closeGoogleApps);
  }

  // Reset order button
  if (resetBtn) {
    resetBtn.addEventListener('click', handleResetOrder);
  }

  // Click outside to close
  panel.addEventListener('click', (e) => {
    if (e.target === panel) {
      closeGoogleApps();
    }
  });

  // ESC key to close
  document.addEventListener('keydown', handleEscapeKey);

  // Drag and drop events (mouse)
  const settingsBody = panel.querySelector('.settings-body');
  if (settingsBody) {
    settingsBody.addEventListener('mousedown', handleMouseDown);

    // Touch events
    settingsBody.addEventListener('touchstart', handleTouchStart, { passive: true });
    settingsBody.addEventListener('touchmove', handleTouchMove, { passive: false });
    settingsBody.addEventListener('touchend', handleTouchEnd);
    settingsBody.addEventListener('touchcancel', handleTouchEnd);
  }

  // Keyboard reordering
  panel.addEventListener('keydown', handleKeyboardReorder);
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
    trackFeature('google_apps');
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
