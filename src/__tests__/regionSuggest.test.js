/**
 * The welcome's region suggestion: the time zone's country, else the browser language's region,
 * only regions the release has, and short lists marked.
 */

import { suggestRegion, SMALL_REGION_BIRDS } from '../welcome/regionSuggest.js';

const regions = [
  { code: 'WLD', speciesCount: 500 },
  { code: 'IN', speciesCount: 298 },
  { code: 'UA', speciesCount: 280 },
  { code: 'GB', speciesCount: 300 },
  { code: 'VN', speciesCount: 290 },
  { code: 'VA', speciesCount: 48 },
];

test('the time zone gives the country, by the names Chrome and Firefox report', () => {
  expect(suggestRegion({ timeZone: 'Asia/Calcutta', regions })).toEqual({ code: 'IN', source: 'timeZone', small: false });
  expect(suggestRegion({ timeZone: 'Asia/Kolkata', regions })?.code).toBe('IN');
  expect(suggestRegion({ timeZone: 'Europe/Kiev', regions })?.code).toBe('UA');
  expect(suggestRegion({ timeZone: 'Europe/Kyiv', regions })?.code).toBe('UA');
  expect(suggestRegion({ timeZone: 'Asia/Saigon', regions })?.code).toBe('VN');
});

test('without a country time zone, the browser language’s region', () => {
  expect(suggestRegion({ timeZone: 'UTC', languages: ['en', 'en-GB'], regions })).toEqual({ code: 'GB', source: 'language', small: false });
  expect(suggestRegion({ timeZone: null, languages: ['hi-IN'], regions })?.code).toBe('IN');
});

test('only a region the release has', () => {
  // America/New_York is the US, which this release lacks: the language decides
  expect(suggestRegion({ timeZone: 'America/New_York', languages: ['en-GB'], regions })?.code).toBe('GB');
  expect(suggestRegion({ timeZone: 'America/New_York', languages: ['en-US', 'fr'], regions })).toBeNull();
  expect(suggestRegion({ timeZone: 'Not/AZone', languages: ['not a tag'], regions })).toBeNull();
});

test('a short list is marked, so it is offered but not chosen', () => {
  expect(SMALL_REGION_BIRDS).toBe(100);
  expect(suggestRegion({ timeZone: 'Europe/Vatican', regions })).toEqual({ code: 'VA', source: 'timeZone', small: true });
});
