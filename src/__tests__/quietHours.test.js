/**
 * Quiet hours: which hours are quiet for a schedule, the stored schedule's defaults, and how the
 * hours are written in each UI language.
 */

import {
  isWithinQuietHours,
  quietHoursFrom,
  isQuietHoursActive,
  formatQuietHours,
  hourFormatter,
  formatHour,
} from '../quietHours.js';

describe('isWithinQuietHours', () => {
  const quiet = (start, end) => [...Array(24).keys()].filter(hour => isWithinQuietHours(hour, start, end));

  test('a window past midnight: 8 PM to 8 AM', () => {
    expect(quiet(20, 8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 20, 21, 22, 23]);
  });

  test('a window within the day: 1 PM to 3 PM', () => {
    expect(quiet(13, 15)).toEqual([13, 14]);
  });

  test('ending at midnight', () => {
    expect(quiet(22, 0)).toEqual([22, 23]);
  });

  test('the end hour is no longer quiet', () => {
    expect(isWithinQuietHours(8, 20, 8)).toBe(false);
    expect(isWithinQuietHours(7, 20, 8)).toBe(true);
  });

  test('start equal to end is never quiet (the settings rule it out)', () => {
    expect(quiet(9, 9)).toEqual([]);
  });
});

describe('quietHoursFrom', () => {
  test('defaults to off, 8 PM to 8 AM', () => {
    expect(quietHoursFrom({})).toEqual({ enabled: false, start: 20, end: 8, use24Hour: false });
  });

  test('reads the stored hours', () => {
    expect(quietHoursFrom({ quietHours: true, quietHoursStart: 22, quietHoursEnd: 6, clockFormat24Hour: true }))
      .toEqual({ enabled: true, start: 22, end: 6, use24Hour: true });
  });

  test('ignores hours that are not whole hours of the day', () => {
    const { start, end } = quietHoursFrom({ quietHoursStart: 24, quietHoursEnd: '7' });
    expect([start, end]).toEqual([20, 8]);
  });
});

describe('isQuietHoursActive', () => {
  let stored;
  beforeEach(() => {
    stored = {};
    chrome.storage.local = { get: jest.fn(async () => stored) };
    jest.useFakeTimers().setSystemTime(new Date(2026, 9, 20, 23, 30));
  });
  afterEach(() => {
    jest.useRealTimers();
    delete chrome.storage.local;
  });

  test('off by default', async () => {
    expect(await isQuietHoursActive()).toBe(false);
  });

  test('on, inside the default window at 11:30 PM', async () => {
    stored = { quietHours: true };
    expect(await isQuietHoursActive()).toBe(true);
  });

  test('on, but the chosen hours have not started', async () => {
    stored = { quietHours: true, quietHoursStart: 0, quietHoursEnd: 7 };
    expect(await isQuietHoursActive()).toBe(false);
  });
});

describe('formatting the hours', () => {
  test('12-hour languages say AM and PM', () => {
    expect(formatQuietHours({ start: 20, end: 8, use24Hour: false }, 'en')).toBe('8 PM – 8 AM');
  });

  test('24-hour languages write 20:00', () => {
    expect(formatQuietHours({ start: 20, end: 8, use24Hour: false }, 'de')).toBe('20:00 – 08:00');
  });

  test('a 24-hour clock setting wins over the language', () => {
    expect(formatQuietHours({ start: 20, end: 8, use24Hour: true }, 'en')).toBe('20:00 – 08:00');
  });

  test('midnight and noon in 12-hour form', () => {
    const formatter = hourFormatter(false, 'en');
    expect([formatHour(0, formatter), formatHour(12, formatter)]).toEqual(['12 AM', '12 PM']);
  });

  test('an unknown language falls back to English', () => {
    expect(formatQuietHours({ start: 20, end: 8, use24Hour: false }, 'not a locale!')).toBe('8 PM – 8 AM');
  });
});
