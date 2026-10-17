/**
 * Your Birds (Chrome, CONFIG.FEATURES.yourBirds)
 *
 * One place for the birds you've met on new tabs: each species once, most recently
 * seen first, with how many different birds you've seen so far. Favorites is a
 * filter of the same list, and any card can be shown again or (un)favourited in place.
 * Replaces the viewing history panel on Chrome (historyModal.js keeps it elsewhere).
 */

import { html, setHtml, insertHtml } from './utils/html.js';
import { getRelativeTimeString } from './historyModal.js';
import { getSeenBirds, clearSeenBirds, localizedName } from './seenBirds.js';
import { getFavorites, toggleFavorite, clearFavorites } from './favorites.js';
import { showConfirmationDialog } from './confirmationDialog.js';
import { trackFeature } from './analytics.js';
import { log } from './logger.js';

const HEART_PATH = 'M12 20.5s-7.5-4.6-9.3-9.2C1.5 8.2 3.4 4.5 7 4.5c2.1 0 3.7 1.2 5 3 1.3-1.8 2.9-3 5-3 3.6 0 5.5 3.7 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z';

let panel = null;
let filter = 'all';
let query = '';
let seen = [];
let favorites = [];
// Starts a quiz on a list of birds (script.js owns the quiz)
let startQuizOn = null;

// A bird shown again reloads the page; this brings the panel back as it was
const REOPEN_KEY = 'birdtab:reopenYourBirds';
const QUIZ_MIN_BIRDS = 4;

const msg = (key, subs, fallback) => chrome.i18n.getMessage(key, subs) || fallback;

function createPanel() {
  insertHtml(document.body, 'beforeend', html`
    <div id="your-birds-sidebar" class="settings-sidebar your-birds" role="dialog" aria-modal="true" aria-labelledby="your-birds-title">
      <div class="settings-content history-content">
        <div class="settings-header">
          <h2 id="your-birds-title">${msg('yourBirdsTitle', undefined, 'Your Birds')}</h2>
          <button class="close-button" id="close-your-birds" aria-label="${msg('closeAlt', undefined, 'Close')}">
            <img src="images/svg/close.svg" alt="" width="20" height="20">
          </button>
        </div>
        <div class="your-birds-top">
          <p class="your-birds-count">
            <span class="your-birds-count-number" id="your-birds-count">0</span>
            <span class="your-birds-count-label">${msg('yourBirdsCountLabel', undefined, 'different birds seen')}</span>
          </p>
          <label class="your-birds-search">
            <img src="images/svg/search.svg" alt="" width="16" height="16">
            <input type="search" id="your-birds-search" autocomplete="off"
              placeholder="${msg('yourBirdsSearch', undefined, 'Find a bird')}" aria-label="${msg('yourBirdsSearch', undefined, 'Find a bird')}">
          </label>
          <div class="segmented your-birds-filter" role="radiogroup" aria-label="${msg('yourBirdsTitle', undefined, 'Your Birds')}">
            <label class="segment"><input type="radio" name="your-birds-filter" value="all"><span>${msg('yourBirdsFilterAll', undefined, 'All')} <b class="segment-count" id="your-birds-count-all"></b></span></label>
            <label class="segment"><input type="radio" name="your-birds-filter" value="favorites"><span>${msg('favoritesTitle', undefined, 'Favorites')} <b class="segment-count" id="your-birds-count-favorites"></b></span></label>
          </div>
        </div>
        <div class="settings-body">
          <div id="your-birds-grid" class="your-birds-grid"></div>
          <div id="your-birds-empty" class="your-birds-empty" hidden>
            <img src="images/svg/bird.svg" alt="" width="40" height="40" class="your-birds-empty-icon">
            <p class="your-birds-empty-title"></p>
            <p class="your-birds-empty-text"></p>
          </div>
        </div>
        <div class="history-footer your-birds-footer">
          <button id="your-birds-quiz" class="your-birds-quiz" type="button">
            <img src="images/svg/quiz.svg" alt="" width="16" height="16">
            <span>${msg('yourBirdsQuiz', undefined, 'Quiz me on these')}</span>
          </button>
          <button id="your-birds-clear" class="shortcut-btn secondary" type="button">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="3,6 5,6 21,6"></polyline>
              <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2"></path>
            </svg>
            <span class="your-birds-clear-label"></span>
          </button>
        </div>
      </div>
    </div>
  `);
  panel = document.getElementById('your-birds-sidebar');
  bindEvents();
}

