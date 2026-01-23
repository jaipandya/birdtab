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
 * Get the time components based on user preferences
 * @param {Date} date - The date to format
 * @returns {Object} Object containing mainTime (HH:MM) and seconds (SS or null)
 */
function getTimeComponents(date) {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const secs = date.getSeconds();

  let mainTime;

  if (is24HourFormat) {
    // 24-hour format: 14:30
    mainTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  } else {
    // 12-hour format without AM/PM: 2:30
    const displayHours = hours % 12 || 12;
    mainTime = `${displayHours}:${minutes.toString().padStart(2, '0')}`;
  }

  let secondsStr = null;
  if (showSeconds) {
    secondsStr = secs.toString().padStart(2, '0');
  }

  return { mainTime, secondsStr };
}

/**
 * Update the clock display with current time
 */
function updateClock() {
  const timeElement = getClockTimeElement();
  if (!timeElement) return;

  const now = new Date();
  const { mainTime, secondsStr } = getTimeComponents(now);

  if (secondsStr) {
    // Render with seconds: HH:MM<span class="clock-seconds">SS</span>
    // Note: No colon between main time and seconds as per requirements
    // Using innerHTML is safe here as the content is generated from numbers
    timeElement.innerHTML = `<span class="clock-main">${mainTime}</span><span class="clock-seconds">${secondsStr}</span>`;
  } else {
    // Render just HH:MM
    timeElement.textContent = mainTime;
  }
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
    },
    {
      type: 'divider'
    },
    {
      type: 'button',
      label: getMessage('switchToTimer') || 'Switch to Timer',
      onClick: async () => {
        // Hide clock time but keep container visible for timer
        hideClock(false);
        
        // Import and show timer
        const { showTimer } = await import('./timer.js');
        showTimer();
        
        // Update storage
        await chrome.storage.sync.set({ 
          clockEnabled: false, 
          timerEnabled: true 
        });
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
 * Get the timer display element
 * @returns {HTMLElement|null}
 */
function getTimerDisplay() {
  return document.getElementById('timer-display');
}

/**
 * Show the clock
 */
export function showClock() {
  const container = getClockContainer();
  const clockTime = getClockTimeElement();
  const timerDisplay = getTimerDisplay();
  
  if (!container) {
    log('Clock container not found');
    return;
  }

  // Show clock time, hide timer display
  if (clockTime) clockTime.classList.remove('hidden');
  if (timerDisplay) timerDisplay.classList.add('hidden');
  
  container.classList.remove('hidden');
  isVisible = true;
  // Add class to body for video play/pause button positioning
  document.body.classList.add('quick-access-has-clock');
  startClockInterval();
  initOptionsMenu();
  log('Clock shown');
}

/**
 * Hide the clock
 * @param {boolean} hideContainer - Whether to hide the entire container (default: true)
 */
export function hideClock(hideContainer = true) {
  const container = getClockContainer();
  const clockTime = getClockTimeElement();
  
  if (!container) return;

  // Always hide the clock time element
  if (clockTime) clockTime.classList.add('hidden');
  
  // Only hide the container if requested (not when switching to timer)
  if (hideContainer) {
    container.classList.add('hidden');
    // Remove class from body
    document.body.classList.remove('quick-access-has-clock');
  }
  
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
