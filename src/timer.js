/**
 * Timer module for BirdTab
 * Displays a countdown timer as an alternative to the clock
 */

import { log } from './logger.js';
import { getMessage } from './i18n.js';
import { createOptionsMenu } from './optionsMenu.js';
import { trackFeature } from './analytics.js';

// Timer states
const TIMER_STATE = {
  SETUP: 'setup',
  RUNNING: 'running',
  PAUSED: 'paused',
  FINISHED: 'finished'
};

// Module state
let timerInterval = null;
let timerState = TIMER_STATE.SETUP;
let totalDuration = 5 * 60; // Default: 5 minutes in seconds
let remainingTime = totalDuration;
let isVisible = false;
let optionsMenu = null;
let storageChangeListener = null;
let originalTitle = '';
let activeDigitGroup = null; // 'hours' | 'minutes' | 'seconds' | null
let inputBuffer = '';

// Multi-tab sync flag to prevent infinite loops
let isReactingToStorageChange = false;

// Alarm state
let alarmAudio = null;
let alarmEnabled = false;
let alarmTimeout = null;
const ALARM_DURATION = 30000; // 30 seconds max

// Setup mode values (editable before starting)
let setupHours = 0;
let setupMinutes = 5;
let setupSeconds = 0;

/**
 * Get the clock container element (shared with clock)
 * @returns {HTMLElement|null}
 */
function getClockContainer() {
  return document.getElementById('clock-container');
}

/**
 * Get the timer display element
 * @returns {HTMLElement|null}
 */
function getTimerDisplay() {
  return document.getElementById('timer-display');
}

/**
 * Get the clock time element (to hide when timer is shown)
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
 * Get the clock wrapper element
 * @returns {HTMLElement|null}
 */
function getClockWrapper() {
  const container = getClockContainer();
  return container ? container.querySelector('.clock-wrapper') : null;
}

/**
 * Get the search and sites area element
 * @returns {HTMLElement|null}
 */
function getSearchAndSites() {
  const wrapper = document.getElementById('quick-access-wrapper');
  return wrapper ? wrapper.querySelector('.search-and-sites') : null;
}

/**
 * Hide the search box and top sites when timer is active (not in setup mode)
 */
function hideSearchAndSites() {
  const searchAndSites = getSearchAndSites();
  if (searchAndSites) {
    searchAndSites.classList.add('timer-active-hidden');
  }
}

/**
 * Show the search box and top sites when timer is in setup mode
 */
function showSearchAndSites() {
  const searchAndSites = getSearchAndSites();
  if (searchAndSites) {
    searchAndSites.classList.remove('timer-active-hidden');
  }
}

/**
 * Get the base page title by removing any timer prefix
 * This prevents nested prefixes like "5:00 - 4:30 - BirdTab"
 * @returns {string}
 */
function getBaseTitle() {
  const title = document.title;
  // Remove any existing timer prefix pattern like "X:XX - ", "X:XX:XX - ", or "Timer Done! - "
  return title.replace(/^(\d+:\d+:\d+|\d+:\d+|Timer Done!) - /, '');
}

/**
 * Convert seconds to hours, minutes, seconds
 * @param {number} totalSeconds 
 * @returns {{hours: number, minutes: number, seconds: number}}
 */
function secondsToHMS(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { hours, minutes, seconds };
}

/**
 * Convert hours, minutes, seconds to total seconds
 * @param {number} hours 
 * @param {number} minutes 
 * @param {number} seconds 
 * @returns {number}
 */