function bindEvents() {
  document.getElementById('close-your-birds').addEventListener('click', closeYourBirds);
  panel.addEventListener('click', (e) => {
    if (e.target === panel) closeYourBirds();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('open') && !document.querySelector('.confirmation-dialog')) {
      closeYourBirds();
    }
  });
  for (const radio of panel.querySelectorAll('input[name="your-birds-filter"]')) {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      filter = radio.value;
      render();
    });
  }
  document.getElementById('your-birds-search').addEventListener('input', (e) => {
    query = e.target.value.trim().toLowerCase();
    render();
  });
  document.getElementById('your-birds-grid').addEventListener('click', async (e) => {
    const card = e.target.closest('[data-species-code]');
    if (!card) return;
    const code = card.dataset.speciesCode;
    const bird = findBird(code);
    if (e.target.closest('.bird-card-heart')) {
      e.stopPropagation();
      const favorite = await toggleFavorite(bird);
      favorites = await getFavorites();
      // Keep the heart under the bird's name in step when it's this bird
      const pageHeart = document.getElementById('favorite-button');
      if (pageHeart && document.getElementById('bird-name')?.dataset.speciesCode === code) {
        pageHeart.setAttribute('aria-pressed', String(favorite));
      }
      trackFeature(favorite ? 'favorite_add' : 'favorite_remove');
      render();
    } else if (e.target.closest('.bird-card-show') && bird?.imageUrl) {
      trackFeature('your_birds_show_again');
      showAgain(bird);
    }
  });
  document.getElementById('your-birds-clear').addEventListener('click', async () => {
    const favoritesView = filter === 'favorites';
    const confirmed = await showConfirmationDialog(favoritesView
      ? { title: 'favoritesClearTitle', subtitle: 'favoritesClearText', confirmText: 'yourBirdsClearConfirm', cancelText: 'cancel', danger: true }
      : { title: 'yourBirdsClearTitle', subtitle: 'yourBirdsClearText', confirmText: 'yourBirdsClearConfirm', cancelText: 'cancel', danger: true });
    if (!confirmed) return;
    if (favoritesView) {
      await clearFavorites();
      favorites = [];
      document.getElementById('favorite-button')?.setAttribute('aria-pressed', 'false');
      trackFeature('favorites_cleared');
    } else {
      await clearSeenBirds();
      seen = [];
      trackFeature('your_birds_cleared');
    }
    render();
  });
  document.getElementById('your-birds-quiz').addEventListener('click', () => {
    const birds = visibleBirds().filter(bird => bird.imageUrl);
    if (birds.length < QUIZ_MIN_BIRDS || !startQuizOn) return;
    trackFeature(filter === 'favorites' ? 'quiz_on_favorites' : 'quiz_on_seen_birds');
    closeYourBirds();
    startQuizOn(birds);
  });
}

/** The birds the list shows now: the filter, then the search. */
function visibleBirds() {
  const source = filter === 'favorites' ? favorites : seen.map(entry => entry.bird);
  return source.filter(matches);
}

function findBird(code) {
  return seen.find(entry => entry.bird.speciesCode === code)?.bird
    || favorites.find(bird => bird.speciesCode === code);
}

function matches(bird) {
  if (!query) return true;
  // Searching mustn't reveal the bird being guessed either
  const nameButton = document.getElementById('bird-name');
  if (nameButton?.classList.contains('guess-hidden') && nameButton.dataset.speciesCode === bird.speciesCode) return false;
  return [localizedName(bird), bird.name, bird.primaryComName, bird.scientificName]
    .filter(Boolean)
    .some(name => name.toLowerCase().includes(query));
}

