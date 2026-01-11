/**
 * Clock module for BirdTab
 * Displays a large, elegant clock above the search box in the quick access panel
 */

import { log } from './logger.js';
import { getMessage } from './i18n.js';
import { createOptionsMenu } from './optionsMenu.js';

// Module state
let clockInterval = null;
let clockSyncTimeout = null; // Track sync timeout to prevent leaks
let is24HourFormat = false;
let showSeconds = false;
let isVisible = false;
let optionsMenu = null;
let storageChangeListener = null;

/**
 * Get the clock container element
 * @returns {HTMLElement|null}
 */
function getClockContainer() {
  return document.getElementById('clock-container');
}

/**
 * Get the clock time element
 * @returns {HTMLElement|null}
 */
function getClockTimeElement() {
  return document.getElementById('clock-time');
}

/**
 * Get the clock options trigger element
 * @returns {HTMLElement|null}
 */
function getClockOptionsTrigger() {
  return document.getElementById('clock-options-trigger');
}

/**
 * Format the current time based on user preferences
 * @param {Date} date - The date to format
 * @returns {string} Formatted time string
 */
function formatTime(date) {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  
  let timeStr;
  
  if (is24HourFormat) {
    // 24-hour format: 14:30 or 14:30:45
    timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  } else {
    // 12-hour format without AM/PM: 2:30 or 2:30:45
    const displayHours = hours % 12 || 12;
    timeStr = `${displayHours}:${minutes.toString().padStart(2, '0')}`;
  }
  
  if (showSeconds) {
    timeStr += `:${seconds.toString().padStart(2, '0')}`;
  }
  
  return timeStr;
}

/**
 * Update the clock display with current time
 */
function updateClock() {
  const timeElement = getClockTimeElement();
  if (!timeElement) return;
  
  const now = new Date();
  timeElement.textContent = formatTime(now);
}

/**
 * Calculate delay until next update boundary
 * @returns {number} Milliseconds until next update
 */
function getDelayToNextUpdate() {
  const now = new Date();
  const milliseconds = now.getMilliseconds();
  
  if (showSeconds) {
    // Update every second - sync to second boundary
    return 1000 - milliseconds;
  } else {
    // Update every minute - sync to minute boundary
    const seconds = now.getSeconds();
    return (60 - seconds) * 1000 - milliseconds;
  }
}

/**
 * Start the clock update interval
 * Syncs updates to the second or minute boundary for accuracy
 */
function startClockInterval() {
  // Clear any existing interval and timeout
  stopClockInterval();
  
  // Update immediately
  updateClock();
  
  // Wait for next boundary, then update at the appropriate interval
  const delayToNext = getDelayToNextUpdate();
  const updateInterval = showSeconds ? 1000 : 60000;
  
  clockSyncTimeout = setTimeout(() => {
    clockSyncTimeout = null; // Clear reference after firing
    updateClock();
    clockInterval = setInterval(updateClock, updateInterval);
  }, delayToNext);
}

/**
 * Stop the clock update interval and any pending sync timeout
 */
function stopClockInterval() {
  if (clockSyncTimeout) {
    clearTimeout(clockSyncTimeout);
    clockSyncTimeout = null;
  }
  if (clockInterval) {
    clearInterval(clockInterval);
    clockInterval = null;
  }
}

/**
 * Get the clock wrapper element (inner wrapper containing the time)
 * @returns {HTMLElement|null}
 */
function getClockWrapper() {
  const container = getClockContainer();
  return container ? container.querySelector('.clock-wrapper') : null;
}

/**
 * Initialize the options menu for clock settings
 */
