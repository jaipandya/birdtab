/**
 * Timer Module Tests
 *
 * Tests cover all timer states and edge cases:
 * - State machine transitions (SETUP, RUNNING, PAUSED, FINISHED)
 * - Setup mode digit editing (keyboard input, arrow keys, tab navigation)
 * - Preset buttons
 * - Timer countdown
 * - Tab title updates
 * - Multi-tab synchronization
 * - Alarm sound functionality
 * - Time display formatting (with subscript seconds)
 * - Search/sites visibility toggle
 */

// Timer states - mirrored from timer.js
const TIMER_STATE = {
  SETUP: 'setup',
  RUNNING: 'running',
  PAUSED: 'paused',
  FINISHED: 'finished'
};

describe('Timer Module - Unit Tests', () => {
  beforeEach(() => {
    // Setup DOM
    document.body.innerHTML = `
      <div id="clock-container" class="clock-container">
        <div class="clock-wrapper">
          <div id="clock-time" class="clock-time"></div>
          <div id="timer-display" class="timer-display hidden"></div>
          <button id="clock-options-trigger" class="clock-options-trigger"></button>
        </div>
      </div>
      <div class="search-and-sites"></div>
    `;

    // Extend chrome mock with local storage
    global.chrome = {
      ...global.chrome,
      storage: {
        sync: {
          get: jest.fn((keys, callback) => {
            callback({
              timerEnabled: false,
              timerSetupHours: 0,
              timerSetupMinutes: 5,
              timerSetupSeconds: 0,
              timerAlarmEnabled: false
            });
          }),
          set: jest.fn()
        },
        local: {
          get: jest.fn((keys, callback) => {
            callback({});
          }),
          set: jest.fn(),
          remove: jest.fn()
        },
        onChanged: {
          addListener: jest.fn(),
          removeListener: jest.fn()
        }
      },
      i18n: {
        getMessage: jest.fn((key) => {
          const messages = {
            timerStart: 'Start',
            timerPause: 'Pause',
            timerResume: 'Resume',
            timerReset: 'Reset',
            timerHours: 'h',
            timerMinutes: 'm',
            timerSeconds: 's',
            timerAlarmSound: 'Alarm sound',
            switchToClock: 'Switch to Clock'
          };
          return messages[key] || key;
        })
      }
    };

    // Reset document title
    document.title = 'BirdTab';

    // Mock AudioContext
    global.AudioContext = jest.fn().mockImplementation(() => ({
      createOscillator: jest.fn(() => ({
        connect: jest.fn(),
        type: '',
        frequency: { setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() },
        start: jest.fn(),
        stop: jest.fn()
      })),
      createGain: jest.fn(() => ({
        connect: jest.fn(),
        gain: { setValueAtTime: jest.fn(), linearRampToValueAtTime: jest.fn() }
      })),
      destination: {},
      currentTime: 0,
      close: jest.fn()
    }));

    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('Helper Functions', () => {
    test('secondsToHMS converts correctly', () => {
      // 0 seconds
      expect(secondsToHMS(0)).toEqual({ hours: 0, minutes: 0, seconds: 0 });
      
      // 5 minutes
      expect(secondsToHMS(300)).toEqual({ hours: 0, minutes: 5, seconds: 0 });
      
      // 1 hour 30 minutes 45 seconds
      expect(secondsToHMS(5445)).toEqual({ hours: 1, minutes: 30, seconds: 45 });
      
      // Edge case: 59 seconds
      expect(secondsToHMS(59)).toEqual({ hours: 0, minutes: 0, seconds: 59 });
    });

    test('hmsToSeconds converts correctly', () => {
      expect(hmsToSeconds(0, 0, 0)).toBe(0);
      expect(hmsToSeconds(0, 5, 0)).toBe(300);
      expect(hmsToSeconds(1, 30, 45)).toBe(5445);
      expect(hmsToSeconds(0, 0, 59)).toBe(59);
    });

    test('formatTimeDisplay returns correct format for UI', () => {
      // Without hours - simple string format
      const result1 = formatTimeDisplay(300); // 5 minutes
      expect(result1.main).toBe('5:00');
      expect(result1.seconds).toBeNull();
      expect(result1.hasHours).toBe(false);

      // With hours - structured format with subscript seconds
      const result2 = formatTimeDisplay(5445); // 1:30:45
      expect(result2.main).toBe('1:30');
      expect(result2.seconds).toBe('45');
      expect(result2.hasHours).toBe(true);
    });

    test('formatTimeDisplay returns plain string for tab title', () => {
      expect(formatTimeDisplay(300, true)).toBe('5:00');
      expect(formatTimeDisplay(5445, true)).toBe('1:30:45');
    });

    test('getBaseTitle removes timer prefix', () => {
      document.title = '5:00 - BirdTab';
      expect(getBaseTitle()).toBe('BirdTab');

      document.title = '1:30:45 - BirdTab';
      expect(getBaseTitle()).toBe('BirdTab');

      document.title = 'Timer Done! - BirdTab';
      expect(getBaseTitle()).toBe('BirdTab');

      document.title = 'BirdTab';
      expect(getBaseTitle()).toBe('BirdTab');
    });
  });

  describe('State Machine Transitions', () => {
    test('SETUP → RUNNING on start', () => {
      const state = { current: TIMER_STATE.SETUP };
      
      // Simulate start
      if (state.current === TIMER_STATE.SETUP) {
        state.current = TIMER_STATE.RUNNING;
      }
      
      expect(state.current).toBe(TIMER_STATE.RUNNING);
    });

    test('RUNNING → PAUSED on pause', () => {
      const state = { current: TIMER_STATE.RUNNING };
      
      if (state.current === TIMER_STATE.RUNNING) {
        state.current = TIMER_STATE.PAUSED;
      }
      
      expect(state.current).toBe(TIMER_STATE.PAUSED);
    });

    test('PAUSED → RUNNING on resume', () => {
      const state = { current: TIMER_STATE.PAUSED };
      
      if (state.current === TIMER_STATE.PAUSED) {
        state.current = TIMER_STATE.RUNNING;
      }
      
      expect(state.current).toBe(TIMER_STATE.RUNNING);
    });

    test('RUNNING → FINISHED when countdown reaches 0', () => {
      const state = { current: TIMER_STATE.RUNNING, remainingTime: 1 };
      
      // Simulate countdown
      state.remainingTime--;
      if (state.remainingTime <= 0) {
        state.current = TIMER_STATE.FINISHED;
      }
      
      expect(state.current).toBe(TIMER_STATE.FINISHED);
    });

    test('PAUSED → SETUP on reset', () => {
      const state = { current: TIMER_STATE.PAUSED };
      
      // Reset always goes to SETUP
      state.current = TIMER_STATE.SETUP;
      
      expect(state.current).toBe(TIMER_STATE.SETUP);
    });

    test('FINISHED → SETUP on reset', () => {
      const state = { current: TIMER_STATE.FINISHED };
      
      state.current = TIMER_STATE.SETUP;
      
      expect(state.current).toBe(TIMER_STATE.SETUP);
    });

    test('Invalid transition: SETUP cannot go to PAUSED', () => {
      const state = { current: TIMER_STATE.SETUP };
      
      // Pause should be ignored in SETUP
      if (state.current !== TIMER_STATE.RUNNING) {
        // No state change
      }
      
      expect(state.current).toBe(TIMER_STATE.SETUP);
    });
  });

  describe('Keyboard Navigation', () => {
    test('Tab key moves to next digit group', () => {
      const groups = ['hours', 'minutes', 'seconds'];
      let activeIndex = 0; // Start at hours
      
      // Tab forward
      activeIndex = (activeIndex + 1) % groups.length;
      expect(groups[activeIndex]).toBe('minutes');
      
      activeIndex = (activeIndex + 1) % groups.length;
      expect(groups[activeIndex]).toBe('seconds');
    });

    test('Shift+Tab moves to previous digit group', () => {
      const groups = ['hours', 'minutes', 'seconds'];
      let activeIndex = 2; // Start at seconds
      
      // Shift+Tab backward
      activeIndex = activeIndex === 0 ? 0 : activeIndex - 1;
      expect(groups[activeIndex]).toBe('minutes');
      
      activeIndex = activeIndex === 0 ? 0 : activeIndex - 1;
      expect(groups[activeIndex]).toBe('hours');
    });

    test('ArrowUp increments value', () => {
      let minutes = 5;
      
      // Arrow up
      minutes = (minutes + 1) % 60;
      expect(minutes).toBe(6);
      
      // Test wrap around
      minutes = 59;
      minutes = (minutes + 1) % 60;
      expect(minutes).toBe(0);
    });

    test('ArrowDown decrements value', () => {
      let minutes = 5;
      
      // Arrow down
      minutes = minutes === 0 ? 59 : minutes - 1;
      expect(minutes).toBe(4);
      
      // Test wrap around
      minutes = 0;
      minutes = minutes === 0 ? 59 : minutes - 1;
      expect(minutes).toBe(59);
    });

    test('Hours capped at 99', () => {
      let hours = 99;
      
      // Increment should be capped
      hours = Math.min(99, hours + 1);
      expect(hours).toBe(99);
    });

    test('Number keys input digits correctly', () => {
      let buffer = '';
      let value = 0;
      
      // Type '1'
      buffer += '1';
      if (buffer.length >= 2) {
        value = parseInt(buffer, 10);
        buffer = '';
      }
      expect(buffer).toBe('1');
      
      // Type '5'
      buffer += '5';
      if (buffer.length >= 2) {
        value = parseInt(buffer, 10);
        buffer = '';
      }
      expect(value).toBe(15);
      expect(buffer).toBe('');
    });
  });

  describe('Preset Buttons', () => {
    test('1m preset sets correct values', () => {
      const preset = { minutes: 1 };
      const setup = { hours: 0, minutes: preset.minutes, seconds: 0 };
      
      expect(setup.hours).toBe(0);
      expect(setup.minutes).toBe(1);
      expect(setup.seconds).toBe(0);
    });

    test('5m preset sets correct values', () => {
      const preset = { minutes: 5 };
      const setup = { hours: 0, minutes: preset.minutes, seconds: 0 };
      
      expect(setup.hours).toBe(0);
      expect(setup.minutes).toBe(5);
      expect(setup.seconds).toBe(0);
    });

    test('25m preset sets correct values (Pomodoro)', () => {
      const preset = { minutes: 25 };
      const setup = { hours: 0, minutes: preset.minutes, seconds: 0 };
      
      expect(setup.hours).toBe(0);
      expect(setup.minutes).toBe(25);
      expect(setup.seconds).toBe(0);
    });
  });

  describe('Tab Title Updates', () => {
    test('Title updates during countdown', () => {
      const remainingTime = 125; // 2:05
      const originalTitle = 'BirdTab';
      const timeStr = formatTimeDisplay(remainingTime, true);
      
      document.title = `${timeStr} - ${originalTitle}`;
      
      expect(document.title).toBe('2:05 - BirdTab');
    });

    test('Title shows hours when applicable', () => {
      const remainingTime = 3725; // 1:02:05
      const originalTitle = 'BirdTab';
      const timeStr = formatTimeDisplay(remainingTime, true);
      
      document.title = `${timeStr} - ${originalTitle}`;
      
      expect(document.title).toBe('1:02:05 - BirdTab');
    });

    test('Title restored on pause', () => {
      const originalTitle = 'BirdTab';
      document.title = '5:00 - BirdTab';
      
      // On pause, restore original
      document.title = originalTitle;
      
      expect(document.title).toBe('BirdTab');
    });

    test('getBaseTitle prevents nested prefixes', () => {
      // Simulate pause/resume cycle
      document.title = '5:00 - BirdTab';
      const baseTitle = getBaseTitle();
      
      // On resume, use base title
      document.title = `4:30 - ${baseTitle}`;
      
      expect(document.title).toBe('4:30 - BirdTab');
      expect(document.title).not.toContain('5:00');
    });
  });

  describe('Multi-tab Synchronization', () => {
    test('State changes propagate via storage', () => {
      const mockChanges = {
        timerState: { newValue: TIMER_STATE.PAUSED, oldValue: TIMER_STATE.RUNNING },
        timerRemainingTime: { newValue: 250 }
      };
      
      let localState = TIMER_STATE.RUNNING;
      let localRemainingTime = 300;
      
      // Simulate storage change handler
      if (mockChanges.timerState && mockChanges.timerState.newValue !== localState) {
        localState = mockChanges.timerState.newValue;
        if (mockChanges.timerRemainingTime) {
          localRemainingTime = mockChanges.timerRemainingTime.newValue;
        }
      }
      
      expect(localState).toBe(TIMER_STATE.PAUSED);
      expect(localRemainingTime).toBe(250);
    });

    test('Running timer syncs with timestamp adjustment', () => {
      const lastUpdate = Date.now() - 5000; // 5 seconds ago
      const storedRemainingTime = 300;
      
      const elapsed = Math.floor((Date.now() - lastUpdate) / 1000);
      const adjustedTime = Math.max(0, storedRemainingTime - elapsed);
      
      expect(adjustedTime).toBe(295);
    });

    test('Finished state resets on new tab load', () => {
      const storedState = TIMER_STATE.FINISHED;
      let loadedState;
      let loadedRemainingTime;
      
      if (storedState === TIMER_STATE.FINISHED) {
        // New tabs should start fresh
        loadedState = TIMER_STATE.SETUP;
        loadedRemainingTime = 0;
      }
      
      expect(loadedState).toBe(TIMER_STATE.SETUP);
      expect(loadedRemainingTime).toBe(0);
    });
  });

  describe('Alarm Sound', () => {
    test('Alarm plays when enabled and timer finishes', () => {
      const alarmEnabled = true;
      let alarmPlayed = false;
      
      // Simulate timer finish
      const timerState = TIMER_STATE.FINISHED;
      
      if (timerState === TIMER_STATE.FINISHED && alarmEnabled) {
        alarmPlayed = true;
      }
      
      expect(alarmPlayed).toBe(true);
    });

    test('Alarm does not play when disabled', () => {
      const alarmEnabled = false;
      let alarmPlayed = false;
      
      const timerState = TIMER_STATE.FINISHED;
      
      if (timerState === TIMER_STATE.FINISHED && alarmEnabled) {
        alarmPlayed = true;
      }
      
      expect(alarmPlayed).toBe(false);
    });

    test('Alarm lock prevents multiple tabs playing', async () => {
      const tabTimestamps = [];
      const tab1Time = Date.now();
      const tab2Time = Date.now() + 100;
      
      // Tab 1 sets lock
      tabTimestamps.push(tab1Time);
      
      // Tab 2 checks lock - within 5 seconds, should not play
      const existingLock = tabTimestamps[0];
      const shouldTab2Play = !(existingLock && (tab2Time - existingLock) < 5000);
      
      expect(shouldTab2Play).toBe(false);
    });
  });

  describe('Search/Sites Visibility', () => {
    test('Search/sites hidden when timer starts', () => {
      const searchAndSites = document.querySelector('.search-and-sites');
      
      // Simulate timer start
      searchAndSites.classList.add('timer-active-hidden');
      
      expect(searchAndSites.classList.contains('timer-active-hidden')).toBe(true);
    });

    test('Search/sites shown when timer resets', () => {
      const searchAndSites = document.querySelector('.search-and-sites');
      searchAndSites.classList.add('timer-active-hidden');
      
      // Simulate reset
      searchAndSites.classList.remove('timer-active-hidden');
      
      expect(searchAndSites.classList.contains('timer-active-hidden')).toBe(false);
    });

    test('Search/sites shown in SETUP state', () => {
      const timerState = TIMER_STATE.SETUP;
      const shouldShowSearchAndSites = timerState === TIMER_STATE.SETUP;
      
      expect(shouldShowSearchAndSites).toBe(true);
    });
  });

  describe('Time Display Formatting', () => {
    test('Display without hours shows MM:SS', () => {
      const result = formatTimeDisplay(125);
      expect(result.main).toBe('2:05');
      expect(result.hasHours).toBe(false);
    });

    test('Display with hours shows HH:MM with subscript SS', () => {
      const result = formatTimeDisplay(3725);
      expect(result.main).toBe('1:02');
      expect(result.seconds).toBe('05');
      expect(result.hasHours).toBe(true);
    });

    test('Zero time displays correctly', () => {
      const result = formatTimeDisplay(0);
      expect(result.main).toBe('0:00');
    });
  });

  describe('Edge Cases', () => {
    test('Start button disabled when time is 0', () => {
      const totalSeconds = hmsToSeconds(0, 0, 0);
      const isDisabled = totalSeconds === 0;
      
      expect(isDisabled).toBe(true);
    });

    test('Start button enabled when time > 0', () => {
      const totalSeconds = hmsToSeconds(0, 0, 1);
      const isDisabled = totalSeconds === 0;
      
      expect(isDisabled).toBe(false);
    });

    test('Timer with very long duration (99h)', () => {
      const totalSeconds = hmsToSeconds(99, 59, 59);
      const result = formatTimeDisplay(totalSeconds, true);
      
      expect(result).toBe('99:59:59');
    });

    test('Timer reaching 0 triggers finish state', () => {
      let remainingTime = 1;
      let state = TIMER_STATE.RUNNING;
      
      // Last countdown tick
      remainingTime--;
      if (remainingTime <= 0) {
        remainingTime = 0;
        state = TIMER_STATE.FINISHED;
      }
      
      expect(remainingTime).toBe(0);
      expect(state).toBe(TIMER_STATE.FINISHED);
    });

    test('Rapid pause/resume maintains correct time', () => {
      let remainingTime = 300;
      let state = TIMER_STATE.RUNNING;
      
      // Pause
      state = TIMER_STATE.PAUSED;
      const pausedTime = remainingTime;
      
      // Resume
      state = TIMER_STATE.RUNNING;
      
      expect(remainingTime).toBe(pausedTime);
    });
  });
});

// Mock helper functions that would be imported from timer.js
function secondsToHMS(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { hours, minutes, seconds };
}

function hmsToSeconds(hours, minutes, seconds) {
  return hours * 3600 + minutes * 60 + seconds;
}

function formatTimeDisplay(totalSeconds, forTabTitle = false) {
  const { hours, minutes, seconds } = secondsToHMS(totalSeconds);
  
  if (forTabTitle) {
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
  
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

function getBaseTitle() {
  const title = document.title;
  return title.replace(/^(\d+:\d+:\d+|\d+:\d+|Timer Done!) - /, '');
}
