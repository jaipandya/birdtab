/**
 * The welcome: the first new tab after install is the onboarding.
 *
 * The page shows its first bird as on any tab, without the clock, search and buttons
 * (html.first-run, styles.css), and this card sits in a corner of it:
 *   1. Meet  - the bird, and its song a click away
 *   2. Setup - where the birds come from (the time zone's country suggested) and whether songs
 *              play as each tab opens
 * "Start birding" saves both, the page's own controls come in, and a note says to open a new
 * tab for the next bird (with the chosen region's download, and on Firefox its keep-this-page
 * question). Loaded on demand (script.js), so other tabs never download it.
 */

import './welcome.css';
import CONFIG from '../config.js';
import { log } from '../logger.js';
import { html, setHtml } from '../utils/html.js';
import { RELEASE_KEY } from '../mediaClient.js';
import { getRegionDisplayName, buildRegionOptions, formatProgress } from '../settings/regionSelector.js';
import { RegionPicker } from '../settings/regionPicker.js';
import { getQuietHours, formatQuietHours } from '../quietHours.js';
import { track, trackOnboardingCompleted } from '../analytics.js';
import { IS_FIREFOX } from '../browserInfo.js';
import { suggestRegion, browserTimeZone } from './regionSuggest.js';
import { startGuide } from '../guide/guide.js';

const WORLD = CONFIG.MEDIA.DEFAULT_REGION;
const { REGION_SWITCH_STATE_KEY } = CONFIG.MEDIA;
// The note stays this long once the next bird is ready (it goes at once when the tab is left)
const NOTE_MS = 20000;

const msg = (key, subs, fallback = '') => (subs ? chrome.i18n.getMessage(key, subs) : chrome.i18n.getMessage(key)) || fallback;

