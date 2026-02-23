/**
 * Search functionality module
 * Handles search box initialization, search engine selection, and search submission
 */

import { log } from './logger.js';
import { captureException } from './sentry.js';
import { IS_EDGE } from './browserInfo.js';

// Search engine configurations with official SVG icons from Simple Icons
const DEFAULT_SEARCH_ICON = IS_EDGE
  ? `<img src="${chrome.runtime.getURL('images/edge/microsoft-edge.svg')}" width="24" height="24" alt="${chrome.i18n.getMessage('microsoftEdgeAlt') || 'Microsoft Edge'}">`
  : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><defs><linearGradient id="cr-a" x1="3.2173" y1="15" x2="44.7812" y2="15" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#d93025"/><stop offset="1" stop-color="#ea4335"/></linearGradient><linearGradient id="cr-b" x1="20.7219" y1="47.6791" x2="41.5039" y2="11.6837" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fcc934"/><stop offset="1" stop-color="#fbbc04"/></linearGradient><linearGradient id="cr-c" x1="26.5981" y1="46.5015" x2="5.8161" y2="10.506" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1e8e3e"/><stop offset="1" stop-color="#34a853"/></linearGradient></defs><circle cx="24" cy="23.9947" r="12" fill="#fff"/><path d="M24,12H44.7812a23.9939,23.9939,0,0,0-41.5639.0029L13.6079,30l.0093-.0024A11.9852,11.9852,0,0,1,24,12Z" fill="url(#cr-a)"/><circle cx="24" cy="24" r="9.5" fill="#1a73e8"/><path d="M34.3913,30.0029,24.0007,48A23.994,23.994,0,0,0,44.78,12.0031H23.9989l-.0025.0093A11.985,11.985,0,0,1,34.3913,30.0029Z" fill="url(#cr-b)"/><path d="M13.6086,30.0031,3.218,12.006A23.994,23.994,0,0,0,24.0025,48L34.3931,30.0029l-.0067-.0068a11.9852,11.9852,0,0,1-20.7778.007Z" fill="url(#cr-c)"/></svg>`;

