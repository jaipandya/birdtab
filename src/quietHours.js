const QUIET_HOURS_START = 20; // 8 PM
const QUIET_HOURS_END = 8; // 8 AM

export async function isQuietHoursActive() {
  const result = await chrome.storage.sync.get(['quietHours']);
  const isQuietHoursEnabled = result.quietHours ?? false;
  const currentHour = new Date().getHours();
  const isBetweenQuietHours = currentHour >= QUIET_HOURS_START || currentHour < QUIET_HOURS_END;
  return isQuietHoursEnabled && isBetweenQuietHours;
}

export async function getAutoPlayState() {
  const isQuietHoursEnabled = await isQuietHoursActive();
  const result = await chrome.storage.sync.get(['autoPlay']);
  return isQuietHoursEnabled ? false : result.autoPlay;
}

export function getQuietHoursText() {
  const formatHour = (hour) => hour % 12 === 0 ? 12 : hour % 12;
  const startPeriod = QUIET_HOURS_START >= 12 ? 'PM' : 'AM';
  const endPeriod = QUIET_HOURS_END >= 12 ? 'PM' : 'AM';
  return `${formatHour(QUIET_HOURS_START)} ${startPeriod} - ${formatHour(QUIET_HOURS_END)} ${endPeriod}`;
}