function hmsToSeconds(hours, minutes, seconds) {
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Format time for display (with leading zero suppression)
 * @param {number} totalSeconds 
 * @param {boolean} forTabTitle - If true, return plain string for tab title
 * @returns {string|{main: string, seconds: string|null, hasHours: boolean}}
 */
function formatTimeDisplay(totalSeconds, forTabTitle = false) {
  const { hours, minutes, seconds } = secondsToHMS(totalSeconds);
  
  // For tab title, always return plain string
  if (forTabTitle) {
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
  
  // For UI display, return structured data when hours are present
  // This allows clock-style seconds subscript rendering
  if (hours > 0) {
    return {
      main: `${hours}:${minutes.toString().padStart(2, '0')}`,
      seconds: seconds.toString().padStart(2, '0'),
      hasHours: true
    };
  }
  
  return {
    main: `${minutes}:${seconds.toString().padStart(2, '0')}`,
    seconds: null,
    hasHours: false
  };
}

/**
 * Render the time display HTML with optional subscript seconds
 * @param {number} totalSeconds
 * @returns {string}
 */
function renderTimeHTML(totalSeconds) {
  const timeDisplay = formatTimeDisplay(totalSeconds);
  
  if (timeDisplay.hasHours && timeDisplay.seconds) {
    // Clock-style rendering: main time with subscript seconds
    return `<span class="timer-time-main">${timeDisplay.main}</span><span class="timer-time-seconds">${timeDisplay.seconds}</span>`;
  }
  
  return timeDisplay.main;
}

/**
 * Create the setup mode UI HTML
 * @returns {string}
 */
function createSetupHTML() {
  const totalSeconds = hmsToSeconds(setupHours, setupMinutes, setupSeconds);
  const isDisabled = totalSeconds === 0;
  
  return `
    <div class="timer-setup">
      <div class="timer-input-row">
        <div class="timer-digit-group" data-group="hours" tabindex="0">
          <span class="timer-digits">${setupHours.toString().padStart(2, '0')}</span>
          <span class="timer-unit">${getMessage('timerHours') || 'h'}</span>
        </div>
        <div class="timer-digit-group" data-group="minutes" tabindex="0">
          <span class="timer-digits">${setupMinutes.toString().padStart(2, '0')}</span>
          <span class="timer-unit">${getMessage('timerMinutes') || 'm'}</span>
        </div>
        <div class="timer-digit-group" data-group="seconds" tabindex="0">
          <span class="timer-digits">${setupSeconds.toString().padStart(2, '0')}</span>
          <span class="timer-unit">${getMessage('timerSeconds') || 's'}</span>
        </div>
      </div>
      <div class="timer-presets">
        <button class="timer-preset-btn" data-minutes="1">1m</button>
        <button class="timer-preset-btn" data-minutes="5">5m</button>
        <button class="timer-preset-btn" data-minutes="25">25m</button>
      </div>
      <button class="timer-start-btn" ${isDisabled ? 'disabled' : ''}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z"/>
        </svg>
        ${getMessage('timerStart') || 'Start'}
      </button>
    </div>
  `;
}

/**
 * Create the running/paused mode UI HTML
 * @returns {string}
 */
function createRunningHTML() {
  const progress = totalDuration > 0 ? (remainingTime / totalDuration) * 100 : 0;
  const circumference = 2 * Math.PI * 120; // radius = 120
  const strokeDashoffset = circumference * (1 - progress / 100);
  const isPaused = timerState === TIMER_STATE.PAUSED;
  const isFinished = timerState === TIMER_STATE.FINISHED;
  
  return `
    <div class="timer-running ${isFinished ? 'timer-finished' : ''}">
      <div class="timer-progress-container">
        <svg class="timer-progress-ring" viewBox="0 0 260 260">
          <circle class="timer-progress-bg" cx="130" cy="130" r="120" />
          <circle 
            class="timer-progress-bar" 
            cx="130" 
            cy="130" 
            r="120"
            style="stroke-dasharray: ${circumference}; stroke-dashoffset: ${strokeDashoffset};"
          />
        </svg>
        <div class="timer-time ${isFinished ? 'timer-time-finished' : ''}">${renderTimeHTML(remainingTime)}</div>
      </div>
      <div class="timer-controls">
        ${!isFinished ? `
          <button class="timer-control-btn timer-pause-btn" data-action="${isPaused ? 'resume' : 'pause'}">
            ${isPaused ? `
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
              </svg>
              ${getMessage('timerResume') || 'Resume'}
            ` : `
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
              </svg>
              ${getMessage('timerPause') || 'Pause'}
            `}
          </button>
        ` : ''}
        <button class="timer-control-btn timer-reset-btn" data-action="reset">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
          </svg>
          ${getMessage('timerReset') || 'Reset'}
        </button>
      </div>
    </div>
  `;
}

/**
 * Render the timer UI based on current state
 */
function renderTimer() {
  const display = getTimerDisplay();
  if (!display) return;
  
  if (timerState === TIMER_STATE.SETUP) {
    display.innerHTML = createSetupHTML();
    attachSetupListeners();
  } else {
    display.innerHTML = createRunningHTML();
    attachRunningListeners();
  }
}

/**
 * Attach event listeners for setup mode
 */
function attachSetupListeners() {
  const display = getTimerDisplay();
  if (!display) return;
  
  // Digit group click handlers
  const digitGroups = display.querySelectorAll('.timer-digit-group');
  digitGroups.forEach(group => {
    group.addEventListener('click', () => selectDigitGroup(group.dataset.group));
    group.addEventListener('focus', () => selectDigitGroup(group.dataset.group));
    group.addEventListener('blur', (e) => {
      // Only deselect if focus is leaving all digit groups
      const relatedTarget = e.relatedTarget;
      if (!relatedTarget || !relatedTarget.classList.contains('timer-digit-group')) {
        deselectDigitGroup();
      }
    });
    group.addEventListener('keydown', handleDigitKeydown);
  });
  
  // Preset button handlers
  const presetBtns = display.querySelectorAll('.timer-preset-btn');
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const minutes = parseInt(btn.dataset.minutes, 10);
      setupHours = 0;
      setupMinutes = minutes;
      setupSeconds = 0;
      updateSetupDisplay();
    });
  });
  
  // Start button handler
  const startBtn = display.querySelector('.timer-start-btn');
  if (startBtn) {
    startBtn.addEventListener('click', startTimer);
  }
}

/**
 * Attach event listeners for running mode
 */