export const SEARCH_ENGINES = {
  default: {
    id: 'default',
    name: 'searchEngineBrowserDefault',
    // Uses Chrome's native search API
    useNativeSearch: true,
    icon: DEFAULT_SEARCH_ICON
  },
  google: {
    id: 'google',
    name: 'searchEngineGoogle',
    url: 'https://www.google.com/search?q=',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>`
  },
  duckduckgo: {
    id: 'duckduckgo',
    name: 'searchEngineDuckDuckGo',
    url: 'https://duckduckgo.com/?q=',
    icon: `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#DE5833" d="M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zm0 .984C18.083.984 23.016 5.916 23.016 12S18.084 23.016 12 23.016.984 18.084.984 12C.984 5.917 5.916.984 12 .984zm0 .938C6.434 1.922 1.922 6.434 1.922 12c0 4.437 2.867 8.205 6.85 9.55-.237-.82-.776-2.753-1.6-6.052-1.184-4.741-2.064-8.606 2.379-9.813.047-.011.064-.064.03-.093-.514-.467-1.382-.548-2.233-.38a.06.06 0 0 1-.07-.058c0-.011 0-.023.011-.035.205-.286.572-.507.822-.64a1.843 1.843 0 0 0-.607-.335c-.059-.022-.059-.12-.006-.144.006-.006.012-.012.024-.012 1.749-.233 3.586.292 4.49 1.448.011.011.023.017.035.023 2.968.635 3.509 4.837 3.328 5.998a9.607 9.607 0 0 0 2.346-.576c.746-.286 1.008-.222 1.101-.053.1.193-.018.513-.28.81-.496.567-1.393 1.01-2.974 1.137-.546.044-1.029.024-1.445.006-.789-.035-1.339-.059-1.633.39-.192.298-.041.998 1.487 1.22 1.09.157 2.078.047 2.798-.034.643-.07 1.073-.118 1.172.069.21.402-.996 1.207-3.066 1.224-.158 0-.315-.006-.467-.011-1.283-.065-2.227-.414-2.816-.735a.094.094 0 0 1-.035-.017c-.105-.059-.31.045-.188.267.07.134.444.478 1.004.776-.058.466.087 1.184.338 2l.088-.016c.041-.009.087-.019.134-.025.507-.082.775.012.926.175.717-.536 1.913-1.294 2.03-1.154.583.694.66 2.332.53 2.99-.004.012-.017.024-.04.035-.274.117-1.783-.296-1.783-.511-.059-1.075-.26-1.173-.493-1.225h-.156c.006.006.012.018.018.03l.052.12c.093.257.24 1.063.13 1.26-.112.199-.835.297-1.284.303-.443.006-.543-.158-.637-.408-.07-.204-.103-.675-.103-.95a.857.857 0 0 1 .012-.216c-.134.058-.333.193-.397.281-.017.262-.017.682.123 1.149.07.221-1.518 1.164-1.74.99-.227-.181-.634-1.952-.459-2.67-.187.017-.338.075-.42.191-.367.508.093 2.933.582 3.248.257.169 1.54-.553 2.176-1.095.105.145.305.158.553.158.326-.012.782-.06 1.103-.158.192.45.423.972.613 1.388 4.47-1.032 7.803-5.037 7.803-9.82 0-5.566-4.512-10.078-10.078-10.078zm1.791 5.646c-.42 0-.678.146-.795.332-.023.047.047.094.094.07.14-.075.357-.161.701-.156.328.006.516.09.67.159l.023.01c.041.017.088-.03.059-.065-.134-.18-.332-.35-.752-.35zm-5.078.198a1.24 1.24 0 0 0-.522.082c-.454.169-.67.526-.67.76 0 .051.112.057.141.011.081-.123.21-.31.617-.478.408-.17.73-.146.951-.094.047.012.083-.041.041-.07a.989.989 0 0 0-.558-.211zm5.434 1.423a.651.651 0 0 0-.655.647.652.652 0 0 0 1.307 0 .646.646 0 0 0-.652-.647zm.283.262h.008a.17.17 0 0 1 .17.17c0 .093-.077.17-.17.17a.17.17 0 0 1-.17-.17c0-.09.072-.165.162-.17zm-5.358.076a.752.752 0 0 0-.758.758c0 .42.338.758.758.758s.758-.337.758-.758a.756.756 0 0 0-.758-.758zm.328.303h.01c.112 0 .2.089.2.2 0 .11-.088.197-.2.197a.195.195 0 0 1-.197-.198c0-.107.082-.194.187-.199z"/></svg>`
  },
  chatgpt: {
    id: 'chatgpt',
    name: 'searchEngineChatGPT',
    url: 'https://chatgpt.com/?hints=search&q=',
    icon: `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#10A37F" d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/></svg>`
  },
  perplexity: {
    id: 'perplexity',
    name: 'searchEnginePerplexity',
    url: 'https://www.perplexity.ai/search?q=',
    icon: `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#1FB8CD" d="M22.3977 7.0896h-2.3106V.0676l-7.5094 6.3542V.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932-6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657-4.531v4.531h-5.355l5.355-4.531zm-13.2862.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h.0001v-2.6488l5.7763-5.7764v7.0111l-5.7764 5.2993zm12.7086.0248-5.7766-5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882-5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z"/></svg>`
  }
};

// Default search engine
const DEFAULT_SEARCH_ENGINE = 'default';

// Storage key for search engine preference
const STORAGE_KEY = 'searchEngine';

/**
 * Get the currently selected search engine
 * @returns {Promise<string>} The search engine ID
 */
export async function getSearchEngine() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        if (chrome.runtime.lastError) {
          captureException(new Error(chrome.runtime.lastError.message), {
            tags: { operation: 'getSearchEngine', component: 'Search' }
          });
          resolve(DEFAULT_SEARCH_ENGINE);
        } else {
          resolve(result[STORAGE_KEY] || DEFAULT_SEARCH_ENGINE);
        }
      });
    } catch (error) {
      captureException(error, {
        tags: { operation: 'getSearchEngine', component: 'Search' }
      });
      resolve(DEFAULT_SEARCH_ENGINE);
    }
  });
}

