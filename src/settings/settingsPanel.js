/**
 * The settings window: a window in the middle of the page with the sections listed down its
 * side, one section shown at a time. The rows come from settingsRows.js; this module lays
 * them out, finds the controls by id and keeps them and storage in step.
 *
 *   initSettingsPanel()   build it once the page is up
 *   openSettings()        open it (from the settings button's menu)
 */
import { QUIET_HOURS_KEYS, quietHoursFrom, hourFormatter, formatHour, formatQuietHours } from '../quietHours.js';
import { localizeHtml, getMessage } from '../i18n.js';
import { warn } from '../logger.js';
import { handleQuickAccessToggle } from '../quickAccessPermissions.js';
import CONFIG from '../config.js';
import { updateUserContext } from '../sentry.js';
import { announce } from '../loadingIndicators.js';
import { html, insertHtml } from '../utils/html.js';
import { setNewTabMode, isPinnedToToolbar } from '../newTabMode.js';
import { showPinCoach } from '../pinCoach.js';
import { settingsSections, footerHtml, rotationCaption } from './settingsRows.js';
import { RegionSelector } from './regionSelector.js';
import { RegionPicker } from './regionPicker.js';
import { debugSection, bindDebugSection } from './settingsDebug.js';
import './settings.css';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';

class SettingsPanel {
  constructor() {
    this.isOpen = false;
    this.abortController = new AbortController();

    this.render();
    this.findControls();
    this.bindEvents();
    this.loadSettings();
  }

  render() {
    document.getElementById('settings-panel')?.remove();
    const sections = [...settingsSections(), debugSection()].filter(Boolean);
    insertHtml(document.body, 'beforeend', html`
      <div id="settings-panel" class="settings-panel">
        <div class="settings-panel-surface" role="dialog" aria-modal="true" aria-labelledby="settings-panel-title" tabindex="-1">
          <nav class="sp-nav" aria-labelledby="settings-panel-title">
            <h2 class="pref-title" id="settings-panel-title" data-i18n="settingsAlt">Settings</h2>
            <ul class="sp-nav-list">
              ${sections.map((s, i) => html`
              <li><button type="button" class="sp-nav-item" data-section="${s.key}" ${i === 0 ? html`aria-current="true"` : ''}>
                <img src="${s.icon}" alt="" width="18" height="18">
                <span data-i18n="${s.titleKey}">${s.title}</span>
              </button></li>`)}
            </ul>
            ${footerHtml()}
          </nav>
          <div class="sp-page">
            <button type="button" id="close-settings" class="pref-close" data-i18n-aria-label="closeSettings" aria-label="Close settings">
              <img src="images/svg/close.svg" alt="" width="18" height="18">
            </button>
            ${sections.map((s, i) => html`
            <section class="pref-section" data-section="${s.key}" aria-labelledby="settings-page-${s.key}" ${i === 0 ? '' : html`hidden`}>
              <h3 class="sp-page-title" id="settings-page-${s.key}" tabindex="-1" data-i18n="${s.titleKey}">${s.title}</h3>
              ${s.body}
            </section>`)}
          </div>
        </div>
      </div>`);
    this.root = document.getElementById('settings-panel');
    this.surface = this.root.querySelector('.settings-panel-surface');
    localizeHtml();
  }

  /** Show one section; its heading takes focus so screen readers hear where they are. */
  showSection(key, { focus = true } = {}) {
    // An open region list doesn't wait behind another section
    this.regionPicker?.close({ focusCard: false });
    for (const item of this.root.querySelectorAll('.sp-nav-item')) {
      if (item.dataset.section === key) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
    }
    for (const section of this.root.querySelectorAll('.sp-page .pref-section')) {
      section.hidden = section.dataset.section !== key;
    }
    if (focus) this.root.querySelector(`#settings-page-${key}`)?.focus();
  }

