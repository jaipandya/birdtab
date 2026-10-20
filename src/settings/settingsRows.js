/**
 * What the settings window holds: the sections (Birds, New Tab, Sound, On the Page), their
 * rows, and the footer. settingsPanel.js lays them out and keeps them in step with storage.
 *
 * Every control keeps the id the panel and RegionSelector look up, and every row says what
 * it does in a visible line under its name.
 */
import { IS_EDGE, canOpenBrowserNewTab } from '../browserInfo.js';
import CONFIG from '../config.js';
import { html, trustedHtml } from '../utils/html.js';
import { regionPickerHtml } from './regionPicker.js';

// Small pictures of a browser window for the "Open BirdTab" choices
const BIRD_GLYPH = '<g class="art-bird" transform="translate(32 18) scale(1.05)"><path d="M16 7h.01"/><path d="M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20"/><path d="m20 7 2 .5-2 .5"/><path d="M10 18v3"/><path d="M14 17.75V21"/><path d="M7 18a6 6 0 0 0 3.84-10.61"/></g>';
function modeArt(mode) {
  const frame = '<rect class="art-frame" x="1" y="1" width="86" height="54" rx="7"/>'
    + '<path class="art-strip" d="M1 8a7 7 0 0 1 7-7h72a7 7 0 0 1 7 7v4H1z"/>';
  const photo = '<rect class="art-photo" x="5" y="15" width="78" height="36" rx="4"/>';
  const art = {
    every: frame + '<rect class="art-tab active" x="6" y="4" width="16" height="6" rx="2"/>'
      + '<rect class="art-tab" x="25" y="4" width="16" height="6" rx="2"/><rect class="art-tab" x="44" y="4" width="16" height="6" rx="2"/>'
      + photo + BIRD_GLYPH,
    hourly: frame + '<rect class="art-tab active" x="6" y="4" width="16" height="6" rx="2"/><rect class="art-tab" x="25" y="4" width="16" height="6" rx="2"/>'
      + photo + BIRD_GLYPH
      + '<circle class="art-badge" cx="72" cy="40" r="8"/><path class="art-badge-hands" d="M72 35.5V40l3 2"/>',
    button: frame + '<rect class="art-tab active" x="6" y="4" width="16" height="6" rx="2"/>'
      + '<rect class="art-chrome-page" x="5" y="15" width="78" height="36" rx="4"/>'
      + '<rect class="art-line" x="26" y="27" width="36" height="5" rx="2.5"/><rect class="art-line faint" x="30" y="37" width="28" height="3" rx="1.5"/>'
      + '<circle class="art-button" cx="78" cy="7" r="5"/><path class="art-cursor" d="M79 9.5l5.5 2.2-2.4 1 1.6 2.6-1.3.8-1.6-2.6-1.8 1.8z"/>',
  }[mode];
  return trustedHtml(`<svg class="mode-art" viewBox="0 0 88 56" aria-hidden="true">${art}</svg>`);
}

/**
 * One on/off setting: name, a line saying what it does, and the switch. The whole row is the
 * input's label, so a click anywhere on it toggles.
 */
function toggleRow({ id, labelKey, label, helpKey, help }) {
  return html`
    <label class="pref-row pref-toggle">
      <span class="pref-text">
        <span class="pref-label" data-i18n="${labelKey}">${label}</span>
        <span class="pref-help" id="${id}-help" data-i18n="${helpKey}">${help}</span>
      </span>
      <input type="checkbox" class="pref-switch" id="${id}" aria-describedby="${id}-help">
    </label>`;
}

const ROTATION = [
  { value: 'every', labelKey: 'birdRotationKeepTab', label: 'One tab', helpKey: 'birdRotationTabHelp', help: 'A different bird in every new tab.' },
  { value: 'hourly', labelKey: 'birdRotationKeepHour', label: 'An hour', helpKey: 'birdRotationHourHelp', help: 'The same bird for an hour, then a new one.' },
  { value: 'daily', labelKey: 'birdRotationKeepDay', label: 'A day', helpKey: 'birdRotationDayHelp', help: 'One bird for the whole day.' },
];

/** How long a bird stays: a choice per line, each with a sentence saying what it means. */
function rotationRow() {
  return html`
    <div class="pref-row pref-stack">
      <span class="pref-text">
        <span class="pref-label" id="bird-rotation-label" data-i18n="birdRotationKeepLabel">Keep each bird for</span>
        <span class="pref-help" id="bird-rotation-help" data-i18n="birdRotationHelp">The refresh button always brings a new bird.</span>
      </span>
      <div class="pref-options" role="radiogroup" aria-labelledby="bird-rotation-label" aria-describedby="bird-rotation-help">
        ${ROTATION.map(o => html`
        <label class="pref-option">
          <input type="radio" name="bird-rotation" value="${o.value}">
          <span class="pref-option-text">
            <span class="pref-option-name" data-i18n="${o.labelKey}">${o.label}</span>
            <span class="pref-help" data-i18n="${o.helpKey}">${o.help}</span>
          </span>
        </label>`)}
      </div>
    </div>`;
}