/**
 * Set the search engine preference
 * @param {string} engineId - The search engine ID
 * @returns {Promise<void>}
 */
export async function setSearchEngine(engineId) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: engineId }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          log(`Search engine set to: ${engineId}`);
          resolve();
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Perform a search with the given query using the selected search engine
 * @param {string} query - The search query
 */
export async function performSearch(query) {
  if (!query || !query.trim()) return;

  const trimmedQuery = query.trim();
  const engineId = await getSearchEngine();
  const engine = SEARCH_ENGINES[engineId] || SEARCH_ENGINES[DEFAULT_SEARCH_ENGINE];

  log(`Performing search with engine: ${engineId}, query: ${trimmedQuery}`);

  if (engine.useNativeSearch) {
    // Use Chrome's native search API (uses browser's default search engine)
    try {
      chrome.search.query({
        text: trimmedQuery,
        disposition: 'CURRENT_TAB'
      });
    } catch (error) {
      captureException(error, {
        tags: { operation: 'performSearch', component: 'Search' },
        extra: { engineId, query: trimmedQuery }
      });
      // Fallback to Google if native search fails
      window.location.href = `https://www.google.com/search?q=${encodeURIComponent(trimmedQuery)}`;
    }
  } else {
    // Use custom search engine URL
    // Replace %20 with + for proper query parameter encoding
    const encodedQuery = encodeURIComponent(trimmedQuery).replace(/%20/g, '+');
    window.location.href = `${engine.url}${encodedQuery}`;
  }
}

/**
 * Get localized search engine choices for the options menu
 * @param {string} currentValue - The currently selected search engine ID
 * @returns {Array} Array of choice objects with label and value
 */
export function getSearchEngineChoices(currentValue) {
  return Object.values(SEARCH_ENGINES).map(engine => ({
    label: chrome.i18n.getMessage(engine.name) || engine.id,
    value: engine.id
  }));
}

/**
 * Initialize the search functionality
 * Sets up the search container visibility and event listeners
 */
export function initializeSearch() {
  const searchContainer = document.getElementById('search-container');

  // Check settings synchronously first to show/hide immediately
  // Default quickAccessEnabled to true for fresh installs where storage isn't set yet
  chrome.storage.local.get(['quickAccessEnabled'], (result) => {
    const quickAccessEnabled = result.quickAccessEnabled !== undefined ? result.quickAccessEnabled : true;
    chrome.permissions.contains({
      permissions: ['search']
    }, (hasPermission) => {
      if (hasPermission && quickAccessEnabled) {
        searchContainer.style.display = 'block';
        document.body.classList.add('quick-access-enabled');
        setupSearchListeners();
      } else {
        searchContainer.style.display = 'none';
        document.body.classList.remove('quick-access-enabled');
      }
    });
  });
}

/**
 * Set up event listeners for the search form
 */
export function setupSearchListeners() {
  const searchForm = document.getElementById('search-form');
  const searchInput = document.getElementById('search-input');

  // Remove any existing listeners by cloning and replacing
  const newSearchForm = searchForm.cloneNode(true);
  searchForm.parentNode.replaceChild(newSearchForm, searchForm);

  // Get fresh reference after clone
  const freshSearchInput = newSearchForm.querySelector('#search-input');

  newSearchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = freshSearchInput.value.trim();
    if (query) {
      performSearch(query);
    }
  });

  // Clear search on Escape key
  freshSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      freshSearchInput.value = '';
      freshSearchInput.blur();
    }
  });
}

/**
 * Setup keyboard shortcut to focus search (Ctrl/Cmd + K)
 */
export function setupSearchKeyboardShortcut() {
  const searchInput = document.getElementById('search-input');
  if (!searchInput) return;

  document.addEventListener('keydown', (e) => {
    // Focus search (Ctrl/Cmd + K)
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      searchInput.focus();
    }
  });
}