const PLAY_ICON = html`<svg class="welcome-song-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>`;
const PAUSE_ICON = html`<svg class="welcome-song-pause" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>`;
const CHEVRON = html`<svg class="welcome-other-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;

let open = null;

export function isWelcomeOpen() {
  return open !== null;
}

/** ⌘T on a Mac, Ctrl+T elsewhere, as key caps. */
function newTabKeys() {
  // userAgentData says "macOS", navigator.platform "MacIntel"
  const platform = `${navigator.userAgentData?.platform || ''} ${navigator.platform || ''}`;
  const mac = /mac|iphone|ipad/i.test(platform);
  return mac ? ['⌘', 'T'] : ['Ctrl', 'T'];
}

async function storedRegions() {
  const { [RELEASE_KEY]: stored } = await chrome.storage.local.get([RELEASE_KEY]);
  return stored?.index?.regions || null;
}

/** The release's regions; asks the background to discover the release if none is stored yet. */
async function loadRegions() {
  const regions = await storedRegions();
  if (regions) return regions;
  await new Promise(resolve => {
    try {
      chrome.runtime.sendMessage({ action: 'loadRegionIndex' }, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    } catch {
      resolve();
    }
  });
  return (await storedRegions()) || [{ code: WORLD }];
}

function sendMessage(message) {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage(message, response => {
        resolve(chrome.runtime.lastError ? { success: false, error: chrome.runtime.lastError.message } : (response || { success: false }));
      });
    } catch (error) {
      resolve({ success: false, error: error.message });
    }
  });
}

/**
 * @param {Object} options
 * @param {string} options.birdName - the first bird's name in the UI language
 * @param {string|null} options.songLength - e.g. "0:46"; null when the bird has no recording to play
 * @param {{ toggle: () => Promise<void>, pause: () => void }} options.audio - the page's player
 * @param {() => void} options.onDone - the welcome is finished (or skipped): bring in the page
 */
export async function showWelcome({ birdName, songLength, audio, onDone }) {
  if (open) return;
  const startedAt = Date.now();
  const hasSong = songLength !== null;
  const { region: currentRegion = WORLD } = await chrome.storage.local.get(['region']);
  const quiet = await getQuietHours();
  const quietText = formatQuietHours(quiet);

  const root = document.createElement('div');
  root.className = 'welcome';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-labelledby', 'welcome-meet-title');
  setHtml(root, html`
    <div class="welcome-card">
      <section class="welcome-step" data-step="meet" aria-labelledby="welcome-meet-title">
        <p class="welcome-eyebrow">
          <img src="icons/icon32.png" alt="" width="20" height="20">
          <span>${msg('welcomeEyebrow', null, 'Welcome to BirdTab')}</span>
        </p>
        <h1 class="welcome-title" id="welcome-meet-title" tabindex="-1">${msg('welcomeHeadline', null, 'A new bird every time you open a tab')}</h1>
        <p class="welcome-text">${msg(hasSong ? 'welcomeIntro' : 'welcomeIntroNoSong', null,
          hasSong ? 'Each one comes with its photo, its song and a map of where it lives.' : 'Each one comes with its photo, facts and a map of where it lives.')}</p>
        <p class="welcome-legend">${msg('welcomeFirstBird', null, 'Your first bird')}</p>
        ${hasSong ? html`
        <button type="button" class="welcome-bird welcome-song">
          <span class="welcome-song-icon" aria-hidden="true">${PLAY_ICON}${PAUSE_ICON}</span>
          <span class="welcome-bird-text">
            <span class="welcome-bird-name">${birdName}</span>
            <span class="welcome-song-label">${msg('welcomeHearSong', null, 'Hear its song')}</span>
          </span>
          <span class="welcome-song-time" aria-hidden="true">
            <span class="welcome-song-length">${songLength}</span>
            <span class="welcome-song-bars"><i></i><i></i><i></i><i></i></span>
          </span>
          <span class="welcome-song-progress" aria-hidden="true"><i></i></span>
        </button>` : html`
        <div class="welcome-bird">
          <span class="welcome-song-icon" aria-hidden="true"><img src="images/svg/bird.svg" alt="" width="22" height="22"></span>
          <span class="welcome-bird-text"><span class="welcome-bird-name">${birdName}</span></span>
        </div>`}
        <div class="welcome-actions">
          <button type="button" class="welcome-btn quiet" data-action="skip">${msg('welcomeSkip', null, 'Skip')}</button>
          <span class="welcome-dots" aria-hidden="true"><i class="on"></i><i></i></span>
          <button type="button" class="welcome-btn primary" data-action="next">${msg('welcomeContinue', null, 'Continue')}</button>
        </div>
      </section>

      <section class="welcome-step" data-step="setup" aria-labelledby="welcome-setup-title" hidden>
        <h2 class="welcome-title" id="welcome-setup-title" tabindex="-1">${msg('welcomeSetupTitle', null, 'Make it yours')}</h2>
        <div class="welcome-scroll">
          <div class="welcome-group">
            <p class="welcome-legend" id="welcome-region-label">${msg('regionLeadLabel', null, 'Birds from')}</p>
            <div class="pref-options welcome-regions" role="radiogroup" aria-labelledby="welcome-region-label"></div>
            <button type="button" class="welcome-other" aria-expanded="false" aria-controls="welcome-region-picker">
              <span>${msg('welcomeOtherRegion', null, 'Another country or region')}</span>${CHEVRON}
            </button>
            <div class="region-picker welcome-region-picker" id="welcome-region-picker" hidden>
              <label class="region-search">
                <img src="images/svg/search.svg" alt="" width="16" height="16">
                <input type="search" id="welcome-region-search" role="combobox" aria-expanded="true" aria-controls="welcome-region-options"
                  aria-autocomplete="list" autocomplete="off" spellcheck="false"
                  placeholder="${msg('regionSearchPlaceholder', null, 'Search regions')}" aria-label="${msg('regionSearchPlaceholder', null, 'Search regions')}">
              </label>
              <ul class="region-options" id="welcome-region-options" role="listbox" aria-labelledby="welcome-region-label"></ul>
              <p class="pref-help region-empty" hidden>${msg('regionNoMatch', null, 'No region by that name.')}</p>
            </div>
          </div>

          <div class="welcome-group welcome-sound">
            <p class="welcome-legend" id="welcome-sound-label">${msg('welcomeSoundLabel', null, 'Bird songs')}</p>
            <div class="pref-options" role="radiogroup" aria-labelledby="welcome-sound-label">
              <label class="pref-option">
                <input type="radio" name="welcome-sound" value="on">
                <span class="pref-option-text">
                  <span class="pref-option-name">${msg('welcomeSoundOn', null, 'Play as each tab opens')}</span>
                </span>
              </label>
              <label class="pref-option">
                <input type="radio" name="welcome-sound" value="off" checked>
                <span class="pref-option-text">
                  <span class="pref-option-name">${msg('welcomeSoundOff', null, 'Only when I press play')}</span>
                </span>
              </label>
            </div>
            <label class="welcome-quiet" hidden>
              <input type="checkbox" checked>
              <span>${msg('welcomeQuietNights', [quietText], `Quiet at night, ${quietText}`)}</span>
            </label>
          </div>
        </div>
        <p class="welcome-later">${msg('welcomeChangeLater', null, 'You can change these anytime in Settings.')}</p>
        <div class="welcome-actions">
          <button type="button" class="welcome-btn quiet" data-action="back">${msg('welcomeBack', null, 'Back')}</button>
          <span class="welcome-dots" aria-hidden="true"><i></i><i class="on"></i></span>
          <button type="button" class="welcome-btn primary" data-action="start">${msg('welcomeStart', null, 'Start birding')}</button>
        </div>
      </section>
    </div>
  `);
  document.body.appendChild(root);

  const card = root.querySelector('.welcome-card');
  const steps = {
    meet: root.querySelector('[data-step="meet"]'),
    setup: root.querySelector('[data-step="setup"]'),
  };
  let step = 'meet';
  let heardSong = false;
  let finishing = false;

  // ── The song ──
  const songButton = root.querySelector('.welcome-song');
  const progress = root.querySelector('.welcome-song-progress i');
  const onAudio = (e) => {
    const { playing, buffering, currentTime, duration } = e.detail || {};
    if (songButton) {
      songButton.classList.toggle('playing', !!playing);
      songButton.classList.toggle('buffering', !!buffering && !!playing);
      songButton.querySelector('.welcome-song-label').textContent = playing
        ? msg('welcomePause', null, 'Pause')
        : msg(heardSong ? 'welcomePlayAgain' : 'welcomeHearSong', null, heardSong ? 'Play again' : 'Hear its song');
    }
    if (progress && duration > 0 && Number.isFinite(currentTime)) {
      progress.style.transform = `scaleX(${Math.min(currentTime / duration, 1)})`;
    }
  };
  document.addEventListener('birdtab:audio', onAudio);
  songButton?.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!heardSong) track('welcome_song_played');
    heardSong = true;
    await audio.toggle();
  });

  // ── Steps ──
  const showStep = (next) => {
    const from = card.getBoundingClientRect().height;
    steps[step].hidden = true;
    steps[next].hidden = false;
    step = next;
    root.setAttribute('aria-labelledby', next === 'meet' ? 'welcome-meet-title' : 'welcome-setup-title');
    // Grow or shrink to the new step instead of jumping
    const to = card.getBoundingClientRect().height;
    if (Math.abs(to - from) > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      card.style.height = `${from}px`;
      void card.offsetHeight;
      card.classList.add('resizing');
      card.style.height = `${to}px`;
      card.addEventListener('transitionend', () => {
        card.classList.remove('resizing');
        card.style.height = '';
      }, { once: true });
    }
    steps[next].classList.remove('entering');
    void steps[next].offsetWidth;
    steps[next].classList.add('entering');
    steps[next].querySelector('.welcome-title').focus({ preventScroll: true });
  };

  // ── Where the birds come from ──
  const regionList = root.querySelector('.welcome-regions');
  const otherButton = root.querySelector('.welcome-other');
  let regions = [{ code: WORLD }];
  let suggestion = null;
  let chosenRegion = currentRegion;
  let otherRegion = null;
  // Once the user picks a region, a suggestion arriving late doesn't change it
  let regionTouched = false;

  const regionName = (code) => getRegionDisplayName(regions.find(r => r.code === code) || { code });
  const regionOption = (code, help) => html`
    <label class="pref-option">
      <input type="radio" name="welcome-region" value="${code}" ${code === chosenRegion ? 'checked' : ''}>
      <span class="pref-option-text">
        <span class="pref-option-name">${regionName(code)}</span>
        ${help ? html`<span class="pref-help">${help}</span>` : ''}
      </span>
    </label>`;
  const renderRegions = () => {
    const codes = [];
    if (suggestion) codes.push(suggestion.code);
    if (otherRegion && !codes.includes(otherRegion)) codes.push(otherRegion);
    if (!codes.includes(WORLD)) codes.push(WORLD);
    if (!codes.includes(chosenRegion)) codes.unshift(chosenRegion);
    setHtml(regionList, codes.map(code => {
      let help = '';
      if (code === WORLD) help = msg('welcomeWorldHelp', null, 'Birds from every continent');
      else if (suggestion?.code === code) {
        help = suggestion.small
          ? msg('welcomeSmallRegion', null, 'A short list, so birds repeat more often')
          : msg(suggestion.source === 'timeZone' ? 'welcomeSuggestedTimeZone' : 'welcomeSuggestedLanguage', null,
            suggestion.source === 'timeZone' ? 'Suggested from your time zone' : 'Suggested from your browser’s language');
      }
      return regionOption(code, help);
    }));
  };
  regionList.addEventListener('change', (e) => {
    if (e.target.name !== 'welcome-region') return;
    chosenRegion = e.target.value;
    regionTouched = true;
  });

  const picker = new RegionPicker(root, {
    card: otherButton,
    nameEl: null,
    panel: root.querySelector('#welcome-region-picker'),
    search: root.querySelector('#welcome-region-search'),
    list: root.querySelector('#welcome-region-options'),
    empty: root.querySelector('.welcome-region-picker .region-empty'),
    optionIdPrefix: 'welcome-region-',
  });
  picker.onChoose = (code) => {
    chosenRegion = code;
    regionTouched = true;
    if (code !== suggestion?.code && code !== WORLD) otherRegion = code;
    renderRegions();
    regionList.querySelector(`input[value="${code}"]`)?.focus();
  };

  (async () => {
    regions = await loadRegions();
    suggestion = suggestRegion({ timeZone: browserTimeZone(), languages: navigator.languages || [], regions });
    // A fresh install starts on World: the suggestion is chosen unless its list is short
    if (suggestion && !suggestion.small && currentRegion === WORLD && !regionTouched) chosenRegion = suggestion.code;
    renderRegions();
    picker.setOptions(buildRegionOptions(regions));
    picker.value = chosenRegion;
  })();
  renderRegions();

  // ── Songs ──
  const quietRow = root.querySelector('.welcome-quiet');
  root.querySelector('.welcome-sound').addEventListener('change', (e) => {
    if (e.target.name === 'welcome-sound') quietRow.hidden = e.target.value !== 'on';
  });

  // ── Finishing ──
  const close = () => {
    if (!open) return;
    document.removeEventListener('birdtab:audio', onAudio);
    chrome.storage.onChanged.removeListener(onStorage);
    open = null;
    root.classList.add('leaving');
    setTimeout(() => root.remove(), 320);
    onDone();
  };

  const finish = async (skipped) => {
    if (finishing) return;
    finishing = true;
    const autoPlay = !skipped && root.querySelector('input[name="welcome-sound"]:checked')?.value === 'on';
    const quietNights = autoPlay && root.querySelector('.welcome-quiet input').checked;
    const region = skipped ? currentRegion : chosenRegion;

    const settings = { autoPlay };
    if (autoPlay) settings.quietHours = quietNights;
    await chrome.storage.local.set(settings);
    await startGuide();
    await chrome.storage.sync.set({ onboardingComplete: true });

    trackOnboardingCompleted(region, autoPlay, {
      region_choice: skipped ? 'skipped'
        : region === suggestion?.code ? 'suggested' : region === WORLD ? 'world' : 'other',
      suggested_region: suggestion?.code || null,
      suggestion_source: suggestion?.source || null,
      heard_song: heardSong,
      quiet_hours: quietNights,
      seconds: Math.round((Date.now() - startedAt) / 1000),
    });
    log(`Welcome ${skipped ? 'skipped' : 'done'}: region ${region}, songs ${autoPlay ? 'on' : 'off'}`);

    close();
    showNextTabNote(region !== currentRegion ? { code: region, name: regionName(region), from: regionName(currentRegion) } : null);
  };

  root.addEventListener('click', (e) => {
    // The card's clicks are its own, not the page's play/pause
    e.stopPropagation();
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'next') showStep('setup');
    else if (action === 'back') showStep('meet');
    else if (action === 'skip') finish(true);
    else if (action === 'start') finish(false);
  });

  // Finished in another tab: this one steps aside too
  const onStorage = (changes, area) => {
    if (area === 'sync' && changes.onboardingComplete?.newValue === true && !finishing) {
      finishing = true;
      close();
    }
  };
  chrome.storage.onChanged.addListener(onStorage);

  open = { root };
  requestAnimationFrame(() => root.classList.add('visible'));
  // The heading first, so a screen reader starts at the top; Tab reaches the song next
  root.querySelector('#welcome-meet-title').focus({ preventScroll: true });
  track('welcome_shown', { has_song: hasSong });
}

/**
 * After the welcome: open a new tab for the next bird. While a chosen region downloads it says so
 * (with the percentage); on Firefox, which asks once whether to keep an extension's new tab page,
 * it says to keep it.
 * @param {{ code: string, name: string, from: string } | null} switching
 */
function showNextTabNote(switching) {
  const note = document.createElement('div');
  note.className = 'welcome-note';
  note.setAttribute('role', 'status');
  const [modifier, key] = newTabKeys();
  setHtml(note, html`
    <div class="welcome-note-row">
      <span class="welcome-note-spinner" aria-hidden="true" hidden></span>
      <span class="welcome-note-text"></span>
      <span class="welcome-note-keys" aria-hidden="true"><kbd>${modifier}</kbd><kbd>${key}</kbd></span>
      <button type="button" class="welcome-note-retry" hidden>${msg('tryAgain', null, 'Try Again')}</button>
      <button type="button" class="welcome-note-close" aria-label="${msg('closeAlt', null, 'Close')}">
        <img src="images/svg/close.svg" alt="" width="12" height="12">
      </button>
    </div>
    ${IS_FIREFOX ? html`<p class="welcome-note-sub">${msg('welcomeFirefoxKeep', null, 'If Firefox asks about your new tab page, keep the change.')}</p>` : ''}
  `);
  document.body.appendChild(note);

  const text = note.querySelector('.welcome-note-text');
  const keys = note.querySelector('.welcome-note-keys');
  const spinner = note.querySelector('.welcome-note-spinner');
  const retry = note.querySelector('.welcome-note-retry');
  let hideTimer = null;

  const remove = () => {
    clearTimeout(hideTimer);
    document.removeEventListener('visibilitychange', onHidden);
    chrome.storage.onChanged.removeListener(onProgress);
    note.classList.add('leaving');
    setTimeout(() => note.remove(), 400);
  };
  const onHidden = () => {
    if (document.visibilityState === 'hidden') remove();
  };
  const ready = () => {
    spinner.hidden = true;
    retry.hidden = true;
    keys.hidden = false;
    text.textContent = msg('welcomeNextTab', null, 'Open a new tab to meet your next bird');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(remove, NOTE_MS);
  };
  const loading = (received, expected) => {
    spinner.hidden = false;
    retry.hidden = true;
    keys.hidden = true;
    const percent = formatProgress(received, expected);
    const loadingText = msg('regionLoadingBirds', [switching.name], `Loading birds for ${switching.name}…`);
    text.textContent = percent ? `${loadingText} ${percent}` : loadingText;
  };
  const failed = () => {
    spinner.hidden = true;
    keys.hidden = true;
    retry.hidden = false;
    text.textContent = msg('regionSwitchFailed', [switching.name, switching.from], `Couldn't load birds for ${switching.name}.`);
  };
  const onProgress = (changes, area) => {
    const state = area === 'session' ? changes[REGION_SWITCH_STATE_KEY]?.newValue : null;
    if (switching && state?.code === switching.code && state.state === 'loading') loading(state.received, state.expected);
  };
  const startSwitch = async () => {
    loading(0, null);
    const result = await sendMessage({ action: 'switchRegion', region: switching.code });
    if (result.success) ready();
    else if (!result.superseded) failed();
  };

  note.querySelector('.welcome-note-close').addEventListener('click', remove);
  retry.addEventListener('click', startSwitch);
  document.addEventListener('visibilitychange', onHidden);
  requestAnimationFrame(() => note.classList.add('visible'));

  if (switching) {
    chrome.storage.onChanged.addListener(onProgress);
    startSwitch();
  } else {
    ready();
  }
}
