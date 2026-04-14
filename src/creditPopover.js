import { escapeHtml, truncateName } from './utils/escapeHtml.js';
import { getMessage } from './i18n.js';

const SHOW_DELAY = 300;
const HIDE_DELAY = 200;

const PLATFORM_ICONS = {
  wikimedia: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.2"/><path d="M8 1.5C5.5 4 4.5 6 4.5 8s1 4 3.5 6.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><path d="M8 1.5c2.5 2.5 3.5 4.5 3.5 6.5s-1 4-3.5 6.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><line x1="1.5" y1="8" x2="14.5" y2="8" stroke="currentColor" stroke-width="1.1"/></svg>`,
  'xeno-canto': `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 8h2l2-4 2 8 2-6 2 4h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  inaturalist: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="0.8" fill="currentColor"/></svg>`,
  pixabay: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" stroke-width="1.2"/><circle cx="6" cy="7" r="1.5" stroke="currentColor" stroke-width="1"/><path d="M3 11l3-3 2 2 3-3 3 3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  pexels: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" stroke-width="1.2"/><circle cx="6" cy="7" r="1.5" stroke="currentColor" stroke-width="1"/><path d="M3 11l3-3 2 2 3-3 3 3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  unsplash: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.5 3h5v3.5h-5zM2 8.5h3.5V13h5V8.5H14V13H2z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>`,
};

const GLOBE_ICON = `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.2"/><ellipse cx="8" cy="8" rx="3" ry="6.5" stroke="currentColor" stroke-width="1.1"/><line x1="1.5" y1="8" x2="14.5" y2="8" stroke="currentColor" stroke-width="1.1"/></svg>`;
const EXTERNAL_ARROW = `<svg class="credit-popover__ext-icon" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5H9.5V7.5M9.5 2.5L2.5 9.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CC_ICON = `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.2"/><path d="M6.1 9.4A1.7 1.7 0 0 1 5 7.9c0-1 .8-1.8 1.8-1.8.6 0 1.1.3 1.4.7l-.7.5c-.2-.2-.4-.3-.7-.3-.5 0-.9.4-.9.9s.4.9.9.9c.3 0 .5-.1.7-.3l.7.5c-.3.4-.8.7-1.4.7-.7 0-1.3-.4-1.6-.9l-.1-.3Zm3.7 0A1.7 1.7 0 0 1 8.7 7.9c0-1 .8-1.8 1.8-1.8.6 0 1.1.3 1.4.7l-.7.5c-.2-.2-.4-.3-.7-.3-.5 0-.9.4-.9.9s.4.9.9.9c.3 0 .5-.1.7-.3l.7.5c-.3.4-.8.7-1.4.7-.7 0-1.3-.4-1.6-.9l-.1-.3Z" fill="currentColor"/></svg>`;
const PIN_ICON = `<svg viewBox="0 0 10 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 0C2.24 0 0 2.24 0 5c0 3.75 5 9 5 9s5-5.25 5-9c0-2.76-2.24-5-5-5Zm0 6.75a1.75 1.75 0 1 1 0-3.5 1.75 1.75 0 0 1 0 3.5Z" fill="currentColor"/></svg>`;
const CALENDAR_ICON = `<svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="2" width="10" height="9" rx="1.5" stroke="currentColor" stroke-width="1.1"/><path d="M1 5h10" stroke="currentColor" stroke-width="1.1"/><path d="M3.5 0.5v2.5M8.5 0.5v2.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>`;

let activePopover = null;
let activeTarget = null;
let showTimeout = null;
let hideTimeout = null;
let storedCreditInfoData = null;

function getSourceIcon(sourceKey) {
  if (!sourceKey) return GLOBE_ICON;
  const key = sourceKey.toLowerCase().replace(/\s+/g, '-');
  for (const [platform, icon] of Object.entries(PLATFORM_ICONS)) {
    if (key.includes(platform)) return icon;
  }
  return GLOBE_ICON;
}

function buildLocationUrl(lat, lon, locationText) {
  if (lat && lon) {
    return `https://www.google.com/maps/@${encodeURIComponent(lat)},${encodeURIComponent(lon)},12z`;
  }
  if (locationText) {
    return `https://www.google.com/search?q=${encodeURIComponent(locationText)}`;
  }
  return '';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function buildFieldRow(label, valueHtml) {
  return `<div class="credit-popover__field"><span class="credit-popover__label">${label}</span><span class="credit-popover__value">${valueHtml}</span></div>`;
}

function buildSectionHtml(data, type) {
  const isAudio = type === 'audio';
  const typeLabel = isAudio ? getMessage('creditAudioBy') : getMessage('creditPhotoBy');

  const displayName = truncateName(data.name);
  const nameHtml = data.url
    ? `<a href="${escapeHtml(data.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayName)}</a>`
    : escapeHtml(displayName);

  let titleHtml = '';
  if (data.title) {
    const titleText = escapeHtml(data.title);
    titleHtml = data.sourceUrl
      ? `<a href="${escapeHtml(data.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="credit-popover__title" title="${titleText}">${titleText}</a>`
      : `<span class="credit-popover__title" title="${titleText}">${titleText}</span>`;
  }

  let caption = '';
  if (data.caption) {
    const captionText = escapeHtml(data.caption);
    caption = data.sourceUrl
      ? `<a href="${escapeHtml(data.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="credit-popover__caption" title="${captionText}">${captionText}</a>`
      : `<p class="credit-popover__caption" title="${captionText}">${captionText}</p>`;
  }

  const tagItems = [];
  if (isAudio && data.soundType) {
    tagItems.push(`<span class="credit-popover__tag" title="${escapeHtml(getMessage('creditSoundType'))}"><span class="credit-popover__tag-text">${escapeHtml(data.soundType)}</span></span>`);
  }
  if (data.location) {
    const locUrl = buildLocationUrl(data.lat, data.lon, data.location);
    const locTitle = isAudio ? getMessage('creditRecordingLocation') : getMessage('creditPhotoLocation');
    if (locUrl) {
      tagItems.push(
        `<a href="${escapeHtml(locUrl)}" target="_blank" rel="noopener noreferrer" class="credit-popover__tag credit-popover__tag--link" title="${escapeHtml(locTitle)} \u2014 ${escapeHtml(data.location)}">` +
        `<span class="credit-popover__tag-icon">${PIN_ICON}</span><span class="credit-popover__tag-text">${escapeHtml(data.location)}</span></a>`
      );
    } else {
      tagItems.push(`<span class="credit-popover__tag" title="${escapeHtml(locTitle)} \u2014 ${escapeHtml(data.location)}"><span class="credit-popover__tag-icon">${PIN_ICON}</span><span class="credit-popover__tag-text">${escapeHtml(data.location)}</span></span>`);
    }
  }
  if (data.date) {
    const formatted = formatDate(data.date);
    if (formatted) {
      tagItems.push(`<span class="credit-popover__tag" title="${escapeHtml(isAudio ? getMessage('creditDateRecorded') : getMessage('creditDateTaken'))}"><span class="credit-popover__tag-icon">${CALENDAR_ICON}</span><span class="credit-popover__tag-text">${escapeHtml(formatted)}</span></span>`);
    }
  }
  if (!isAudio && data.resized) {
    tagItems.push(`<span class="credit-popover__tag credit-popover__tag--muted" title="${escapeHtml(getMessage('creditResizedTooltip'))}"><span class="credit-popover__tag-text">${escapeHtml(getMessage('creditResized'))}</span></span>`);
  }
  if (isAudio && data.convertedFormat) {
    tagItems.push(`<span class="credit-popover__tag credit-popover__tag--muted" title="${escapeHtml(getMessage('creditConvertedTooltip'))}"><span class="credit-popover__tag-text">${chrome.i18n.getMessage('creditConverted', [data.convertedFormat]) || `Converted to ${escapeHtml(data.convertedFormat)}`}</span></span>`);
  }
  const tags = tagItems.length ? `<div class="credit-popover__tags">${tagItems.join('')}</div>` : '';

  let fieldRows = '';
  const hasSource = data.source || data.sourceUrl;
  const hasLicense = data.license || data.licenseUrl;

  if (hasSource) {
    const sourceIcon = getSourceIcon(data.source);
    const sourceText = escapeHtml(data.source || getMessage('creditSource'));
    const value = data.sourceUrl
      ? `<a href="${escapeHtml(data.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="credit-popover__value-link"><span class="credit-popover__value-icon">${sourceIcon}</span>${sourceText}${EXTERNAL_ARROW}</a>`
      : `<span class="credit-popover__value-text"><span class="credit-popover__value-icon">${sourceIcon}</span>${sourceText}</span>`;
    fieldRows += buildFieldRow(escapeHtml(getMessage('creditSource')), value);
  }

  if (hasLicense) {
    const licenseText = escapeHtml(data.license || getMessage('creditLicense'));
    const value = data.licenseUrl
      ? `<a href="${escapeHtml(data.licenseUrl)}" target="_blank" rel="noopener noreferrer" class="credit-popover__value-link"><span class="credit-popover__value-icon">${CC_ICON}</span>${licenseText}${EXTERNAL_ARROW}</a>`
      : `<span class="credit-popover__value-text"><span class="credit-popover__value-icon">${CC_ICON}</span>${licenseText}</span>`;
    fieldRows += buildFieldRow(escapeHtml(getMessage('creditLicense')), value);
  }

  const fields = fieldRows ? `<div class="credit-popover__fields">${fieldRows}</div>` : '';

  return `
    <div class="credit-popover__section">
      <div class="credit-popover__top">
        <span class="credit-popover__eyebrow">${escapeHtml(typeLabel)}</span>
        <span class="credit-popover__name">${nameHtml}</span>
      </div>
      ${titleHtml}
      ${caption}
      ${tags}
      ${fields}
    </div>
  `;
}

function dataFromTarget(target) {
  return {
    type: target.dataset.creditType,
    name: target.dataset.creditName,
    url: target.dataset.creditUrl,
    source: target.dataset.creditSource,
    sourceUrl: target.dataset.creditSourceUrl,
    license: target.dataset.creditLicense,
    licenseUrl: target.dataset.creditLicenseUrl,
    title: target.dataset.creditTitle || '',
    caption: target.dataset.creditCaption || '',
    location: target.dataset.creditLocation || '',
    lat: target.dataset.creditLat || '',
    lon: target.dataset.creditLon || '',
    soundType: target.dataset.creditSoundType || '',
    date: target.dataset.creditDate || '',
    resized: target.dataset.creditResized === 'true',
    convertedFormat: target.dataset.creditConvertedFormat || '',
  };
}

function buildSinglePopoverHtml(target) {
  const data = dataFromTarget(target);
  if (!data.name) return '';
  return buildSectionHtml(data, data.type);
}

function buildCombinedPopoverHtml() {
  if (!storedCreditInfoData) return '';
  const sections = [];
  if (storedCreditInfoData.photo) {
    sections.push(buildSectionHtml(storedCreditInfoData.photo, 'photo'));
  }
  if (storedCreditInfoData.audio) {
    sections.push(buildSectionHtml(storedCreditInfoData.audio, 'audio'));
  }
  return sections.join('<div class="credit-popover__divider"></div>');
}

function positionPopover(popover, triggerRect) {
  const margin = 12;
  const offset = 8;
  const popoverRect = popover.getBoundingClientRect();

  const preferredTop = triggerRect.top - popoverRect.height - offset;
  const fallbackTop = triggerRect.bottom + offset;
  const shouldOpenAbove = preferredTop >= margin;

  const top = shouldOpenAbove
    ? Math.max(margin, preferredTop)
    : Math.min(fallbackTop, window.innerHeight - popoverRect.height - margin);

  const centerX = triggerRect.left + triggerRect.width / 2;
  const left = Math.max(margin, Math.min(centerX - popoverRect.width / 2, window.innerWidth - popoverRect.width - margin));

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.dataset.placement = shouldOpenAbove ? 'above' : 'below';
}

function showPopover(target, html) {
  if (activePopover) destroyPopover();
  if (!html) return;

  const el = document.createElement('div');
  el.className = 'credit-popover';
  el.setAttribute('role', 'tooltip');
  el.innerHTML = html;

  document.body.appendChild(el);
  activePopover = el;
  activeTarget = target;

  positionPopover(el, target.getBoundingClientRect());

  requestAnimationFrame(() => {
    el.classList.add('credit-popover--visible');
  });

  el.addEventListener('mouseenter', handlePopoverMouseEnter);
  el.addEventListener('mouseleave', handlePopoverMouseLeave);
}

function destroyPopover() {
  if (!activePopover) return;

  const closing = activePopover;
  closing.classList.remove('credit-popover--visible');
  closing.removeEventListener('mouseenter', handlePopoverMouseEnter);
  closing.removeEventListener('mouseleave', handlePopoverMouseLeave);

  activePopover = null;
  activeTarget = null;

  setTimeout(() => {
    if (closing.isConnected) closing.remove();
  }, 180);
}

function clearTimers() {
  if (showTimeout) { clearTimeout(showTimeout); showTimeout = null; }
  if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
}

function scheduleShow(target, htmlFn) {
  clearTimers();
  showTimeout = setTimeout(() => { showPopover(target, htmlFn()); }, SHOW_DELAY);
}

function scheduleHide() {
  clearTimers();
  hideTimeout = setTimeout(() => { destroyPopover(); }, HIDE_DELAY);
}

function handlePopoverMouseEnter() { clearTimers(); }
function handlePopoverMouseLeave() { scheduleHide(); }

function handleCreditMouseEnter(e) {
  const creditItem = e.currentTarget;
  if (activeTarget === creditItem) { clearTimers(); return; }
  scheduleShow(creditItem, () => buildSinglePopoverHtml(creditItem));
}

function handleCreditMouseLeave() { scheduleHide(); }

function handleInfoMouseEnter(e) {
  const trigger = e.currentTarget;
  if (activeTarget === trigger) { clearTimers(); return; }
  scheduleShow(trigger, buildCombinedPopoverHtml);
}

function handleInfoMouseLeave() { scheduleHide(); }

export function setupCreditPopovers(creditInfoData) {
  storedCreditInfoData = creditInfoData || null;

  const creditItems = document.querySelectorAll('.credit-item[data-credit-name]');
  creditItems.forEach(item => {
    item.removeEventListener('mouseenter', handleCreditMouseEnter);
    item.removeEventListener('mouseleave', handleCreditMouseLeave);
    item.addEventListener('mouseenter', handleCreditMouseEnter);
    item.addEventListener('mouseleave', handleCreditMouseLeave);
  });

  const infoTrigger = document.getElementById('credit-info-trigger');
  if (infoTrigger) {
    infoTrigger.removeEventListener('mouseenter', handleInfoMouseEnter);
    infoTrigger.removeEventListener('mouseleave', handleInfoMouseLeave);
    infoTrigger.addEventListener('mouseenter', handleInfoMouseEnter);
    infoTrigger.addEventListener('mouseleave', handleInfoMouseLeave);
  }
}
