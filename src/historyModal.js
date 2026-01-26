/**
 * History Modal Module
 * Manages viewing history storage and modal UI
 */

import { log } from './logger.js';
import { localizeHtml } from './i18n.js';

// Module state
let historySidebar = null;

// ===== History Storage Functions =====

/**
 * Add bird to viewing history
 * @param {Object} birdInfo - Bird information to add
 */
export async function addToHistory(birdInfo) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['viewHistory'], (result) => {
      const history = result.viewHistory?.value || [];

      // Store complete birdInfo with timestamp to avoid API calls when loading from history
      const entry = {
        ...birdInfo,
        timestamp: Date.now()
      };

      history.push(entry); // Newest at end

      // Enforce 200 item limit - remove oldest
      if (history.length > 200) {
        history.shift();
      }

      chrome.storage.local.set({
        viewHistory: { value: history, timestamp: Date.now() }
      }, () => {
        if (chrome.runtime.lastError) {
          log(`Error saving history: ${chrome.runtime.lastError.message}`);
        }
        resolve();
      });
    });
  });
}

/**
 * Get viewing history
 * @returns {Promise<Array>} Array of history entries
 */
export async function getHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['viewHistory'], (result) => {
      resolve(result.viewHistory?.value || []);
    });
  });
}

/**
 * Clear all viewing history
 */
export async function clearHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(['viewHistory'], resolve);
  });
}

/**
 * Get relative time string for timestamp display
 * @param {number} timestamp - Unix timestamp
 * @returns {string} Relative time string
 */
export function getRelativeTimeString(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return chrome.i18n.getMessage('justNow') || 'Just now';
  } else if (minutes < 60) {
    const key = minutes === 1 ? 'minuteAgo' : 'minutesAgo';
    return chrome.i18n.getMessage(key, [minutes.toString()]) || `${minutes} min ago`;
  } else if (hours < 24) {
    const key = hours === 1 ? 'hourAgo' : 'hoursAgo';
    return chrome.i18n.getMessage(key, [hours.toString()]) || `${hours}h ago`;
  } else if (days === 1) {
    return chrome.i18n.getMessage('yesterday') || 'Yesterday';
  } else if (days < 7) {
    return chrome.i18n.getMessage('daysAgo', [days.toString()]) || `${days} days ago`;
  } else {
    // Format as "Jan 15" or localized equivalent
    const date = new Date(timestamp);
    return new Intl.DateTimeFormat(chrome.i18n.getUILanguage(), {
      month: 'short',
      day: 'numeric'
    }).format(date);
  }
}

// ===== Utility Functions =====

/**
 * Escape HTML to prevent XSS
 * @param {string} unsafe - Unsafe string
 * @returns {string} Escaped string
 */
function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ===== History Modal UI Functions =====

/**
 * Create history modal DOM element
 */