function attachRunningListeners() {
  const display = getTimerDisplay();
  if (!display) return;
  
  const pauseBtn = display.querySelector('.timer-pause-btn');
  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      const action = pauseBtn.dataset.action;
      if (action === 'pause') {
        pauseTimer();
      } else {
        resumeTimer();
      }
    });
  }
  
  const resetBtn = display.querySelector('.timer-reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', resetTimer);
  }

  // Allow clicking on the timer time display to toggle pause/resume
  const timeDisplay = display.querySelector('.timer-time');
  if (timeDisplay && timerState !== TIMER_STATE.FINISHED) {
    timeDisplay.style.cursor = 'pointer';
    timeDisplay.addEventListener('click', (e) => {
      e.stopPropagation();
      if (timerState === TIMER_STATE.RUNNING) {
        pauseTimer();
      } else if (timerState === TIMER_STATE.PAUSED) {
        resumeTimer();
      }
    });
  }
}

/**
 * Select a digit group for editing
 * @param {string} group - 'hours' | 'minutes' | 'seconds'
 */
function selectDigitGroup(group) {
  const display = getTimerDisplay();
  if (!display) return;
  
  // Remove active class from all groups
  display.querySelectorAll('.timer-digit-group').forEach(g => {
    g.classList.remove('active');
  });
  
  // Add active class to selected group
  const selectedGroup = display.querySelector(`[data-group="${group}"]`);
  if (selectedGroup) {
    selectedGroup.classList.add('active');
    selectedGroup.focus();
  }
  
  activeDigitGroup = group;
  inputBuffer = '';
}

/**
 * Deselect current digit group
 */
function deselectDigitGroup() {
  const display = getTimerDisplay();
  if (!display) return;
  
  display.querySelectorAll('.timer-digit-group').forEach(g => {
    g.classList.remove('active');
  });
  
  activeDigitGroup = null;
  inputBuffer = '';
}

/**
 * Handle keydown events on digit groups
 * @param {KeyboardEvent} e 
 */
function handleDigitKeydown(e) {
  if (!activeDigitGroup) return;
  
  const key = e.key;
  
  // Handle number input
  if (/^[0-9]$/.test(key)) {
    e.preventDefault();
    inputBuffer += key;
    
    // Limit buffer to 2 digits
    if (inputBuffer.length > 2) {
      inputBuffer = inputBuffer.slice(-2);
    }
    
    let value = parseInt(inputBuffer, 10);
    
    // Validate and apply value
    if (activeDigitGroup === 'hours') {
      value = Math.min(99, value);
      setupHours = value;
    } else if (activeDigitGroup === 'minutes') {
      value = Math.min(59, value);
      setupMinutes = value;
    } else if (activeDigitGroup === 'seconds') {
      value = Math.min(59, value);
      setupSeconds = value;
    }
    
    updateSetupDisplay();
    
    // Auto-advance after 2 digits
    if (inputBuffer.length >= 2) {
      advanceToNextGroup();
    }
    return;
  }
  
  // Handle backspace
  if (key === 'Backspace') {
    e.preventDefault();
    if (inputBuffer.length > 0) {
      inputBuffer = inputBuffer.slice(0, -1);
    }
    
    // Clear current group value
    if (activeDigitGroup === 'hours') {
      setupHours = inputBuffer.length > 0 ? parseInt(inputBuffer, 10) : 0;
    } else if (activeDigitGroup === 'minutes') {
      setupMinutes = inputBuffer.length > 0 ? parseInt(inputBuffer, 10) : 0;
    } else if (activeDigitGroup === 'seconds') {
      setupSeconds = inputBuffer.length > 0 ? parseInt(inputBuffer, 10) : 0;
    }
    
    updateSetupDisplay();
    return;
  }
  
  // Handle Tab navigation (with Shift+Tab for backwards)
  if (key === 'Tab') {
    e.preventDefault();
    if (e.shiftKey) {
      advanceToPrevGroup();
    } else {
      advanceToNextGroup();
    }
    return;
  }
  
  // Handle Arrow key navigation
  if (key === 'ArrowRight') {
    e.preventDefault();
    advanceToNextGroup();
    return;
  }
  
  if (key === 'ArrowLeft') {
    e.preventDefault();
    advanceToPrevGroup();
    return;
  }
  
  // Handle ArrowUp/ArrowDown for increment/decrement
  if (key === 'ArrowUp') {
    e.preventDefault();
    incrementActiveGroup();
    return;
  }
  
  if (key === 'ArrowDown') {
    e.preventDefault();
    decrementActiveGroup();
    return;
  }
  
  // Handle Enter to start
  if (key === 'Enter') {
    e.preventDefault();
    const totalSeconds = hmsToSeconds(setupHours, setupMinutes, setupSeconds);
    if (totalSeconds > 0) {
      startTimer();
    }
    return;
  }
  
  // Handle Escape to deselect
  if (key === 'Escape') {
    e.preventDefault();
    deselectDigitGroup();
    return;
  }
}

/**
 * Advance to the next digit group
 */