function newTabModeRow() {
  return html`
    <div class="pref-row pref-stack">
      <span class="pref-label" id="new-tab-mode-label" data-i18n="newTabModeLabel">Open BirdTab</span>
      <div class="mode-cards" role="radiogroup" aria-labelledby="new-tab-mode-label" aria-describedby="modal-new-tab-caption">
        ${['every', 'hourly', 'button'].map(mode => html`
        <label class="mode-card">
          <input type="radio" name="new-tab-mode" value="${mode}">
          ${modeArt(mode)}
          <span class="mode-card-name" data-i18n="${{ every: 'newTabModeEvery', hourly: 'newTabModeHourly', button: 'newTabModeButton' }[mode]}"></span>
        </label>`)}
      </div>
      <p id="modal-new-tab-caption" class="pref-help mode-caption" aria-live="polite"></p>
      <div class="pin-row" hidden>
        <span class="pin-status"><span class="pin-status-dot" aria-hidden="true"></span><span class="pin-status-text"></span></span>
        <button type="button" class="pin-show-me" data-i18n="pinShowMe">Show me how</button>
      </div>
      <p class="keyword-tip" hidden></p>
    </div>`;
}

function chromeTabRow() {
  return toggleRow({
    id: 'modal-chrome-tab',
    labelKey: 'showChromeTab', label: 'Chrome Tab Shortcut',
    helpKey: 'showChromeTabShort', help: 'A link to Chrome’s own new tab page.',
  });
}

/** Off: the hours under the name. On: that line opens into "From [8 PM] to [8 AM]". */
function quietHoursRow() {
  return html`
    <div class="quiet-hours-setting">
      <label class="pref-row pref-toggle">
        <span class="pref-text">
          <span class="pref-label" data-i18n="quietHours">Quiet Hours</span>
          <span class="pref-help quiet-hours-summary" id="modal-quiet-hours-text"></span>
        </span>
        <input type="checkbox" class="pref-switch" id="modal-quiet-hours" aria-describedby="modal-quiet-hours-text" aria-controls="modal-quiet-hours-schedule">
      </label>
      <div class="quiet-hours-schedule" id="modal-quiet-hours-schedule">
        <p class="quiet-hours-sentence"></p>
      </div>
    </div>`;
}

/**
 * The sections in order, each { key, titleKey, title, icon, body }. A section a browser doesn't
 * have (New Tab on Firefox) is left out.
 */
export function settingsSections() {
  const sections = [];
  const hasNewTab = CONFIG.FEATURES.newTabMode;

  sections.push({
    key: 'birds', titleKey: 'settingsGroupBirds', title: 'Birds', icon: 'images/svg/bird.svg',
    body: html`
      ${regionPickerHtml()}
      ${CONFIG.FEATURES.birdRotation ? rotationRow() : ''}
      ${CONFIG.FEATURES.quickGuess ? toggleRow({
        id: 'modal-quick-guess', labelKey: 'quickGuessLabel', label: 'Guess the Bird',
        helpKey: 'quickGuessShort', help: 'Hide the name until you click it',
      }) : ''}`,
  });

  if (hasNewTab) {
    sections.push({
      key: 'newTab', titleKey: 'settingsCategoryNewTab', title: 'New Tab', icon: 'images/svg/external-link.svg',
      body: html`
        ${newTabModeRow()}
        ${canOpenBrowserNewTab() ? chromeTabRow() : ''}`,
    });
  }

  sections.push({
    key: 'sound', titleKey: 'settingsGroupSound', title: 'Sound', icon: 'images/svg/sound-on.svg',
    body: html`
      ${toggleRow({
        id: 'modal-auto-play', labelKey: 'autoPlayLabel', label: 'Play Bird Songs',
        helpKey: 'autoPlayShort', help: 'Starts when a new tab opens.',
      })}
      ${quietHoursRow()}`,
  });

  sections.push({
    key: 'page', titleKey: 'settingsGroupPage', title: 'On the Page', icon: 'images/svg/layout.svg',
    body: html`
      ${toggleRow({
        id: 'modal-clock-display',
        labelKey: 'clockDisplay', label: 'Show Clock',
        helpKey: 'clockDisplayHelpText', help: 'Display a large clock above the search box.',
      })}
      ${toggleRow({
        id: 'modal-enable-productivity',
        labelKey: 'quickAccessLabel', label: 'Search and Top Sites',
        helpKey: 'quickAccessShort', help: 'A search box, your top sites and shortcuts.',
      })}
      ${IS_EDGE ? '' : toggleRow({
        id: 'modal-google-apps',
        labelKey: 'googleApps', label: 'Google Apps',
        helpKey: 'googleAppsShort', help: 'Gmail, Drive, YouTube and more.',
      })}
      ${!hasNewTab && canOpenBrowserNewTab() ? chromeTabRow() : ''}`,
  });

  return sections;
}

/** Feedback, and where the bird names come from (IOC's CC BY licence asks for credit). */
export function footerHtml() {
  return html`
    <div class="pref-footer">
      <a href="mailto:support@birdtab.app" class="pref-feedback">
        <img src="images/svg/message.svg" alt="" width="15" height="15">
        <span data-i18n="sendFeedback">Send Feedback</span>
      </a>
      <p class="pref-credits">
        <span data-i18n="birdNamesCredit">Bird names:</span>
        <a href="https://ebird.org" target="_blank" rel="noopener noreferrer">eBird</a> ·
        <a href="https://www.worldbirdnames.org" target="_blank" rel="noopener noreferrer">IOC World Bird List</a>
        (<a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener noreferrer">CC BY 3.0</a>)
      </p>
    </div>`;
}
