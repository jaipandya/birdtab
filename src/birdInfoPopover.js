import { escapeHtml } from './utils/escapeHtml.js';

const CONSERVATION_COLORS = {
  'LC': '#4ade80',
  'NT': '#facc15',
  'VU': '#fb923c',
  'EN': '#f87171',
  'CR': '#dc2626',
  'EW': '#a855f7',
  'EX': '#6b7280',
};

const CONSERVATION_LABELS = {
  'LC': 'Least Concern',
  'NT': 'Near Threatened',
  'VU': 'Vulnerable',
  'EN': 'Endangered',
  'CR': 'Critically Endangered',
  'EW': 'Extinct in the Wild',
  'EX': 'Extinct',
};

const CONSERVATION_LABEL_KEYS = {
  'LC': 'conservationLeastConcern',
  'NT': 'conservationNearThreatened',
  'VU': 'conservationVulnerable',
  'EN': 'conservationEndangered',
  'CR': 'conservationCriticallyEndangered',
  'EW': 'conservationExtinctInWild',
  'EX': 'conservationExtinct',
};

const CONSERVATION_HELP_KEYS = {
  'LC': 'conservationLeastConcernHelp',
  'NT': 'conservationNearThreatenedHelp',
  'VU': 'conservationVulnerableHelp',
  'EN': 'conservationEndangeredHelp',
  'CR': 'conservationCriticallyEndangeredHelp',
  'EW': 'conservationExtinctInWildHelp',
  'EX': 'conservationExtinctHelp',
};

let infoPopoverTrigger = null;
let infoPopover = null;
let infoPopoverBackdrop = null;
let infoPopoverGlobalListenersAttached = false;
let handleEbirdClick = null;

function getConservationDetails(status) {
  if (!status) return null;

  const normalizedStatus = String(status).trim();
  if (!normalizedStatus) return null;

  const codedMatch = normalizedStatus.match(/^([A-Za-z]{2})\s+(.+)$/);
  if (codedMatch) {
    const code = codedMatch[1].toUpperCase();
    if (!CONSERVATION_LABELS[code]) {
      return null;
    }

    return {
      code,
      color: CONSERVATION_COLORS[code] || '#999',
      label: CONSERVATION_LABELS[code],
    };
  }

  const codeOnly = normalizedStatus.toUpperCase();
  if (CONSERVATION_LABELS[codeOnly]) {
    return {
      code: codeOnly,
      color: CONSERVATION_COLORS[codeOnly] || '#999',
      label: CONSERVATION_LABELS[codeOnly],
    };
  }

  const matchedCode = Object.entries(CONSERVATION_LABELS).find(([, label]) => {
    return label.toLowerCase() === normalizedStatus.toLowerCase();
  })?.[0];

  if (!matchedCode) {
    return null;
  }

  return {
    code: matchedCode,
    color: CONSERVATION_COLORS[matchedCode] || '#999',
    label: CONSERVATION_LABELS[matchedCode],
  };
}

function getConservationCopy(details) {
  if (!details) return null;

  const localizedLabel = details.code ? chrome.i18n.getMessage(CONSERVATION_LABEL_KEYS[details.code]) : '';
  const localizedHelp = details.code ? chrome.i18n.getMessage(CONSERVATION_HELP_KEYS[details.code]) : '';

  return {
    color: details.color,
    label: localizedLabel || details.label,
    help: localizedHelp || '',
  };
}

function getInfoPopoverPosition(triggerRect, popoverRect) {
  const margin = 16;
  const offset = 10;
  const maxLeft = Math.max(margin, window.innerWidth - popoverRect.width - margin);
  const preferredTop = triggerRect.top - popoverRect.height - offset;
  const fallbackTop = triggerRect.bottom + offset;
  const maxTop = Math.max(margin, window.innerHeight - popoverRect.height - margin);

  const left = Math.min(Math.max(margin, triggerRect.left), maxLeft);
  const shouldOpenAbove = preferredTop >= margin || triggerRect.top >= (window.innerHeight - triggerRect.bottom);
  const top = shouldOpenAbove
    ? Math.max(margin, Math.min(preferredTop, maxTop))
    : Math.max(margin, Math.min(fallbackTop, maxTop));

  return { left, top };
}