function advanceToNextGroup() {
  if (activeDigitGroup === 'hours') {
    selectDigitGroup('minutes');
  } else if (activeDigitGroup === 'minutes') {
    selectDigitGroup('seconds');
  } else {
    // Optionally wrap around or stay
    deselectDigitGroup();
  }
}

/**
 * Advance to the previous digit group
 */
function advanceToPrevGroup() {
  if (activeDigitGroup === 'seconds') {
    selectDigitGroup('minutes');
  } else if (activeDigitGroup === 'minutes') {
    selectDigitGroup('hours');
  }
}

/**
 * Increment the currently active digit group
 */
function incrementActiveGroup() {
  if (!activeDigitGroup) return;
  
  if (activeDigitGroup === 'hours') {
    setupHours = Math.min(99, setupHours + 1);
  } else if (activeDigitGroup === 'minutes') {
    setupMinutes = (setupMinutes + 1) % 60;
  } else if (activeDigitGroup === 'seconds') {
    setupSeconds = (setupSeconds + 1) % 60;
  }
  inputBuffer = ''; // Clear buffer on arrow key
  updateSetupDisplay();
}

/**
 * Decrement the currently active digit group
 */
function decrementActiveGroup() {
  if (!activeDigitGroup) return;
  
  if (activeDigitGroup === 'hours') {
    setupHours = Math.max(0, setupHours - 1);
  } else if (activeDigitGroup === 'minutes') {
    setupMinutes = setupMinutes === 0 ? 59 : setupMinutes - 1;
  } else if (activeDigitGroup === 'seconds') {
    setupSeconds = setupSeconds === 0 ? 59 : setupSeconds - 1;
  }
  inputBuffer = ''; // Clear buffer on arrow key
  updateSetupDisplay();
}

/**
 * Update the setup display with current values
 */
function updateSetupDisplay() {
  const display = getTimerDisplay();
  if (!display) return;
  
  const hoursDigits = display.querySelector('[data-group="hours"] .timer-digits');
  const minutesDigits = display.querySelector('[data-group="minutes"] .timer-digits');
  const secondsDigits = display.querySelector('[data-group="seconds"] .timer-digits');
  
  if (hoursDigits) hoursDigits.textContent = setupHours.toString().padStart(2, '0');
  if (minutesDigits) minutesDigits.textContent = setupMinutes.toString().padStart(2, '0');
  if (secondsDigits) secondsDigits.textContent = setupSeconds.toString().padStart(2, '0');
  
  // Update start button state
  const startBtn = display.querySelector('.timer-start-btn');
  if (startBtn) {
    const totalSeconds = hmsToSeconds(setupHours, setupMinutes, setupSeconds);
    startBtn.disabled = totalSeconds === 0;
  }
  
  // Save setup values to storage
  saveTimerSettings();
}

/**
 * Start the timer
 */
function startTimer() {
  totalDuration = hmsToSeconds(setupHours, setupMinutes, setupSeconds);
  if (totalDuration === 0) return;
  
  remainingTime = totalDuration;
  timerState = TIMER_STATE.RUNNING;
  
  // Store original title (use getBaseTitle to avoid nested prefixes)
  originalTitle = getBaseTitle();
  
  // Hide search and sites when timer is active
  hideSearchAndSites();
  
  // Start the countdown
  startCountdown();
  
  // Render running UI
  renderTimer();
  
  // Save state
  saveTimerState();
  
  // Track timer start with exact duration for analytics
  trackFeature('timer_start', {
    duration_seconds: totalDuration
  });
  
  log('Timer started');
}

/**
 * Pause the timer
 */
function pauseTimer() {
  if (timerState !== TIMER_STATE.RUNNING) return;
  
  timerState = TIMER_STATE.PAUSED;
  stopCountdown();
  
  // Restore original title when paused
  document.title = originalTitle;
  
  renderTimer();
  saveTimerState();
  
  log('Timer paused');
}

/**
 * Resume the timer
 */
function resumeTimer() {
  if (timerState !== TIMER_STATE.PAUSED) return;
  
  timerState = TIMER_STATE.RUNNING;
  startCountdown();
  
  renderTimer();
  saveTimerState();
  
  log('Timer resumed');
}

/**
 * Reset the timer to setup mode
 */
function resetTimer() {
  stopCountdown();
  
  // Stop alarm if playing
  stopAlarm();
  
  timerState = TIMER_STATE.SETUP;
  remainingTime = totalDuration;
  
  // Restore original title
  document.title = originalTitle;
  
  // Show search and sites again in setup mode
  showSearchAndSites();
  
  renderTimer();
  saveTimerState();
  
  log('Timer reset');
}

/**
 * Start the countdown interval
 */
function startCountdown() {
  // Clear any existing interval
  stopCountdown();
  
  // Update immediately
  updateCountdown();
  
  // Start interval
  timerInterval = setInterval(() => {
    updateCountdown();
  }, 1000);
}

/**
 * Stop the countdown interval
 */
function stopCountdown() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

/**
 * Update the countdown (called every second)
 */
