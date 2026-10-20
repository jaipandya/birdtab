import CONFIG from './config.js';

// Quiet hours: no bird calls from quietHoursStart to quietHoursEnd (whole hours, 0-23, local
// time). A window that ends at or before it starts runs past midnight: 20 to 8 is 8 PM to 8 AM.
export const QUIET_HOURS_KEYS = ['quietHours', 'quietHoursStart', 'quietHoursEnd', 'clockFormat24Hour'];

const validHour = (value, fallback) => (Number.isInteger(value) && value >= 0 && value < 24 ? value : fallback);

/** The stored schedule, with the defaults (8 PM to 8 AM) for anything missing. */
export async function getQuietHours() {
  const stored = await chrome.storage.local.get(QUIET_HOURS_KEYS);
  return quietHoursFrom(stored);
}

export function quietHoursFrom(stored = {}) {
  const defaults = CONFIG.STORAGE_DEFAULTS;
  return {
    enabled: stored.quietHours ?? false,
    start: validHour(stored.quietHoursStart, defaults.quietHoursStart),
    end: validHour(stored.quietHoursEnd, defaults.quietHoursEnd),
    use24Hour: stored.clockFormat24Hour ?? false,
  };
}

/** Whether `hour` falls in the window. Start and end are never equal (the settings prevent it). */
export function isWithinQuietHours(hour, start, end) {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export async function isQuietHoursActive() {
  const { enabled, start, end } = await getQuietHours();
  return enabled && isWithinQuietHours(new Date().getHours(), start, end);
}

export async function getAutoPlayState() {
  const isQuietHoursEnabled = await isQuietHoursActive();
  const result = await chrome.storage.local.get(['autoPlay']);
  return isQuietHoursEnabled ? false : result.autoPlay;
}

/**
 * Hours the way the UI language writes them: "8 PM" where clocks show AM/PM, "20:00" where they
 * run to 24 or when the user set the clock to 24-hour.
 */
export function hourFormatter(use24Hour = false, locale = chrome.i18n.getUILanguage()) {
  let languageIs24Hour = false;
  try {
    const cycle = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle;
    languageIs24Hour = cycle === 'h23' || cycle === 'h24';
  } catch {
    locale = 'en';
  }
  return use24Hour || languageIs24Hour
    ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    : new Intl.DateTimeFormat(locale, { hour: 'numeric', hour12: true });
}

const atHour = (hour) => new Date(2000, 0, 1, hour);

export function formatHour(hour, formatter = hourFormatter()) {
  return formatter.format(atHour(hour));
}

/**
 * "8 PM – 8 AM" or "20:00 – 08:00": each hour as the settings menus show it (formatRange
 * rewrites them, e.g. 20時00分 in Japanese).
 */
export function formatQuietHours({ start, end, use24Hour }, locale) {
  const formatter = hourFormatter(use24Hour, locale);
  return `${formatHour(start, formatter)} – ${formatHour(end, formatter)}`;
}

export async function getQuietHoursText() {
  return formatQuietHours(await getQuietHours());
}