  findControls() {
    const $ = (id) => this.root.querySelector(`#${id}`);
    this.autoPlayCheckbox = $('modal-auto-play');
    this.quietHoursCheckbox = $('modal-quiet-hours');
    this.clockDisplayCheckbox = $('modal-clock-display');
    this.enableProductivityCheckbox = $('modal-enable-productivity');
    this.googleAppsCheckbox = $('modal-google-apps');
    this.chromeTabCheckbox = $('modal-chrome-tab');
    this.quickGuessCheckbox = $('modal-quick-guess');
    this.newTabModeRadios = [...this.root.querySelectorAll('input[name="new-tab-mode"]')];
    this.birdRotationRadios = [...this.root.querySelectorAll('input[name="bird-rotation"]')];
    this.birdRotationCaption = $('bird-rotation-caption');
    this.newTabCaption = $('modal-new-tab-caption');
    this.pinRow = this.root.querySelector('.pin-row');
    this.keywordTip = this.root.querySelector('.keyword-tip');
    this.quietHoursTextElement = $('modal-quiet-hours-text');
    this.quietHoursSetting = this.root.querySelector('.quiet-hours-setting');
    this.buildQuietHoursSentence();

    const regionRoot = this.root.querySelector('.pref-region');
    const regionStatus = $('modal-region-status');
    this.regionPicker = regionRoot ? new RegionPicker(regionRoot) : null;
    this.regionSelector = this.regionPicker && regionStatus ? new RegionSelector({
      picker: this.regionPicker,
      status: regionStatus,
      onRegionChanged: (region) => {
        this.showSaveNotification();
        updateUserContext({ region });
      }
    }) : null;
  }

  /**
   * "From [start] to [end]" in the UI language, with a menu of hours in place of each time. The
   * translation decides the word order, so it's split around the two placeholders.
   */
  buildQuietHoursSentence() {
    const sentence = this.root.querySelector('.quiet-hours-sentence');
    if (!sentence) return;
    const START = '⁠start⁠', END = '⁠end⁠';
    const text = getMessage('quietHoursFromTo', [START, END]);
    const parts = text.includes(START) && text.includes(END) ? text.split(/(⁠start⁠|⁠end⁠)/) : ['', START, ' – ', END, ''];

    const makeSelect = (id, labelKey) => {
      const select = document.createElement('select');
      select.id = id;
      select.className = 'quiet-hours-select';
      select.setAttribute('aria-label', getMessage(labelKey));
      for (let hour = 0; hour < 24; hour++) select.add(new Option('', String(hour)));
      select.addEventListener('change', () => this.saveSettings());
      return select;
    };
    this.quietStartSelect = makeSelect('modal-quiet-hours-start', 'quietHoursStartLabel');
    this.quietEndSelect = makeSelect('modal-quiet-hours-end', 'quietHoursEndLabel');

    sentence.replaceChildren(...parts.filter(Boolean).map(part => {
      if (part === START) return this.quietStartSelect;
      if (part === END) return this.quietEndSelect;
      const span = document.createElement('span');
      span.textContent = part.trim();
      return span;
    }));
  }

  /** Show the schedule: the summary line, the menus (in the clock's 12/24-hour style), open or not. */
  renderQuietHours(schedule) {
    const { enabled, start, end, use24Hour } = schedule;
    this.quietHoursSetting?.classList.toggle('is-on', enabled);
    if (this.quietHoursTextElement) {
      this.quietHoursTextElement.textContent = formatQuietHours(schedule);
    }
    if (!this.quietStartSelect || !this.quietEndSelect) return;
    const formatter = hourFormatter(use24Hour);
    for (const [select, value, other] of [[this.quietStartSelect, start, end], [this.quietEndSelect, end, start]]) {
      for (const option of select.options) {
        const hour = Number(option.value);
        option.textContent = formatHour(hour, formatter);
        // A window has to last at least an hour
        option.disabled = hour === other;
      }
      select.value = String(value);
    }
    // Closed, the menus are out of reach for the keyboard and screen readers too
    this.quietStartSelect.closest('.quiet-hours-schedule').inert = !enabled;
  }