function getPopoverFocusableElements(popover) {
  return Array.from(popover.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((element) => {
    return !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true';
  });
}

function closeInfoPopover({ returnFocus = false } = {}) {
  const closingTrigger = infoPopoverTrigger;
  const closingBackdrop = infoPopoverBackdrop;

  if (!infoPopover && !closingBackdrop) {
    if (closingTrigger) {
      closingTrigger.setAttribute('aria-expanded', 'false');
      closingTrigger.removeAttribute('aria-controls');
    }

    return;
  }

  const closingPopover = infoPopover;
  infoPopover = null;
  infoPopoverBackdrop = null;

  if (closingPopover) {
    closingPopover.classList.remove('info-popover--visible');
  }

  if (closingBackdrop) {
    closingBackdrop.removeEventListener('click', handleInfoPopoverBackdropClick);
  }

  if (closingTrigger) {
    closingTrigger.setAttribute('aria-expanded', 'false');
    closingTrigger.removeAttribute('aria-controls');
  }

  if (returnFocus && closingTrigger?.isConnected) {
    closingTrigger.focus();
  }

  setTimeout(() => {
    if (closingBackdrop?.isConnected) {
      closingBackdrop.remove();
    }

    if (closingPopover?.isConnected) {
      closingPopover.remove();
    }
  }, 150);
}

function openInfoPopover() {
  const trigger = infoPopoverTrigger;
  if (!trigger) return;

  if (infoPopover) {
    closeInfoPopover();
    return;
  }

  const scientificName = trigger.dataset.scientificName;
  const description = trigger.dataset.description;
  const conservation = trigger.dataset.conservation;
  const speciesCode = trigger.dataset.speciesCode;
  const ebirdUrl = trigger.dataset.ebirdUrl;
  const conservationDetails = getConservationCopy(getConservationDetails(conservation));

  const backdropElement = document.createElement('div');
  backdropElement.className = 'info-popover-backdrop';
  backdropElement.setAttribute('aria-hidden', 'true');
  backdropElement.addEventListener('click', handleInfoPopoverBackdropClick);

  const popoverElement = document.createElement('div');
  popoverElement.id = `bird-info-popover-${Date.now()}`;
  popoverElement.className = 'info-popover';
  popoverElement.setAttribute('role', 'dialog');
  popoverElement.setAttribute('aria-modal', 'true');
  popoverElement.setAttribute('aria-label', chrome.i18n.getMessage('infoTooltip') || 'Bird information');
  popoverElement.tabIndex = -1;
  popoverElement.innerHTML = `
    <div class="info-popover__content">
      <div class="info-popover__body">
        ${scientificName ? `<p class="info-popover__scientific-name">${escapeHtml(scientificName)}</p>` : ''}
        ${description ? `
          <p class="info-popover__section-label">${chrome.i18n.getMessage('aboutThisBird') || 'About'}</p>
          <p class="info-popover__description">${escapeHtml(description)}</p>
        ` : ''}
        ${conservationDetails ? `
          <div class="info-popover__conservation">
            <p class="info-popover__section-label">${chrome.i18n.getMessage('conservationStatusTitle') || 'Conservation status'}</p>
            <div class="info-popover__conservation-row">
              <span class="info-popover__conservation-dot" style="background:${conservationDetails.color}"></span>
              <span class="info-popover__conservation-label">${escapeHtml(conservationDetails.label)}</span>
            </div>
            ${conservationDetails.help ? `<p class="info-popover__conservation-help">${escapeHtml(conservationDetails.help)}</p>` : ''}
          </div>
        ` : ''}
        ${ebirdUrl ? `
          <a href="${escapeHtml(ebirdUrl)}" target="_blank" rel="noopener noreferrer" class="info-popover__ebird-link">
            <img class="info-popover__ebird-icon" src="images/svg/ebird.svg" alt="" width="14" height="14">
            <span>${chrome.i18n.getMessage('viewOnEbird') || 'View on eBird'}</span>
            <svg class="info-popover__external-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
              <path d="M4.5 2.5H9.5V7.5M9.5 2.5L2.5 9.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </a>
        ` : ''}
      </div>
      ${speciesCode ? `
        <div class="info-popover__map-side">
          <p class="info-popover__section-label">${chrome.i18n.getMessage('rangeMap') || 'Range Map'}</p>
          <div class="info-popover__map-container">
            <div class="info-popover__map-loading">
              <svg class="info-popover__map-loading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
              <span class="info-popover__map-loading-text">${chrome.i18n.getMessage('loadingRangeMap') || 'Loading range map...'}</span>
            </div>
            <iframe
              src="https://ebird.org/embedmap/${encodeURIComponent(speciesCode)}"
              class="info-popover__map"
              title="${chrome.i18n.getMessage('rangeMap') || 'Range map'}"
              referrerpolicy="no-referrer"
            ></iframe>
          </div>
        </div>
      ` : ''}
    </div>
  `;

  const iframe = popoverElement.querySelector('.info-popover__map');
  const mapContainer = popoverElement.querySelector('.info-popover__map-container');
  if (iframe && mapContainer) {
    iframe.addEventListener('load', () => {
      mapContainer.classList.add('info-popover__map-container--loaded');
    });
  }

  const ebirdLink = popoverElement.querySelector('.info-popover__ebird-link');
  if (ebirdLink && typeof handleEbirdClick === 'function') {
    ebirdLink.addEventListener('click', handleEbirdClick);
  }

  document.body.appendChild(backdropElement);
  document.body.appendChild(popoverElement);
  infoPopoverBackdrop = backdropElement;
  infoPopover = popoverElement;
  trigger.setAttribute('aria-expanded', 'true');
  trigger.setAttribute('aria-controls', popoverElement.id);

  const rect = trigger.getBoundingClientRect();
  popoverElement.style.position = 'fixed';
  const { left, top } = getInfoPopoverPosition(rect, {
    width: popoverElement.offsetWidth,
    height: popoverElement.offsetHeight,
  });
  popoverElement.style.left = `${left}px`;
  popoverElement.style.top = `${top}px`;

  requestAnimationFrame(() => {
    infoPopover?.classList.add('info-popover--visible');
  });

  const focusableElements = getPopoverFocusableElements(popoverElement);
  const initialFocusTarget = focusableElements[0] || popoverElement;
  initialFocusTarget.focus();
}

function handleInfoPopoverTriggerClick(e) {
  e.stopPropagation();
  openInfoPopover();
}

function handleInfoPopoverBackdropClick(e) {
  e.preventDefault();
  e.stopPropagation();
  closeInfoPopover();
}

function handleInfoPopoverDocumentKeydown(e) {
  if (!infoPopover) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    closeInfoPopover({ returnFocus: true });
    return;
  }

  if (e.key === 'Tab') {
    const focusableElements = getPopoverFocusableElements(infoPopover);

    if (focusableElements.length === 0) {
      e.preventDefault();
      infoPopover.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;

    if (!infoPopover.contains(activeElement)) {
      e.preventDefault();
      (e.shiftKey ? lastElement : firstElement).focus();
      return;
    }

    if (e.shiftKey && activeElement === firstElement) {
      e.preventDefault();
      lastElement.focus();
    } else if (!e.shiftKey && activeElement === lastElement) {
      e.preventDefault();
      firstElement.focus();
    }
  }
}

export function setupInfoPopover({ onEbirdClick } = {}) {
  const trigger = document.querySelector('.info-popover-trigger');

  if (infoPopoverTrigger && infoPopoverTrigger !== trigger) {
    infoPopoverTrigger.removeEventListener('click', handleInfoPopoverTriggerClick);
  }

  closeInfoPopover();
  infoPopoverTrigger = trigger;
  handleEbirdClick = onEbirdClick || null;

  if (!trigger) return;

  trigger.removeEventListener('click', handleInfoPopoverTriggerClick);
  trigger.addEventListener('click', handleInfoPopoverTriggerClick);

  if (!infoPopoverGlobalListenersAttached) {
    document.addEventListener('keydown', handleInfoPopoverDocumentKeydown);
    infoPopoverGlobalListenersAttached = true;
  }
}