function updateCountdown() {
  if (timerState !== TIMER_STATE.RUNNING) return;
  
  remainingTime--;
  
  // Update display
  updateRunningDisplay();
  
  // Update tab title
  updateTabTitle();
  
  // Check if finished
  if (remainingTime <= 0) {
    remainingTime = 0;
    timerState = TIMER_STATE.FINISHED;
    stopCountdown();
    renderTimer();
    
    // Flash the title
    flashTabTitle();
    
    // Play alarm sound (if enabled)
    playAlarm();

    log('Timer finished');
  }
  
  // Save state periodically
  saveTimerState();
}

/**
 * Update the running display without full re-render
 */
function updateRunningDisplay() {
  const display = getTimerDisplay();
  if (!display) return;
  
  const timeElement = display.querySelector('.timer-time');
  if (timeElement) {
    // Use innerHTML to support the clock-style subscript seconds
    timeElement.innerHTML = renderTimeHTML(remainingTime);
  }
  
  // Update progress ring
  const progressBar = display.querySelector('.timer-progress-bar');
  if (progressBar && totalDuration > 0) {
    const progress = (remainingTime / totalDuration) * 100;
    const circumference = 2 * Math.PI * 120;
    const strokeDashoffset = circumference * (1 - progress / 100);
    progressBar.style.strokeDashoffset = strokeDashoffset;
  }
}

/**
 * Update the browser tab title with timer
 */
function updateTabTitle() {
  // Only update title if timer is visible and running
  if (timerState === TIMER_STATE.RUNNING && isVisible) {
    const timeStr = formatTimeDisplay(remainingTime, true);
    document.title = `${timeStr} - ${originalTitle}`;
  }
}

/**
 * Flash the tab title when finished
 */
function flashTabTitle() {
  // Only flash if timer is visible
  if (!isVisible) return;
  
  let flashCount = 0;
  const flashInterval = setInterval(() => {
    if (flashCount >= 10 || timerState !== TIMER_STATE.FINISHED || !isVisible) {
      clearInterval(flashInterval);
      if (timerState === TIMER_STATE.FINISHED && isVisible) {
        document.title = `0:00 - ${originalTitle}`;
      }
      return;
    }
    
    if (flashCount % 2 === 0) {
      document.title = `Timer Done! - ${originalTitle}`;
    } else {
      document.title = `0:00 - ${originalTitle}`;
    }
    
    flashCount++;
  }, 500);
}

// Pre-defined chirp pattern for bird-like alarm (static, computed once)
const ALARM_CHIRP_PATTERN = Object.freeze([
  // First chirp sequence
  { time: 0, freq: 1200 },
  { time: 0.3, freq: 1400 },
  { time: 0.5, freq: 1100 },
  // Pause
  // Second chirp sequence
  { time: 1.5, freq: 1300 },
  { time: 1.8, freq: 1500 },
  { time: 2.0, freq: 1200 },
]);
const ALARM_PATTERN_DURATION = 3; // seconds per pattern cycle
const ALARM_REPEAT_COUNT = 5;

// Shared gain node for master volume control (reused across chirps)
let alarmMasterGain = null;

/**
 * Create a gentle bird-like alarm sound using AudioContext
 * @returns {AudioContext|null}
 */
function createAlarmSound() {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Create a master gain node for efficient volume control and cleanup
    alarmMasterGain = audioContext.createGain();
    alarmMasterGain.connect(audioContext.destination);
    alarmMasterGain.gain.value = 1;
    
    return audioContext;
  } catch (error) {
    log('Error creating audio context: ' + error.message);
    return null;
  }
}

/**
 * Play a gentle bird chirp sound
 * Uses a shared gain node for efficiency
 * @param {AudioContext} audioContext
 * @param {number} startTime - When to start the chirp
 * @param {number} frequency - Base frequency
 */
function playChirp(audioContext, startTime, frequency) {
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  // Connect through master gain for efficient global control
  oscillator.connect(gainNode);
  gainNode.connect(alarmMasterGain);
  
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, startTime);
  oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.5, startTime + 0.1);
  oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.8, startTime + 0.2);
  
  gainNode.gain.setValueAtTime(0, startTime);
  gainNode.gain.linearRampToValueAtTime(0.15, startTime + 0.05);
  gainNode.gain.linearRampToValueAtTime(0.1, startTime + 0.15);
  gainNode.gain.linearRampToValueAtTime(0, startTime + 0.25);
  
  oscillator.start(startTime);
  oscillator.stop(startTime + 0.25);
  
  // Oscillators auto-disconnect after stopping, no need to track them
}

/**
 * Play the timer alarm sound
 * Uses a lock mechanism to ensure only one tab plays the alarm
 */
