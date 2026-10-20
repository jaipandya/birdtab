/**
 * The region the welcome suggests, worked out in the browser (no location permission, no server):
 * the country of the time zone, else the region in the browser's languages (en-IN), else none.
 * Only a region the media release has is suggested.
 */
import TIME_ZONE_COUNTRIES from '../data/timeZoneCountries.json';

// A region with fewer birds than this repeats within days at a few tabs an hour, so it's offered
// but not chosen for the user (25 regions in release m261020r01, e.g. Vatican City, Monaco is 104)
export const SMALL_REGION_BIRDS = 100;

export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function regionOfLanguage(tag) {
  try {
    return new Intl.Locale(tag).region || null;
  } catch {
    return null;
  }
}

/**
 * @param {Object} options
 * @param {string|null} options.timeZone - e.g. 'Asia/Calcutta'
 * @param {string[]} [options.languages] - navigator.languages
 * @param {Array<{code: string, speciesCount?: number}>} options.regions - the release index's regions
 * @returns {{ code: string, source: 'timeZone'|'language', small: boolean } | null}
 */
export function suggestRegion({ timeZone, languages = [], regions = [] }) {
  const find = (code) => (code ? regions.find(r => r.code === code) : null);
  const suggestion = (region, source) => ({
    code: region.code,
    source,
    small: Number.isFinite(region.speciesCount) && region.speciesCount < SMALL_REGION_BIRDS,
  });

  const byZone = find(TIME_ZONE_COUNTRIES[timeZone]);
  if (byZone) return suggestion(byZone, 'timeZone');

  for (const tag of languages) {
    const byLanguage = find(regionOfLanguage(tag));
    if (byLanguage) return suggestion(byLanguage, 'language');
  }
  return null;
}