function createHistoryModal() {
  const existingSidebar = document.getElementById('history-sidebar');
  if (existingSidebar) existingSidebar.remove();

  const modalHTML = `
    <div id="history-sidebar" class="settings-sidebar" role="dialog" aria-modal="true">
      <div class="settings-content history-content">
        <div class="settings-header">
          <h2 id="history-sidebar-title" data-i18n="historyTitle">Viewing History</h2>
          <button id="close-history" class="close-button" aria-label="Close history">
            <img src="images/svg/close.svg" alt="Close" width="20" height="20">
          </button>
        </div>
        <div class="settings-body">
          <div id="history-list" class="history-list"></div>
          <div id="empty-history" class="empty-history hidden">
            <img src="icons/icon128.png" alt="BirdTab" class="empty-history-icon" width="64" height="64">
            <p class="empty-history-title" data-i18n="emptyHistoryTitle">Your birding journey begins here!</p>
            <p class="empty-history-subtitle" data-i18n="emptyHistorySubtitle">Discover new birds and they'll appear in your viewing history.</p>
          </div>
        </div>
        <div class="history-footer">
          <button id="clear-history-btn" class="shortcut-btn secondary" data-i18n="clearHistory">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; vertical-align: -2px;">
              <polyline points="3,6 5,6 21,6"></polyline>
              <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2"></path>
            </svg>
            Clear History
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);
  localizeHtml();
  return document.getElementById('history-sidebar');
}

/**
 * Populate history list with entries
 */
export async function populateHistoryList() {
  const history = await getHistory();
  const historyList = document.getElementById('history-list');
  const emptyState = document.getElementById('empty-history');
  const clearBtn = document.getElementById('clear-history-btn');

  if (history.length === 0) {
    historyList.classList.add('hidden');
    emptyState.classList.remove('hidden');
    if (clearBtn) {
      clearBtn.disabled = true;
      clearBtn.setAttribute('aria-disabled', 'true');
    }
    return;
  }

  historyList.classList.remove('hidden');
  emptyState.classList.add('hidden');
  if (clearBtn) {
    clearBtn.disabled = false;
    clearBtn.setAttribute('aria-disabled', 'false');
  }

  // Reverse to show newest first
  const reversedHistory = [...history].reverse();

  // Use escaped HTML to prevent XSS
  // Store index to retrieve full birdInfo when clicked
  historyList.innerHTML = reversedHistory.map((entry, index) => `
    <button class="history-item" data-history-index="${index}">
      <img src="${escapeHtml(entry.imageUrl)}" alt="${escapeHtml(entry.name)}" class="history-item-image" loading="lazy">
      <div class="history-item-info">
        <div class="history-item-name">${escapeHtml(entry.name)}</div>
        <div class="history-item-scientific">${escapeHtml(entry.scientificName)}</div>
        <div class="history-item-time">${escapeHtml(getRelativeTimeString(entry.timestamp))}</div>
      </div>
    </button>
  `).join('');

  // Store history reference for click handler
  historyList.dataset.historyData = JSON.stringify(reversedHistory);
}

/**
 * Handle clicking on a history item
 * @param {HTMLElement} item - The clicked history item
 */
async function handleHistoryItemClick(item) {
  const historyIndex = parseInt(item.dataset.historyIndex);
  const historyList = document.getElementById('history-list');
  const historyData = JSON.parse(historyList.dataset.historyData);
  const birdInfo = historyData[historyIndex];

  if (!birdInfo) {
    log('Error: Could not find bird info in history');
    return;
  }

  closeHistoryModal();

  // Smooth fade-out transition before reload
  document.body.style.transition = 'opacity 0.2s ease';
  document.body.style.opacity = '0';

  // Store the cached bird info and reload page to display it
  // This reuses all existing initialization logic without API calls
  setTimeout(() => {
    chrome.storage.local.set({ pendingBirdInfo: birdInfo }, () => {
      window.location.reload();
    });
  }, 200);
}

/**
 * Bind event listeners to history modal
 */
function bindHistoryModalEvents() {
  const closeBtn = document.getElementById('close-history');
  const clearBtn = document.getElementById('clear-history-btn');
  const historyList = document.getElementById('history-list');

  // Close button
  closeBtn.addEventListener('click', closeHistoryModal);

  // Click outside to close
  historySidebar.addEventListener('click', (e) => {
    if (e.target === historySidebar) {
      closeHistoryModal();
    }
  });

  // ESC key to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && historySidebar.classList.contains('open')) {
      closeHistoryModal();
    }
  });

  // Event delegation for history items
  historyList.addEventListener('click', (e) => {
    const historyItem = e.target.closest('.history-item');
    if (historyItem) {
      handleHistoryItemClick(historyItem);
    }
  });

  // Clear history button
  clearBtn.addEventListener('click', async () => {
    const confirmed = confirm(chrome.i18n.getMessage('confirmClearHistory') ||
      'Are you sure you want to clear your viewing history?');
    if (confirmed) {
      await clearHistory();
      await populateHistoryList();
    }
  });
}

/**
 * Open history modal
 */
export function openHistoryModal() {
  if (!historySidebar) {
    historySidebar = createHistoryModal();
    bindHistoryModalEvents();
  }
  populateHistoryList();
  historySidebar.classList.add('open');
  document.body.style.overflow = 'hidden';
}

/**
 * Close history modal
 */
export function closeHistoryModal() {
  if (historySidebar) {
    historySidebar.classList.remove('open');
    document.body.style.overflow = '';
  }
}