async function playAlarm() {
  if (!alarmEnabled) {
    log('Alarm is disabled, skipping');
    return;
  }
  
  // Try to acquire the alarm lock
  const lockTimestamp = Date.now();
  try {
    // Check if another tab is already playing
    const result = await new Promise(resolve => {
      chrome.storage.local.get(['timerAlarmPlayingTab'], resolve);
    });
    
    // If another tab started playing within the last 5 seconds, don't play
    if (result.timerAlarmPlayingTab && (lockTimestamp - result.timerAlarmPlayingTab) < 5000) {
      log('Another tab is playing the alarm, skipping');
      return;
    }
    
    // Set our lock
    await chrome.storage.local.set({ timerAlarmPlayingTab: lockTimestamp });
    
    // Small delay to handle race conditions
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Verify we still have the lock
    const verifyResult = await new Promise(resolve => {
      chrome.storage.local.get(['timerAlarmPlayingTab'], resolve);
    });
    
    if (verifyResult.timerAlarmPlayingTab !== lockTimestamp) {
      log('Lost alarm lock to another tab, skipping');
      return;
    }
  } catch (error) {
    log('Error acquiring alarm lock: ' + error.message);
    return;
  }
  
  log('Playing alarm sound');
  
  // Create audio context
  alarmAudio = createAlarmSound();
  if (!alarmAudio) return;
  
  // Schedule all chirps using pre-defined pattern
  const currentTime = alarmAudio.currentTime;
  for (let repeat = 0; repeat < ALARM_REPEAT_COUNT; repeat++) {
    const offset = repeat * ALARM_PATTERN_DURATION;
    for (let i = 0; i < ALARM_CHIRP_PATTERN.length; i++) {
      const chirp = ALARM_CHIRP_PATTERN[i];
      playChirp(alarmAudio, currentTime + offset + chirp.time, chirp.freq);
    }
  }
  
  // Auto-stop after ALARM_DURATION
  alarmTimeout = setTimeout(() => {
    stopAlarm();
  }, ALARM_DURATION);
}

/**
 * Stop the alarm sound
 */
export async function stopAlarm() {
  if (alarmTimeout) {
    clearTimeout(alarmTimeout);
    alarmTimeout = null;
  }
  
  // Instantly silence by setting master gain to 0
  // This is more efficient than stopping individual oscillators
  if (alarmMasterGain) {
    try {
      alarmMasterGain.gain.setValueAtTime(0, alarmAudio ? alarmAudio.currentTime : 0);
    } catch (error) {
      // Ignore errors if context is already closed
    }
    alarmMasterGain = null;
  }
  
  if (alarmAudio) {
    try {
      alarmAudio.close();
    } catch (error) {
      // Ignore errors when closing
    }
    alarmAudio = null;
  }
  
  // Release the alarm lock
  try {
    await chrome.storage.local.remove(['timerAlarmPlayingTab']);
  } catch (error) {
    log('Error releasing alarm lock: ' + error.message);
  }
  
  log('Alarm stopped');
}

/**
 * Handle storage state changes from other tabs
 * @param {Object} changes - Chrome storage changes object
 */
function handleStorageStateChange(changes) {
  if (!changes.timerState && !changes.timerRemainingTime && !changes.timerLastUpdate) {
    return; // No relevant changes
  }
  
  const newState = changes.timerState?.newValue;
  const newRemainingTime = changes.timerRemainingTime?.newValue;
  const newTotalDuration = changes.timerTotalDuration?.newValue;
  const lastUpdate = changes.timerLastUpdate?.newValue;
  
  log(`Multi-tab sync: received state change - ${newState}`);
  
  // Handle state transitions from other tabs
  if (newState && newState !== timerState) {
    isReactingToStorageChange = true;
    
    if (newState === TIMER_STATE.SETUP) {
      // Another tab reset the timer
      stopCountdown();
      timerState = TIMER_STATE.SETUP;
      
      // Restore original title
      document.title = originalTitle || getBaseTitle();
      
      // Show search and sites
      showSearchAndSites();
      
      renderTimer();
    } else if (newState === TIMER_STATE.RUNNING) {
      // Another tab started or resumed the timer
      if (newTotalDuration !== undefined) {
        totalDuration = newTotalDuration;
      }
      
      // Calculate remaining time based on when state was updated
      if (lastUpdate && newRemainingTime !== undefined) {
        const elapsed = Math.floor((Date.now() - lastUpdate) / 1000);
        remainingTime = Math.max(0, newRemainingTime - elapsed);
      } else if (newRemainingTime !== undefined) {
        remainingTime = newRemainingTime;
      }
      
      timerState = TIMER_STATE.RUNNING;
      
      // Hide search and sites
      hideSearchAndSites();
      
      // Start countdown if not already running
      if (!timerInterval) {
        startCountdown();
      }
      
      renderTimer();
      updateTabTitle();
    } else if (newState === TIMER_STATE.PAUSED) {
      // Another tab paused the timer
      stopCountdown();
      timerState = TIMER_STATE.PAUSED;
      
      if (newRemainingTime !== undefined) {
        remainingTime = newRemainingTime;
      }
      
      // Restore original title when paused
      document.title = originalTitle || getBaseTitle();
      
      renderTimer();
    } else if (newState === TIMER_STATE.FINISHED) {
      // Another tab's timer finished
      stopCountdown();
      timerState = TIMER_STATE.FINISHED;
      remainingTime = 0;
      
      renderTimer();
      flashTabTitle();
    }
    
    isReactingToStorageChange = false;
  } else if (newState === TIMER_STATE.RUNNING && newRemainingTime !== undefined) {
    // Timer is running, sync the remaining time (for minor corrections)
    if (lastUpdate) {
      const elapsed = Math.floor((Date.now() - lastUpdate) / 1000);
      const calculatedRemaining = Math.max(0, newRemainingTime - elapsed);
      
      // Only sync if there's a significant difference (> 2 seconds)
      if (Math.abs(calculatedRemaining - remainingTime) > 2) {
        remainingTime = calculatedRemaining;
        updateRunningDisplay();
      }
    }
  }
}