function initOptionsMenu() {
  const trigger = getClockOptionsTrigger();
  const wrapper = getClockWrapper();
  
  if (!trigger || !wrapper) return;
  
  // Destroy existing menu if any
  if (optionsMenu) {
    optionsMenu.destroy();
  }
  
  // Create options that read current state when menu is opened
  const getOptions = () => [
    {
      type: 'toggle',
      label: getMessage('clock24Hour') || '24-hour clock',
      checked: is24HourFormat,
      onChange: async (checked) => {
        is24HourFormat = checked;
        updateClock();
        // Save to storage
        await chrome.storage.sync.set({ clockFormat24Hour: checked });
      }
    },
    {
      type: 'toggle',
      label: getMessage('clockShowSeconds') || 'Show seconds',
      checked: showSeconds,
      onChange: async (checked) => {
        showSeconds = checked;
        updateClock();
        // Restart interval with new timing
        startClockInterval();
        // Save to storage
        await chrome.storage.sync.set({ clockShowSeconds: checked });
      }
    }
  ];
  
  optionsMenu = createOptionsMenu({
    triggerElement: trigger,
    anchorElement: wrapper,
    menuId: 'clock-options-menu',
    position: 'right',
    getOptions // Pass factory function instead of static options
  });
}

/**
 * Show the clock
 */
export function showClock() {
  const container = getClockContainer();
  if (!container) {
    log('Clock container not found');
    return;
  }
  
  container.classList.remove('hidden');
  isVisible = true;
  startClockInterval();
  initOptionsMenu();
  log('Clock shown');
}

/**
 * Hide the clock
 */
export function hideClock() {
  const container = getClockContainer();
  if (!container) return;
  
  container.classList.add('hidden');
  isVisible = false;
  stopClockInterval();
  
  if (optionsMenu) {
    optionsMenu.destroy();
    optionsMenu = null;
  }
  
  log('Clock hidden');
}

/**
 * Set the clock time format
 * @param {boolean} use24Hour - True for 24-hour format, false for 12-hour
 */
export function setClockFormat(use24Hour) {
  is24HourFormat = use24Hour;
  if (isVisible) {
    updateClock();
  }
}

/**
 * Set whether to show seconds
 * @param {boolean} show - True to show seconds
 */
export function setShowSeconds(show) {
  showSeconds = show;
  if (isVisible) {
    updateClock();
    startClockInterval(); // Restart with new interval
  }
}


/**
 * Initialize the clock from stored settings
 */
export async function initClock() {
  try {
    // Clean up existing listeners to prevent duplicates
    cleanupListeners();
    
    // Get clock settings from storage
    const result = await new Promise((resolve) => {
      chrome.storage.sync.get(['clockEnabled', 'clockFormat24Hour', 'clockShowSeconds'], resolve);
    });
    
    is24HourFormat = result.clockFormat24Hour || false;
    showSeconds = result.clockShowSeconds || false;
    
    if (result.clockEnabled) {
      showClock();
    }
    
    // Create and store storage change listener
    storageChangeListener = (changes, areaName) => {
      if (areaName !== 'sync') return;
      
      if (changes.clockEnabled) {
        if (changes.clockEnabled.newValue) {
          showClock();
        } else {
          hideClock();
        }
      }
      
      if (changes.clockFormat24Hour !== undefined) {
        setClockFormat(changes.clockFormat24Hour.newValue);
      }
      
      if (changes.clockShowSeconds !== undefined) {
        setShowSeconds(changes.clockShowSeconds.newValue);
      }
    };
    chrome.storage.onChanged.addListener(storageChangeListener);
    
    log('Clock initialized');
  } catch (error) {
    log('Error initializing clock: ' + error.message);
  }
}

/**
 * Clean up event listeners
 */
function cleanupListeners() {
  if (storageChangeListener) {
    chrome.storage.onChanged.removeListener(storageChangeListener);
    storageChangeListener = null;
  }
}

/**
 * Clean up clock resources
 */
export function destroyClock() {
  stopClockInterval();
  isVisible = false;
  
  if (optionsMenu) {
    optionsMenu.destroy();
    optionsMenu = null;
  }
  
  // Clean up event listeners
  cleanupListeners();
  
  log('Clock destroyed');
}

/**
 * Check if clock is currently visible
 * @returns {boolean}
 */
export function isClockVisible() {
  return isVisible;
}
