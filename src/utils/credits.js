/**
 * Commons fills a missing author field with "No machine-readable author
 * provided. <User> assumed (based on copyright claims)." Schema 1 manifests
 * (and any release built before the crawlers unwrapped it) still carry it.
 */
const ASSUMED_AUTHOR =
  /^No machine-readable author provided\.\s*(.+?)\s+assumed\s+\(based on copyright claims\)\.?$/i;

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const NIBR = 'National Institute of Biological Resources (국립생물자원관)';

/**
 * Credits that need a fact, not a rule, keyed by the media's source page:
 * recordings collected without their recordist (the names are from the
 * iNaturalist observation or Xeno-canto recording) and Korean government
 * recordings. Same list as the
 * crawler's credit-names.ts.
 */
const CREDIT_OVERRIDES = {
  'https://www.inaturalist.org/observations/341233387': 'Saran Pluemjit',
  'https://www.inaturalist.org/observations/370638788': 'grass_0',
  'https://www.inaturalist.org/observations/177341888': 'Sally Adam',
  'https://www.inaturalist.org/observations/297296417': 'Татьяна',
  'https://www.inaturalist.org/observations/137414277': 'Paloma Yávar Aguirre',
  'https://www.inaturalist.org/observations/389305235': 'jo_shy_007',
  'https://www.inaturalist.org/observations/100345754': 'casscraven',
  'https://www.inaturalist.org/observations/324962095': 'Damien Wallace',
  'https://xeno-canto.org/251322': 'Niels Krabbe',
  'https://commons.wikimedia.org/wiki/File:%EB%A7%A4(Falco_peregrinus_Tunstall).ogg': NIBR,
  'https://commons.wikimedia.org/wiki/File:%EB%AC%BC%EA%B9%8C%EC%B9%98.ogg': NIBR,
  'https://commons.wikimedia.org/wiki/File:%EB%B0%95%EC%83%88.ogg': NIBR,
};

/**
 * Some creator names arrive HTML-encoded from their source ("U.S. Fish &amp;
 * Wildlife Service", "O&#039;Donnell"). Credits are inserted as text, so
 * decode them back. Regex only: this runs in the background script too.
 * @param {string} text
 * @returns {string}
 */
function decodeHtmlEntities(text) {
  return text.replace(/&(?:(amp|lt|gt|quot|apos|nbsp)|#(\d+)|#x([0-9a-f]+));/gi, (entity, named, dec, hex) => {
    if (named) return NAMED_ENTITIES[named.toLowerCase()];
    const code = dec ? Number(dec) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

/**
 * Reduce a credit name to the person, as plain text. Sources fill the author
 * field with more than a name: Flickr photos copied to Commons read "Ron
 * Knight from Seaford, UK", iNaturalist attributions "(c) Nigel Voaden, some
 * rights reserved (CC BY)", some authors paste a sentence or a URL. Releases
 * made after October 2026 are cleaned by the crawlers with the same rules
 * (crawlers/src/lib/credit-names.ts); this covers the releases already out.
 * Regex only: this runs in the background script too.
 * @param {string|null|undefined} name
 * @param {{ source?: string|null, sourceUrl?: string|null }} [media] the image or audio entry
 * @returns {string|null|undefined}
 */
export function cleanCreditName(name, media = {}) {
  const override = media?.sourceUrl ? CREDIT_OVERRIDES[media.sourceUrl] : undefined;
  if (override) return override;
  if (typeof name !== 'string') return name;

  let text = decodeHtmlEntities(name).replace(/\s+/g, ' ').trim();
  const assumed = text.match(ASSUMED_AUTHOR);
  if (assumed) {
    text = assumed[1].replace(/~commonswiki$/i, '').trim();
    if (!text) return null;
  }
  // "This image was produced by me, David Castor ( user:dcastor ). The pictures…"
  const sentence = text.match(
    /^this (?:image|photo|photograph|picture) (?:was |is )?(?:produced|taken|made|shot) by (?:me,?\s*)?(.+?)\s*(?:\(|\s\.(?:\s|$)|\.\s+(?=\p{Lu}\p{Ll}+\s+\p{Ll})|$)/iu,
  );
  if (sentence) text = sentence[1];
  // "Photo by: Ganatron – paulweberphoto.com"
  text = text.replace(/^(?:photo(?:graph)?|image|picture)s?\s*(?:by)?\s*:\s*/i, '');
  // "(c) Nigel Voaden, some rights reserved (CC BY)"
  const rights = text.match(/^(?:\(c\)|©)\s*(.+?)(?:,\s*(?:some|all|no) rights reserved.*)?$/i);
  if (rights) text = rights[1];
  text = text.replace(/,\s*(?:some|all|no) rights reserved.*$/i, '');
  // "The original uploader was Tauʻolunga at Tongan Wikipedia.", "Psychofox at English Wikipedia"
  const uploader = text.match(/^(?:the original uploader was\s+)?(.+?)\s+at\s+[\p{L} ]*wikipedia\b/iu);
  if (uploader) text = uploader[1];
  // "iNaturalist user: thibaudaronson"
  text = text.replace(/^.*?\buser:\s*/i, '');
  // "JJ Harrison ( https://www.jjharrison.com.au/ )", "Ganatron – paulweberphoto.com"
  text = text.replace(/\(?\s*(?:https?:\/\/|www\.)[^\s)]+\s*\)?/gi, ' ');
  text = text.replace(/\s+[–—-]\s+(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/?$/i, '');
  text = text.replace(/~commonswiki$/i, '');
  // Flickr via Commons: "Ron Knight from Seaford, East Sussex, United Kingdom"
  if (/wikimedia/i.test(media?.source || '')) text = text.replace(/\s+from\s+\p{Lu}.*$/u, '');
  if (/^unknown author unknown author$/i.test(text)) text = 'Unknown';
  // Leftovers: empty brackets, leading dashes, a trailing comma or a stray " ." or " /".
  text = text
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:–—-]+|[\s,:]+$|\s+[./–—-]+$/g, '')
    .trim();
  return text || name.trim();
}

/**
 * Format a credit date for display: "May 23, 2007" for YYYY-MM-DD
 * (optionally followed by a time), "Mar 2022" for YYYY-MM and "2021" for
 * YYYY, the last two from the release's *Approx fields. Returns '' for
 * anything that isn't a real date, so the caller can leave the date out
 * instead of showing "Invalid Date".
 * @param {string|null|undefined} value
 * @returns {string}
 */
export function formatCreditDate(value) {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?=$|[T\s])/.exec(String(value ?? '').trim());
  if (!match) return '';
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : null;
  const day = match[3] ? Number(match[3]) : null;
  if (year < 1800) return '';
  if (month === null) return String(year);
  const date = new Date(year, month - 1, day ?? 1);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || (day !== null && date.getDate() !== day)) {
    return '';
  }
  return day === null
    ? date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