/**
 * Save timer settings to storage
 */
async function saveTimerSettings() {
  try {
    await chrome.storage.sync.set({
      timerSetupHours: setupHours,
      timerSetupMinutes: setupMinutes,
      timerSetupSeconds: setupSeconds
    });
  } catch (error) {
    log('Error saving timer settings: ' + error.message);
  }
}

/**
 * Save timer state to storage (for persistence across refreshes)
 */
async function saveTimerState() {
  // Skip saving when reacting to storage changes to prevent infinite loops
  if (isReactingToStorageChange) {
    return;
  }
  
  try {
    await chrome.storage.local.set({
      timerState: timerState,
      timerRemainingTime: remainingTime,
      timerTotalDuration: totalDuration,
      timerLastUpdate: Date.now()
    });
  } catch (error) {
    log('Error saving timer state: ' + error.message);
  }
}

/**
 * Load timer state from storage
 */
async function loadTimerState() {
  try {
    const [syncResult, localResult] = await Promise.all([
      new Promise(resolve => {
        chrome.storage.sync.get([
          'timerSetupHours',
          'timerSetupMinutes',
          'timerSetupSeconds',
          'timerAlarmEnabled'
        ], resolve);
      }),
      new Promise(resolve => {
        chrome.storage.local.get([
          'timerState',
          'timerRemainingTime',
          'timerTotalDuration',
          'timerLastUpdate'
        ], resolve);
      })
    ]);

    // Load setup values
    if (syncResult.timerSetupHours !== undefined) setupHours = syncResult.timerSetupHours;
    if (syncResult.timerSetupMinutes !== undefined) setupMinutes = syncResult.timerSetupMinutes;
    if (syncResult.timerSetupSeconds !== undefined) setupSeconds = syncResult.timerSetupSeconds;

    // Load alarm setting (defaults to false)
    alarmEnabled = syncResult.timerAlarmEnabled || false;

    // Load running state if any
    if (localResult.timerState && localResult.timerState !== TIMER_STATE.SETUP) {
      // Check if the timer was running and calculate elapsed time
      if (localResult.timerState === TIMER_STATE.RUNNING && localResult.timerLastUpdate) {
        const elapsed = Math.floor((Date.now() - localResult.timerLastUpdate) / 1000);
        remainingTime = Math.max(0, localResult.timerRemainingTime - elapsed);

        if (remainingTime <= 0) {
          // Timer finished while tab was closed - reset to setup mode for new tabs
          timerState = TIMER_STATE.SETUP;
          remainingTime = 0;
        } else {
          timerState = TIMER_STATE.RUNNING;
        }
      } else if (localResult.timerState === TIMER_STATE.PAUSED) {
        timerState = TIMER_STATE.PAUSED;
        remainingTime = localResult.timerRemainingTime || 0;
      } else if (localResult.timerState === TIMER_STATE.FINISHED) {
        // Don't restore finished state on new tabs - reset to setup mode
        timerState = TIMER_STATE.SETUP;
        remainingTime = 0;
      } else {
        timerState = localResult.timerState;
        remainingTime = localResult.timerRemainingTime || 0;
      }

      totalDuration = localResult.timerTotalDuration || totalDuration;
    }

    // No return value needed - visibility is controlled by script.js based on clockDisplayMode
  } catch (error) {
    log('Error loading timer state: ' + error.message);
  }
}

/**
 * Initialize the options menu for timer settings
 */
function initOptionsMenu() {
  const trigger = getClockOptionsTrigger();
  const wrapper = getClockWrapper();

  if (!trigger || !wrapper) return;

  // Destroy existing menu if any
  if (optionsMenu) {
    optionsMenu.destroy();
  }

  // Create options for timer mode
  const getOptions = () => [
    {
      type: 'toggle',
      label: getMessage('timerAlarmSound') || 'Alarm sound',
      checked: alarmEnabled,
      onChange: async (checked) => {
        alarmEnabled = checked;
        await chrome.storage.sync.set({ timerAlarmEnabled: checked });
      }
    },
    {
      type: 'divider'
    },
    {
      type: 'button',
      label: getMessage('switchToClock') || 'Switch to Clock',
      icon: 'images/svg/clock.svg',
      onClick: async () => {
        // Stop timer if running
        if (timerState === TIMER_STATE.RUNNING) {
          pauseTimer();
        }

        // Stop alarm if playing
        stopAlarm();

        // Hide timer, show clock
        hideTimer();

        // Import and show clock
        const { showClock } = await import('./clock.js');
        showClock();

        // Update storage - use new clockDisplayMode enum
        await chrome.storage.sync.set({
          clockDisplayMode: 'clock'
        });
      }
    }
  ];

  optionsMenu = createOptionsMenu({
    triggerElement: trigger,
    anchorElement: wrapper,
    menuId: 'timer-options-menu',
    position: 'right',
    getOptions
  });
}