  bindEvents() {
    const { signal } = this.abortController;

    // The side list: click a section, or move through it with the arrow keys
    const navItems = [...this.root.querySelectorAll('.sp-nav-item')];
    for (const item of navItems) {
      item.addEventListener('click', () => this.showSection(item.dataset.section), { signal });
      item.addEventListener('keydown', (e) => {
        const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
        if (!step) return;
        e.preventDefault();
        navItems[(navItems.indexOf(item) + step + navItems.length) % navItems.length].focus();
      }, { signal });
    }

    this.root.querySelector('#close-settings')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.close();
    }, { signal });

    // A click on the page around the window closes it, and goes no further
    // (the page would take it as a click on the photo)
    this.root.addEventListener('click', (e) => {
      if (!this.surface.contains(e.target)) {
        e.stopPropagation();
        this.close();
      }
    }, { signal });

    document.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'Tab') {
        this.trapFocus(e);
      }
    }, { signal });

    // Each change saves at once
    for (const checkbox of [this.autoPlayCheckbox, this.quietHoursCheckbox, this.clockDisplayCheckbox,
      this.googleAppsCheckbox, this.chromeTabCheckbox, this.quickGuessCheckbox]) {
      checkbox?.addEventListener('change', () => this.saveSettings(), { signal });
    }
    this.enableProductivityCheckbox?.addEventListener('change', (e) => this.handleProductivityToggle(e.target.checked), { signal });
    for (const radio of this.birdRotationRadios) {
      radio.addEventListener('change', () => {
        this.syncRotationCaption();
        this.saveSettings();
      }, { signal });
    }
    for (const radio of this.newTabModeRadios) {
      radio.addEventListener('change', async () => {
        if (!radio.checked) return;
        await setNewTabMode(radio.value);
        this.syncNewTabNote();
        this.showSaveNotification();
        // Stepping aside makes the toolbar button the way back: help pin it
        if (radio.value !== 'every') showPinCoach();
      }, { signal });
    }
    this.root.querySelector('.pin-show-me')?.addEventListener('click', () => showPinCoach(), { signal });

    bindDebugSection(this.root, this);
  }

  open() {
    this.loadSettings();
    // The region list is read (and fetched if missing) only when settings open
    this.regionSelector?.load().catch(error => warn('Region list failed to load: ' + error.message));
    this.root.classList.add('open');
    this.isOpen = true;
    document.body.style.overflow = 'hidden';
    // Into the dialog, so the keyboard and screen readers are where the eye is
    this.surface.focus({ preventScroll: true });
  }

  close() {
    if (!this.isOpen) return;
    this.root.classList.remove('open');
    this.isOpen = false;
    this.regionPicker?.close({ focusCard: false });
    document.body.style.overflow = '';
    clearInterval(this.pinPoll);
    this.pinPoll = 0;
    // Back to the settings button (queried fresh in case the page was redrawn)
    document.getElementById('settings-button')?.focus();
  }

  destroy() {
    this.abortController.abort();
    clearInterval(this.pinPoll);
    if (this.isOpen) document.body.style.overflow = '';
    this.root?.remove();
    this.root = null;
  }

  loadSettings() {
    if (!chrome?.storage?.local) {
      warn('Chrome storage API not available');
      return;
    }

    chrome.storage.local.get(['autoPlay', ...QUIET_HOURS_KEYS, 'clockDisplayMode', 'quickAccessEnabled', 'googleAppsEnabled', 'chromeTabEnabled', 'newTabMode', 'birdRotation', 'quickGuess'], (result) => {
      if (!this.root) return;
      const newTabMode = result.newTabMode || CONFIG.STORAGE_DEFAULTS.newTabMode;
      this.newTabModeRadios.forEach(r => { r.checked = r.value === newTabMode; });
      this.syncNewTabNote();
      const birdRotation = result.birdRotation || CONFIG.STORAGE_DEFAULTS.birdRotation;
      this.birdRotationRadios.forEach(r => { r.checked = r.value === birdRotation; });
      this.syncRotationCaption();
      if (this.quickGuessCheckbox) {
        this.quickGuessCheckbox.checked = result.quickGuess === true;
      }
      if (this.autoPlayCheckbox) {
        this.autoPlayCheckbox.checked = result.autoPlay || false;
      }
      if (this.quietHoursCheckbox) {
        this.quietHoursCheckbox.checked = result.quietHours || false;
      }
      this.quietHoursUse24Hour = result.clockFormat24Hour ?? false;
      this.renderQuietHours(quietHoursFrom(result));
      if (this.clockDisplayCheckbox) {
        const clockMode = result.clockDisplayMode !== undefined ? result.clockDisplayMode : 'clock';
        this.clockDisplayCheckbox.checked = (clockMode === 'clock' || clockMode === 'timer');
      }
      if (this.enableProductivityCheckbox) {
        this.enableProductivityCheckbox.checked = result.quickAccessEnabled !== undefined ? result.quickAccessEnabled : true;
      }
      if (this.googleAppsCheckbox) {
        this.googleAppsCheckbox.checked = result.googleAppsEnabled || false;
      }
      if (this.chromeTabCheckbox) {
        this.chromeTabCheckbox.checked = result.chromeTabEnabled !== false;
      }
    });
  }

  saveSettings() {
    if (!chrome?.storage?.local) {
      warn('Chrome storage API not available');
      return;
    }

    // For clock display, we need to check current mode to preserve timer state
    chrome.storage.local.get(['clockDisplayMode'], (currentSettings) => {
      const settings = {};

      if (this.autoPlayCheckbox) {
        settings.autoPlay = this.autoPlayCheckbox.checked;
      }
      if (this.quietHoursCheckbox) {
        settings.quietHours = this.quietHoursCheckbox.checked;
      }
      if (this.quietStartSelect && this.quietEndSelect) {
        settings.quietHoursStart = Number(this.quietStartSelect.value);
        settings.quietHoursEnd = Number(this.quietEndSelect.value);
        this.renderQuietHours(quietHoursFrom({
          ...settings,
          clockFormat24Hour: this.quietHoursUse24Hour,
        }));
      }
      if (this.clockDisplayCheckbox) {
        let clockDisplayMode = 'off';
        if (this.clockDisplayCheckbox.checked) {
          // On keeps the current mode (clock or timer); 'clock' if none is set
          const currentMode = currentSettings.clockDisplayMode || 'off';
          clockDisplayMode = (currentMode === 'timer') ? 'timer' : 'clock';
        }
        settings.clockDisplayMode = clockDisplayMode;
      }
      if (this.enableProductivityCheckbox) {
        settings.quickAccessEnabled = this.enableProductivityCheckbox.checked;
      }
      if (this.googleAppsCheckbox) {
        settings.googleAppsEnabled = this.googleAppsCheckbox.checked;
      }
      if (this.chromeTabCheckbox) {
        settings.chromeTabEnabled = this.chromeTabCheckbox.checked;
      }
      const birdRotation = this.birdRotationRadios.find(r => r.checked);
      if (birdRotation) {
        settings.birdRotation = birdRotation.value;
      }
      if (this.quickGuessCheckbox) {
        settings.quickGuess = this.quickGuessCheckbox.checked;
      }

      chrome.storage.local.set(settings, () => this.showSaveNotification());
    });
  }

  async handleProductivityToggle(isEnabled) {
    await handleQuickAccessToggle(isEnabled, {
      onSuccess: () => this.showSaveNotification(),
      onRevert: () => { this.enableProductivityCheckbox.checked = !isEnabled; },
      component: 'settingsPanel'
    });
  }

  /** The chosen bird segment, marked, and the line under them saying what it means. */
  syncRotationCaption() {
    const value = this.birdRotationRadios.find(r => r.checked)?.value;
    // Also as a class: :has() needs Chrome 105
    this.birdRotationRadios.forEach(r => r.closest('.pref-segment')?.classList.toggle('selected', r.checked));
    if (this.birdRotationCaption && value) this.birdRotationCaption.textContent = rotationCaption(value);
  }

  /**
   * What the chosen "Open BirdTab" mode does, in one line; and for the modes where
   * BirdTab steps aside, whether its toolbar button is pinned (checked every 1.5 s
   * while the panel is open, so it changes the moment it's pinned) and the
   * address-bar keyword.
   */
  syncNewTabNote() {
    if (!this.newTabModeRadios.length || !this.newTabCaption) return;
    clearInterval(this.pinPoll);
    this.pinPoll = 0;
    const mode = this.newTabModeRadios.find(r => r.checked)?.value || 'every';
    // Also as a class: :has() needs Chrome 105
    this.newTabModeRadios.forEach(r => r.closest('.mode-card')?.classList.toggle('selected', r.checked));
    const captions = {
      every: ['newTabModeEveryHelp', 'A bird on every new tab.'],
      hourly: ['newTabModeHourlyHelp', 'A bird on your first new tab after an hour away; Chrome’s own page the rest of the time.'],
      button: ['newTabModeButtonHelp', 'Chrome’s own new tab page. Click BirdTab’s toolbar button whenever you want a bird.'],
    };
    const [key, fallback] = captions[mode];
    this.newTabCaption.textContent = getMessage(key) || fallback;

    const stepsAside = mode !== 'every';
    if (this.pinRow) this.pinRow.hidden = !stepsAside;
    if (this.keywordTip) {
      this.keywordTip.hidden = !stepsAside;
      if (stepsAside && !this.keywordTip.childElementCount) {
        // "Or type $1 and a space in the address bar": the keyword as a key cap
        const [before, after = ''] = (chrome.i18n.getMessage('newTabModeKeyword', ['⁣']) || 'Or type ⁣ and a space in the address bar').split('⁣');
        const kbd = document.createElement('kbd');
        kbd.textContent = 'bird';
        this.keywordTip.replaceChildren(document.createTextNode(before), kbd, document.createTextNode(after));
      }
    }
    if (!stepsAside || !this.pinRow) return;

    const update = async () => {
      if (!this.isOpen && this.pinPoll) {
        clearInterval(this.pinPoll);
        this.pinPoll = 0;
        return;
      }
      const pinned = await isPinnedToToolbar();
      if (!this.root) return;
      this.pinRow.classList.toggle('pinned', pinned === true);
      this.pinRow.querySelector('.pin-status-text').textContent = pinned
        ? (getMessage('newTabModePinned') || 'Pinned to your toolbar')
        : (getMessage('newTabModeNotPinned') || 'Not pinned yet');
      this.pinRow.querySelector('.pin-show-me').hidden = pinned === true;
    };
    update();
    this.pinPoll = setInterval(update, 1500);
  }

  showSaveNotification() {
    document.querySelector('.settings-save-notification')?.remove();

    const notification = document.createElement('div');
    notification.className = 'settings-save-notification';
    notification.textContent = getMessage('settingsSaved');
    document.body.appendChild(notification);
    announce(notification.textContent);

    // In after the change has had a moment to show, out after two seconds
    setTimeout(() => notification.classList.add('show'), 200);
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => notification.remove(), 300);
    }, 2000);
  }

  /** Keep Tab inside the dialog. */
  trapFocus(e) {
    const focusable = [...this.surface.querySelectorAll(FOCUSABLE)].filter(el => !el.closest('[hidden], [inert]'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const inside = this.surface.contains(document.activeElement);

    if (e.shiftKey && (document.activeElement === first || document.activeElement === this.surface || !inside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
      e.preventDefault();
      first.focus();
    }
  }
}

let panel = null;

/** Build the window (once). */
export function initSettingsPanel() {
  if (!panel) panel = new SettingsPanel();
  return panel;
}

export function openSettings() {
  initSettingsPanel().open();
}

/** Tests: drop the window so the next init builds afresh. */
export function resetSettingsPanel() {
  panel?.destroy();
  panel = null;
}
