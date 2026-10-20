// Writes src/data/timeZoneCountries.json: the country of every IANA time zone, for the welcome's
// region suggestion (regionSuggest.js). From the tz database's zone.tab, keyed by both the zone's
// own name and the name V8 reports for it (Chrome keeps old names: Asia/Calcutta, Asia/Saigon,
// Europe/Kiev); Firefox reports the current ones.
// Usage: node scripts/timezone_countries.js [path to zone.tab, default /usr/share/zoneinfo/zone.tab]

const fs = require('fs');
const path = require('path');

const source = process.argv[2] || '/usr/share/zoneinfo/zone.tab';
const rows = fs.readFileSync(source, 'utf8').split('\n')
  .filter(line => line && !line.startsWith('#'))
  .map(line => line.split('\t'));

const countries = {};
for (const [country, , zone] of rows) {
  countries[zone] = country;
  try {
    const reported = new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone;
    if (!countries[reported]) countries[reported] = country;
  } catch {
    // A zone this Node's ICU doesn't know: its own name is enough
  }
}

const missing = Intl.supportedValuesOf('timeZone').filter(zone => !countries[zone]);
if (missing.length) console.warn(`No country for: ${missing.join(' ')}`);

const sorted = Object.fromEntries(Object.entries(countries).sort(([a], [b]) => a.localeCompare(b)));
const out = path.join(__dirname, '../src/data/timeZoneCountries.json');
fs.writeFileSync(out, JSON.stringify(sorted) + '\n');
console.log(`${Object.keys(sorted).length} time zones → ${out}`);