/**
 * Show the timer
 */
export function showTimer() {
  const container = getClockContainer();
  const timerDisplay = getTimerDisplay();
  const clockTime = getClockTimeElement();
  
  if (!container || !timerDisplay) {
    log('Timer display not found');
    return;
  }

  // Hide clock time, show timer
  if (clockTime) clockTime.classList.add('hidden');
  timerDisplay.classList.remove('hidden');
  container.classList.remove('hidden');
  
  // Update options trigger aria-label for timer mode
  const optionsTrigger = getClockOptionsTrigger();
  if (optionsTrigger) {
    optionsTrigger.setAttribute('aria-label', 
      chrome.i18n.getMessage('timerOptionsAriaLabel') || 'Timer options'
    );
  }
  
  isVisible = true;
  
  // Add class to body for positioning (clock area visible)
  document.body.classList.add('quick-access-has-clock');
  
  // Add timer-active class for video play button positioning
  // This ensures the play button is shifted down to avoid the timer display
  document.body.classList.add('timer-active');
  
  // Store original title (use getBaseTitle to avoid nested prefixes)
  originalTitle = getBaseTitle();
  
  // Hide search and sites if timer is not in setup mode
  if (timerState !== TIMER_STATE.SETUP) {
    hideSearchAndSites();
  } else {
    showSearchAndSites();
  }
  
  // Render the timer
  renderTimer();
  
  // If timer was running, resume countdown
  if (timerState === TIMER_STATE.RUNNING) {
    startCountdown();
  }
  
  // Initialize options menu
  initOptionsMenu();
  
  log('Timer shown');
}

/**
 * Hide the timer
 */
export function hideTimer() {
  const container = getClockContainer();
  const timerDisplay = getTimerDisplay();
  
  if (!timerDisplay) return;
  
  timerDisplay.classList.add('hidden');
  
  // Don't hide container - clock might use it
  isVisible = false;
  
  // Restore options trigger aria-label for clock mode
  const optionsTrigger = getClockOptionsTrigger();
  if (optionsTrigger) {
    optionsTrigger.setAttribute('aria-label', 
      chrome.i18n.getMessage('clockOptionsAriaLabel') || 'Clock options'
    );
  }
  
  // Stop countdown if running
  stopCountdown();
  
  // Stop alarm if playing
  stopAlarm();
  
  // Restore original title
  if (originalTitle) {
    document.title = originalTitle;
  } else {
    // Fallback: use getBaseTitle to clean up any timer prefix
    document.title = getBaseTitle();
  }
  
  // Show search and sites again
  showSearchAndSites();
  
  // Remove timer-active class - play button can go back to normal position
  document.body.classList.remove('timer-active');
  
  if (optionsMenu) {
    optionsMenu.destroy();
    optionsMenu = null;
  }
  
  log('Timer hidden');
}

/**
 * Initialize the timer from stored settings
 */
export async function initTimer() {
  try {
    // Clean up existing listeners
    cleanupListeners();

    // Load state from storage (visibility is handled by script.js)
    await loadTimerState();

    // Note: showTimer() is called by script.js based on clockDisplayMode
    // We no longer check timerEnabled here

    // Create and store storage change listener
    storageChangeListener = (changes, areaName) => {
      // Handle sync storage changes
      if (areaName === 'sync') {
        // Handle alarm setting changes
        if (changes.timerAlarmEnabled !== undefined) {
          alarmEnabled = changes.timerAlarmEnabled.newValue;
        }
      }

      // Handle local storage changes (timer state sync across tabs)
      if (areaName === 'local' && isVisible && !isReactingToStorageChange) {
        handleStorageStateChange(changes);
      }
    };
    chrome.storage.onChanged.addListener(storageChangeListener);

    log('Timer initialized');
  } catch (error) {
    log('Error initializing timer: ' + error.message);
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
 * Clean up timer resources
 */
export function destroyTimer() {
  stopCountdown();
  isVisible = false;
  
  // Restore original title
  if (originalTitle) {
    document.title = originalTitle;
  }
  
  if (optionsMenu) {
    optionsMenu.destroy();
    optionsMenu = null;
  }
  
  cleanupListeners();
  
  log('Timer destroyed');
}

/**
 * Check if timer is currently visible
 * @returns {boolean}
 */
export function isTimerVisible() {
  return isVisible;
}

/**
 * Get current timer state (for external use)
 * @returns {string}
 */
export function getTimerState() {
  return timerState;
}
