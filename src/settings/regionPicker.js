/**
 * The region, in the settings window: a card saying "Birds from India" that opens a search
 * box over the list of regions. Arrow keys move through the list without choosing, so
 * looking around never starts a download; Enter or a click chooses. RegionSelector
 * (regionSelector.js) fills the list and does the switching.
 */
import { html, setHtml, trustedHtml } from '../utils/html.js';

const CHEVRON = trustedHtml('<svg class="pref-region-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>');
const CHECK = trustedHtml('<svg class="region-option-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>');

// Page Up/Down move this many regions
const PAGE = 8;

/** Lower case, accents dropped: "Côte" is found by "cote". */
function fold(text) {
  return String(text).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export function regionPickerHtml() {
  return html`
    <div class="pref-region">
      <button type="button" class="pref-region-card" id="modal-region" aria-expanded="false" aria-controls="region-picker"
        aria-describedby="modal-region-status modal-region-help">
        <span class="pref-region-icon" aria-hidden="true"><img src="images/svg/location.svg" alt="" width="20" height="20"></span>
        <span class="pref-region-text">
          <span class="pref-region-caption" id="modal-region-label" data-i18n="regionLeadLabel">Birds from</span>
          <span class="pref-region-name" id="modal-region-name" data-i18n="regionWorld">World</span>
        </span>
        ${CHEVRON}
      </button>
      <!-- Status and help share one slot, so loading/failure text never shifts the layout -->
      <div class="region-message">
        <p id="modal-region-status" class="pref-help region-status" role="status" aria-live="polite" hidden></p>
        <p id="modal-region-help" class="pref-help" data-i18n="regionHelpText">New tabs show birds from this region.</p>
      </div>
      <div class="region-picker" id="region-picker" hidden>
        <label class="region-search">
          <img src="images/svg/search.svg" alt="" width="16" height="16">
          <input type="search" id="region-search" role="combobox" aria-expanded="true" aria-controls="region-options"
            aria-autocomplete="list" autocomplete="off" spellcheck="false"
            data-i18n-placeholder="regionSearchPlaceholder" placeholder="Search regions"
            data-i18n-aria-label="regionSearchPlaceholder" aria-label="Search regions">
        </label>
        <ul class="region-options" id="region-options" role="listbox" aria-labelledby="modal-region-label"></ul>
        <p class="pref-help region-empty" hidden data-i18n="regionNoMatch">No region by that name.</p>
      </div>
    </div>`;
}

export class RegionPicker {
  /**
   * @param {HTMLElement} root - the .pref-region element regionPickerHtml() made
   * @param {Object} [parts] - other elements to use instead (the welcome's: its own button, no name,
   *   ids that don't clash with the settings window's); optionIdPrefix names the options' ids
   */
  constructor(root, parts = {}) {
    this.card = parts.card || root.querySelector('.pref-region-card');
    this.nameEl = 'nameEl' in parts ? parts.nameEl : root.querySelector('.pref-region-name');
    this.panel = parts.panel || root.querySelector('.region-picker');
    this.search = parts.search || root.querySelector('#region-search');
    this.list = parts.list || root.querySelector('#region-options');
    this.empty = parts.empty || root.querySelector('.region-empty');
    this.optionIdPrefix = parts.optionIdPrefix || 'region-option-';
    this.options = [];
    this.shown = [];
    this.current = null;
    this.active = -1;
    /** @type {(code: string) => void} */
    this.onChoose = () => {};

    this.card.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    this.search.addEventListener('input', () => this.filter());
    this.search.addEventListener('keydown', (e) => this.onKey(e));
    this.list.addEventListener('click', (e) => {
      const option = e.target.closest('[role="option"]');
      if (option) this.choose(option.dataset.code);
    });
    // The pointer marks the region it's over, so Enter and the pointer agree
    this.list.addEventListener('pointermove', (e) => {
      const option = e.target.closest('[role="option"]');
      if (option) this.setActive(this.shown.findIndex(o => o.code === option.dataset.code), { scroll: false });
    });
  }

  get isOpen() {
    return !this.panel.hidden;
  }

  /** @param {Array<{code: string, name: string, indexName?: string}>} options */
  setOptions(options) {
    this.options = options.map(o => ({ ...o, keys: [fold(o.name), fold(o.indexName || ''), o.code.toLowerCase()] }));
    this.filter();
    this.showName();
  }

  get value() {
    return this.current;
  }

  /** The region in use (or being loaded): its name on the card, ticked in the list. */
  set value(code) {
    this.current = code;
    this.showName();
    for (const li of this.list.children) {
      li.setAttribute('aria-selected', String(li.dataset.code === code));
    }
  }

  get disabled() {
    return this.card.disabled;
  }

  /** While the list of regions loads there is nothing to choose from. */
  set disabled(disabled) {
    this.card.disabled = disabled;
    if (disabled) this.close({ focusCard: false });
  }

  showName() {
    const option = this.options.find(o => o.code === this.current);
    if (option && this.nameEl) {
      this.nameEl.textContent = option.name;
      this.nameEl.removeAttribute('data-i18n');
    }
  }

  open() {
    if (this.card.disabled) return;
    this.panel.hidden = false;
    this.card.setAttribute('aria-expanded', 'true');
    this.search.value = '';
    this.filter();
    this.search.focus();
  }

  close({ focusCard = true } = {}) {
    if (!this.isOpen) return;
    this.panel.hidden = true;
    this.card.setAttribute('aria-expanded', 'false');
    if (focusCard) this.card.focus();
  }

  choose(code) {
    this.close();
    if (code) this.onChoose(code);
  }

  /**
   * Show the regions matching the search, the one in use marked; the first match (or it)
   * active. Names that start with the search come first, then a later word, then anywhere:
   * "un" is United Kingdom before Brunei.
   */
  filter() {
    const query = fold(this.search.value.trim());
    if (query) {
      const rank = (o) => Math.min(...o.keys.map(k =>
        k.startsWith(query) ? 0 : k.split(/[\s\-–(]+/).some(w => w.startsWith(query)) ? 1 : k.includes(query) ? 2 : 3));
      this.shown = this.options
        .map((o, order) => ({ o, order, rank: rank(o) }))
        .filter(r => r.rank < 3)
        .sort((a, b) => a.rank - b.rank || a.order - b.order)
        .map(r => r.o);
    } else {
      this.shown = this.options;
    }
    setHtml(this.list, this.shown.map(o => html`
      <li class="region-option" id="${this.optionIdPrefix}${o.code}" role="option" aria-selected="${String(o.code === this.current)}" data-code="${o.code}">
        <span class="region-option-name">${o.name}</span>${CHECK}
      </li>`));
    this.empty.hidden = this.shown.length > 0;
    const currentIndex = this.shown.findIndex(o => o.code === this.current);
    this.setActive(query || currentIndex < 0 ? 0 : currentIndex, { block: 'center' });
  }

  setActive(index, { scroll = true, block = 'nearest' } = {}) {
    this.list.querySelector('.active')?.classList.remove('active');
    this.active = this.shown.length ? Math.max(0, Math.min(index, this.shown.length - 1)) : -1;
    const li = this.active >= 0 ? this.list.children[this.active] : null;
    if (!li) {
      this.search.removeAttribute('aria-activedescendant');
      return;
    }
    li.classList.add('active');
    this.search.setAttribute('aria-activedescendant', li.id);
    if (scroll) this.scrollTo(li, block);
  }

  /** Bring a region into view in the list only (scrollIntoView would move the page too). */
  scrollTo(li, block) {
    const list = this.list;
    const top = li.offsetTop - list.clientTop;
    if (block === 'center') {
      list.scrollTop = top - (list.clientHeight - li.offsetHeight) / 2;
    } else if (top < list.scrollTop) {
      list.scrollTop = top;
    } else if (top + li.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top + li.offsetHeight - list.clientHeight;
    }
  }

  onKey(e) {
    const step = { ArrowDown: 1, ArrowUp: -1, PageDown: PAGE, PageUp: -PAGE }[e.key];
    if (step) {
      e.preventDefault();
      this.setActive(this.active + step);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this.active >= 0) this.choose(this.shown[this.active].code);
    } else if (e.key === 'Escape') {
      // Close the list, not the settings window
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  }
}