function render() {
  const favoriteCodes = new Set(favorites.map(bird => bird.speciesCode));
  const lastSeen = new Map(seen.map(entry => [entry.bird.speciesCode, entry.lastSeen]));
  const nameButton = document.getElementById('bird-name');
  const showingNow = nameButton?.dataset.speciesCode;
  // Guess the Bird: don't give away the name of the bird still being guessed
  const guessing = nameButton?.classList.contains('guess-hidden');

  document.getElementById('your-birds-count').textContent = String(seen.length);
  document.getElementById('your-birds-count-all').textContent = String(seen.length);
  document.getElementById('your-birds-count-favorites').textContent = String(favorites.length);
  for (const radio of panel.querySelectorAll('input[name="your-birds-filter"]')) {
    radio.checked = radio.value === filter;
  }
  const birds = visibleBirds();
  const listLength = filter === 'favorites' ? favorites.length : seen.length;
  panel.querySelector('.your-birds-footer').hidden = listLength === 0;
  panel.querySelector('.your-birds-clear-label').textContent = filter === 'favorites'
    ? msg('favoritesClear', undefined, 'Clear favorites')
    : msg('yourBirdsClear', undefined, 'Clear seen birds');
  const quiz = document.getElementById('your-birds-quiz');
  quiz.hidden = !startQuizOn;
  quiz.disabled = birds.filter(bird => bird.imageUrl).length < QUIZ_MIN_BIRDS;
  quiz.title = quiz.disabled ? msg('yourBirdsQuizNeedsMore', [String(QUIZ_MIN_BIRDS)], `Needs at least ${QUIZ_MIN_BIRDS} birds`) : '';

  const grid = document.getElementById('your-birds-grid');
  setHtml(grid, birds.map(bird => {
    const hidden = guessing && bird.speciesCode === showingNow;
    const name = hidden ? msg('quickGuessPrompt', undefined, 'Who’s this bird?') : localizedName(bird);
    const favorite = favoriteCodes.has(bird.speciesCode);
    const when = bird.speciesCode === showingNow
      ? msg('yourBirdsShowingNow', undefined, 'Showing now')
      : lastSeen.has(bird.speciesCode) ? getRelativeTimeString(lastSeen.get(bird.speciesCode)) : '';
    return html`
      <div class="bird-card${bird.speciesCode === showingNow ? ' showing-now' : ''}" data-species-code="${bird.speciesCode}">
        <button type="button" class="bird-card-show" ${bird.imageUrl ? '' : 'disabled'}
          title="${msg('yourBirdsShowAgainHint', undefined, 'Show this bird again')}"
          aria-label="${msg('yourBirdsShowAgain', [name], `Show ${name} again`)}">
          ${bird.imageUrl
            ? html`<img src="${bird.imageUrl}" alt="" class="bird-card-image" loading="lazy">`
            : html`<span class="bird-card-image placeholder"></span>`}
          <span class="bird-card-name">${name}</span>
          <span class="bird-card-meta">${when}</span>
        </button>
        <button type="button" class="bird-card-heart" aria-pressed="${String(favorite)}"
          aria-label="${favorite
            ? msg('favoriteRemoveNamed', [name], `Remove ${name} from favorites`)
            : msg('favoriteAddNamed', [name], `Add ${name} to favorites`)}">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="${HEART_PATH}"/></svg>
        </button>
      </div>`;
  }));

  const empty = document.getElementById('your-birds-empty');
  empty.hidden = birds.length > 0;
  if (birds.length === 0) {
    const [title, text] = query
      ? [msg('yourBirdsNoMatch', [query], `No birds match “${query}”`), '']
      : filter === 'favorites'
        ? [msg('emptyFavoritesTitle', undefined, 'No favorites yet'), msg('emptyFavoritesSubtitle', undefined, 'Tap the heart under a bird’s name, or on any bird here.')]
        : [msg('yourBirdsEmptyTitle', undefined, 'No birds yet'), msg('yourBirdsEmptyText', undefined, 'Every bird you see on a new tab is kept here.')];
    empty.querySelector('.your-birds-empty-title').textContent = title;
    empty.querySelector('.your-birds-empty-text').textContent = text;
  }
}

/**
 * Show a bird from the list on this tab: reload with it as the pending bird (as
 * History did), and bring the panel back afterwards as it was (filter, search,
 * scroll), so only the bird behind it changes.
 */
function showAgain(bird) {
  try {
    sessionStorage.setItem(REOPEN_KEY, JSON.stringify({
      filter,
      query: document.getElementById('your-birds-search').value,
      scrollTop: panel.querySelector('.settings-body').scrollTop,
    }));
    // Keep the page hidden through the reload until the panel is back (styles.css)
    document.documentElement.classList.add('reopen-your-birds');
  } catch {
    // No sessionStorage: the panel just doesn't come back
  }
  chrome.storage.local.set({ pendingBirdInfo: bird }, () => window.location.reload());
}

/** Whether this page load should bring Your Birds back (set before showAgain's reload). */
export function hasPendingReopen() {
  try {
    return sessionStorage.getItem(REOPEN_KEY) !== null;
  } catch {
    return false;
  }
}

/** Bring Your Birds back after showAgain's reload, without its slide-in. */
export async function reopenYourBirdsIfPending(options = {}) {
  let state = null;
  try {
    state = JSON.parse(sessionStorage.getItem(REOPEN_KEY) || 'null');
    sessionStorage.removeItem(REOPEN_KEY);
  } catch {
    state = null;
  }
  if (state) {
    await openYourBirds(state.filter, { ...options, query: state.query, scrollTop: state.scrollTop, instant: true });
  }
  document.documentElement.classList.remove('reopen-your-birds');
}

/**
 * Open the panel.
 * @param {'all'|'favorites'} [show]
 * @param {Object} [options]
 * @param {Function} [options.onQuiz] - starts a quiz on a list of birds ("Quiz me on these")
 * @param {string} [options.query] - search text to restore
 * @param {number} [options.scrollTop] - list scroll position to restore
 * @param {boolean} [options.instant] - open without the slide-in
 */
export async function openYourBirds(show = 'all', { onQuiz, query: restoreQuery = '', scrollTop = 0, instant = false } = {}) {
  if (onQuiz) startQuizOn = onQuiz;
  if (!panel) createPanel();
  filter = show === 'favorites' ? 'favorites' : 'all';
  query = restoreQuery.trim().toLowerCase();
  document.getElementById('your-birds-search').value = restoreQuery;
  try {
    [seen, favorites] = await Promise.all([getSeenBirds(), getFavorites()]);
  } catch (error) {
    log(`Your Birds failed to load: ${error.message}`);
  }
  render();
  panel.classList.toggle('instant', instant);
  panel.classList.add('open');
  panel.querySelector('.settings-body').scrollTop = scrollTop;
  document.body.style.overflow = 'hidden';
  document.getElementById('close-your-birds').focus({ preventScroll: true });
  if (instant) requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.remove('instant')));
}

export function closeYourBirds() {
  panel?.classList.remove('open');
  document.body.style.overflow = '';
}
