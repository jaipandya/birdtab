import { captureException } from './sentry.js';
import { warn, log } from './logger.js';
import { createOptionsMenu } from './optionsMenu.js';
import { getOptionsTriggerSvg } from './optionsTrigger.js';

/**
 * Top Sites module for displaying most visited websites
 * Only works when user has granted topSites permission
 */

class TopSites {
  constructor() {
    this.container = null;
    this.isInitialized = false;
    this.updateTimeout = null;
    this.optionsMenu = null;
    this.hideTopSites = false;
  }

  /**
   * Initialize the top sites functionality
   */
  async initialize() {
    if (this.isInitialized) return;

    // Create the container element
    this.createContainer();

    // Check settings immediately to show container if enabled
    const settings = await this.getSettings();
    if (settings.quickAccessEnabled) {
      // Show container immediately if enabled, then load content
      this.show();
      // Load content in background
      this.updateVisibility();
    } else {
      // Hide if disabled
      this.hide();
    }

    // Listen for storage changes
    this.setupStorageListener();

    this.isInitialized = true;
  }

  /**
   * Create the top sites container element
   */
  createContainer() {
    // Check if container already exists
    const existingContainer = document.getElementById('top-sites-container');
    if (existingContainer) {
      existingContainer.remove();
    }

    // Create the container
    this.container = document.createElement('div');
    this.container.id = 'top-sites-container';
    this.container.className = 'top-sites-container hidden';
    this.container.innerHTML = `
      <div class="top-sites-grid" role="grid" aria-label="${chrome.i18n.getMessage('mostVisitedSitesAriaLabel')}">
        <!-- Top sites will be populated here -->
      </div>
    `;

    // Insert after search container and wrap both in a quick-access wrapper
    const searchContainer = document.getElementById('search-container');
    if (searchContainer) {
      // Check if wrapper already exists
      let quickAccessWrapper = document.getElementById('quick-access-wrapper');
      if (!quickAccessWrapper) {
        // Create the wrapper and wrap search container
        quickAccessWrapper = document.createElement('div');
        quickAccessWrapper.id = 'quick-access-wrapper';
        quickAccessWrapper.className = 'quick-access-wrapper';
        
        // Add clock container to the wrapper
        // Clock is positioned above search box for simpler logic
        // The quick-access-options-trigger is positioned relative to the search-and-sites area
        quickAccessWrapper.innerHTML = `
          <div id="clock-container" class="clock-container hidden">
            <div class="clock-wrapper">
              <div id="clock-time" class="clock-time"></div>
              <button id="clock-options-trigger" class="clock-options-trigger" aria-label="${chrome.i18n.getMessage('clockOptionsAriaLabel') || 'Clock options'}">
                ${getOptionsTriggerSvg()}
              </button>
            </div>
          </div>
          <div class="search-and-sites">
            <button id="quick-access-options-trigger" class="quick-access-options-trigger" aria-label="${chrome.i18n.getMessage('quickAccessOptionsAriaLabel') || 'Quick access options'}">
              ${getOptionsTriggerSvg()}
            </button>
          </div>
        `;
        
        // Insert wrapper before search container
        searchContainer.parentNode.insertBefore(quickAccessWrapper, searchContainer);
        
        // Move search container into the search-and-sites area (before the options trigger)
        const searchAndSites = quickAccessWrapper.querySelector('.search-and-sites');
        searchAndSites.insertBefore(searchContainer, searchAndSites.firstChild);
      }
      
      // Add top sites container to the search-and-sites area (after search, before options trigger)
      const searchAndSites = quickAccessWrapper.querySelector('.search-and-sites');
      const optionsTrigger = searchAndSites.querySelector('.quick-access-options-trigger');
      searchAndSites.insertBefore(this.container, optionsTrigger);
    } else {
      // Fallback: insert before content container
      const contentContainer = document.getElementById('content-container');
      if (contentContainer) {
        contentContainer.insertAdjacentElement('beforebegin', this.container);
      } else {
        // Last resort: append to body
        document.body.appendChild(this.container);
      }
    }
  }

  /**
   * Check permissions and settings, then update visibility
   * Debounced to prevent duplicate updates
   */
  async updateVisibility() {
    // Clear any pending updates to prevent duplicates
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }

    // Debounce the update to prevent rapid consecutive calls
    this.updateTimeout = setTimeout(async () => {
      try {
        // Check if user has enabled quick access features in settings
        const settings = await this.getSettings();
        const isEnabled = settings.quickAccessEnabled || false;

        if (!isEnabled) {
          this.hide();
          return;
        }

        // Check if we have the required permission
        let hasPermission = false;
        try {
          hasPermission = await chrome.permissions.contains({
            permissions: ['topSites']
          });
        } catch (error) {
          warn('Error checking topSites permission:', error);
          hasPermission = false;
        }

        if (!hasPermission) {
          // Hide if permission not granted
          this.hide();
          return;
        }

        // All good - show top sites
        await this.loadAndDisplay();

      } catch (error) {
        captureException(error, {
          tags: { operation: 'updateVisibility', component: 'TopSites' }
        });
        this.hide();
      }
    }, 100); // 100ms debounce
  }

  /**
   * Load top sites from Chrome API and display them
   */
  async loadAndDisplay() {
    try {
      const settings = await this.getSettings();
      this.hideTopSites = settings.hideTopSites || false;
      
      // If hide top sites is enabled, hide everything (both top sites and custom shortcuts)
      if (this.hideTopSites) {
        this.hide();
        // Still initialize the options menu so users can toggle the setting back
        this.initOptionsMenu();
        return;
      }
      
      const sites = [];

      // Get custom shortcuts if quick access is enabled
      if (settings.quickAccessEnabled) {
        const customShortcuts = await this.getCustomShortcuts();
        sites.push(...customShortcuts);
      }

      // Get top sites from Chrome API
      let topSites = [];
      try {
        topSites = await chrome.topSites.get();
      } catch (error) {
        warn('Could not get top sites from Chrome API:', error);
        // Continue with just custom shortcuts if available
      }

      if (topSites && topSites.length > 0) {
        // Add top sites, avoiding duplicates
        const existingUrls = new Set(sites.map(site => site.url));
        const uniqueTopSites = topSites.filter(site => !existingUrls.has(site.url));
        sites.push(...uniqueTopSites);
      }

      // Show if we have sites OR if quick access is enabled (for add shortcut button)
      if (sites.length > 0 || settings.quickAccessEnabled) {
        await this.renderTopSites(sites); // Pass all sites, renderTopSites will handle the limit
        this.show();
        this.initOptionsMenu();
      } else {
        this.hide();
      }
    } catch (error) {
      captureException(error, {
        tags: { operation: 'loadAndDisplay', component: 'TopSites' }
      });
      this.hide();
    }
  }

  /**
   * Render placeholder when productivity features are disabled
   */
  async renderPlaceholder() {
    const grid = this.container.querySelector('.top-sites-grid');
    if (!grid) return;

    // Simply hide the container instead of showing a placeholder
    this.hide();
  }

  /**
   * Render the top sites in the grid
   */
  async renderTopSites(sites) {
    if (!this.container) return;

    const settings = await this.getSettings();
    const quickAccessEnabled = settings.quickAccessEnabled;

    // Clear existing grid content
    const grid = this.container.querySelector('.top-sites-grid');
    if (grid) {
      grid.innerHTML = '';
    }

    // Determine optimal layout for desktop 2x5 grid (10 total items)
    // Mobile will adapt with responsive CSS to show fewer items per row
    const maxTotalItems = 10;
    let maxSites;

    if (quickAccessEnabled) {
      // Reserve 1 slot for the add button: 9 sites + 1 add button = 10 total
      maxSites = maxTotalItems - 1;
    } else {
      // No add button needed: 10 sites total
      maxSites = maxTotalItems;
    }

    const displaySites = sites.slice(0, maxSites);

    // Create site elements concurrently
    const siteElements = await Promise.all(displaySites.map(site => this.createSiteElement(site)));

    // Append all elements
    siteElements.forEach(element => grid.appendChild(element));

    // Add "Add Shortcut" button if quick access is enabled
    if (quickAccessEnabled) {
      const addButton = this.createAddShortcutButton();
      grid.appendChild(addButton);
    }
  }

  /**
   * Create a single site element
   */
  async createSiteElement(site) {
    const siteDiv = document.createElement('div');
    siteDiv.className = 'top-site';
    siteDiv.title = site.title;
    siteDiv.setAttribute('role', 'gridcell');

    const link = document.createElement('a');
    link.href = site.url;
    link.className = 'top-site-link';
    link.setAttribute('aria-label', `${chrome.i18n.getMessage('visitSiteAriaLabel')} ${site.title || this.getDomainFromUrl(site.url)}`);

    // Add right-click context menu for custom shortcuts
    if (site.isCustom) {
      siteDiv.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showContextMenu(e, site);
      });
    }

    // Create favicon element
    const favicon = document.createElement('div');
    favicon.className = 'top-site-favicon';

    // Try to get favicon using Chrome's official favicon API (if permission granted) or fallback
    const faviconUrl = await this.getFaviconUrl(site.url);
    if (faviconUrl) {
      const img = document.createElement('img');
      img.src = faviconUrl;
      img.alt = '';
      img.onerror = () => {
        // Fallback to default icon if favicon fails to load
        favicon.innerHTML = this.getDefaultIcon();
        favicon.classList.add('has-fallback-icon');
      };
      favicon.appendChild(img);
    } else {
      favicon.innerHTML = this.getDefaultIcon();
      favicon.classList.add('has-fallback-icon');
    }

    // Create title element
    const title = document.createElement('div');
    title.className = 'top-site-title';
    title.textContent = this.truncateTitle(site.title || this.getDomainFromUrl(site.url));

    // Add custom shortcut indicator
    if (site.isCustom) {
      siteDiv.classList.add('custom-shortcut');

      // Add remove button (Chrome-style) - only for custom shortcuts
      const removeButton = document.createElement('div');
      removeButton.className = 'remove-shortcut';
      removeButton.innerHTML = '×';
      removeButton.title = chrome.i18n.getMessage('removeShortcutTooltip');

      removeButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.removeCustomShortcut(site.url);
      });

      siteDiv.appendChild(removeButton);
    }

    link.appendChild(favicon);
    link.appendChild(title);
    siteDiv.appendChild(link);

    return siteDiv;
  }

  /**
   * Get favicon URL for a given site URL using Chrome's official favicon API if permission is granted
   */
  async getFaviconUrl(url) {
    try {
      // Check if we have favicon permission
      const hasFaviconPermission = await chrome.permissions.contains({
        permissions: ['favicon']
      });

      if (hasFaviconPermission) {
        // Use Chrome's official favicon API for better reliability
        const faviconUrl = new URL(chrome.runtime.getURL("/_favicon/"));
        faviconUrl.searchParams.set("pageUrl", url);
        faviconUrl.searchParams.set("size", "32");
        return faviconUrl.toString();
      } else {
        // Fallback to basic favicon URL if permission not granted
        const domain = new URL(url).origin;
        return `${domain}/favicon.ico`;
      }
    } catch (error) {
      captureException(error, {
        tags: { operation: 'getFaviconUrl', component: 'TopSites' },
        extra: { url }
      });
      return null;
    }
  }

  /**
   * Get default icon SVG for sites without favicons
   */
  getDefaultIcon() {
    return `
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
  }

  /**
   * Extract domain from URL for fallback titles
   */
  getDomainFromUrl(url) {
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch (error) {
      return chrome.i18n.getMessage('websiteFallback');
    }
  }

  /**
   * Truncate long titles
   */
  truncateTitle(title, maxLength = 12) {
    if (title.length <= maxLength) return title;
    return title.substring(0, maxLength) + '...';
  }

  /**
   * Show the top sites container
   */
  show() {
    if (this.container) {
      this.container.classList.remove('hidden');
      // Add class to body for video play/pause button positioning
      document.body.classList.add('quick-access-has-top-sites');
    }
  }

  /**
   * Hide the top sites container
   */
  hide() {
    if (this.container) {
      this.container.classList.add('hidden');
      // Remove class from body - video play/pause can be centered
      document.body.classList.remove('quick-access-has-top-sites');
    }
  }

  /**
   * Get settings from Chrome storage
   */
  getSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get([
          'quickAccessEnabled',
          'hideTopSites'
        ], (result) => {
          if (chrome.runtime.lastError) {
            captureException(new Error(chrome.runtime.lastError.message), {
              tags: { operation: 'getSettings', component: 'TopSites' }
            });
            resolve({}); // Return empty object on error
          } else {
            resolve(result);
          }
        });
      } catch (error) {
        captureException(error, {
          tags: { operation: 'getSettings', component: 'TopSites' }
        });
        resolve({}); // Return empty object on error
      }
    });
  }

  /**
   * Get custom shortcuts from storage
   */
  async getCustomShortcuts() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(['customShortcuts'], (result) => {
          if (chrome.runtime.lastError) {
            captureException(new Error(chrome.runtime.lastError.message), {
              tags: { operation: 'getCustomShortcuts', component: 'TopSites' }
            });
            resolve([]);
          } else {
            const shortcuts = result.customShortcuts || [];
            // Map the stored format to the expected format
            resolve(shortcuts.map(shortcut => ({
              url: shortcut.url,
              title: shortcut.name, // Map 'name' to 'title'
              isCustom: true
            })));
          }
        });
      } catch (error) {
        captureException(error, {
          tags: { operation: 'getCustomShortcuts', component: 'TopSites' }
        });
        resolve([]);
      }
    });
  }

  /**
   * Save custom shortcuts to storage
   */
  async saveCustomShortcuts(shortcuts) {
    return new Promise((resolve, reject) => {
      try {
        // Map back to storage format
        const storageFormat = shortcuts.map(shortcut => ({
          name: shortcut.title || shortcut.name,
          url: shortcut.url
        }));

        chrome.storage.sync.set({ customShortcuts: storageFormat }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Add a new custom shortcut
   */
  async addCustomShortcut(name, url) {
    const shortcuts = await this.getCustomShortcuts();
    shortcuts.push({ url, title: name, isCustom: true });
    await this.saveCustomShortcuts(shortcuts);
    await this.updateVisibility();
  }

  /**
   * Remove a custom shortcut
   */
  async removeCustomShortcut(url) {
    const shortcuts = await this.getCustomShortcuts();
    const filtered = shortcuts.filter(shortcut => shortcut.url !== url);
    await this.saveCustomShortcuts(filtered);
    await this.updateVisibility();
  }

  /**
   * Setup listener for storage changes
   */
  setupStorageListener() {
    // Listen for storage changes and update accordingly
    const handleStorageChange = (changes, namespace) => {
      if (namespace === 'sync') {
        const relevantChanges = [
          'quickAccessEnabled',
          'customShortcuts',
          'hideTopSites'
        ];

        const hasRelevantChanges = relevantChanges.some(key => changes.hasOwnProperty(key));

        if (hasRelevantChanges) {
          // Update local state for hideTopSites
          if (changes.hideTopSites !== undefined) {
            this.hideTopSites = changes.hideTopSites.newValue || false;
          }
          // Debounce multiple rapid changes
          this.updateVisibility();
        }
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);

    // Store reference for cleanup
    this.storageChangeListener = handleStorageChange;
  }

  /**
   * Initialize the options menu for top sites settings
   */
  initOptionsMenu() {
    const quickAccessWrapper = document.getElementById('quick-access-wrapper');
    const trigger = quickAccessWrapper?.querySelector('#quick-access-options-trigger');
    const searchContainer = document.getElementById('search-container');
    
    if (!trigger || !quickAccessWrapper || !searchContainer) return;
    
    // Destroy existing menu if any
    if (this.optionsMenu) {
      this.optionsMenu.destroy();
    }
    
    // Create options that read current state when menu is opened
    const getOptions = () => [
      {
        type: 'toggle',
        label: chrome.i18n.getMessage('hideTopSites') || 'Hide top sites',
        checked: this.hideTopSites,
        onChange: async (checked) => {
          this.hideTopSites = checked;
          // Save to storage
          await chrome.storage.sync.set({ hideTopSites: checked });
          log(`Hide top sites toggled: ${checked}`);
        }
      }
    ];
    
    this.optionsMenu = createOptionsMenu({
      triggerElement: trigger,
      anchorElement: searchContainer, // Anchor to search container for consistent positioning like clock
      menuId: 'quick-access-options-menu',
      position: 'right',
      getOptions // Pass factory function instead of static options
    });
  }

  /**
   * Create "Add Shortcut" button
   */
  createAddShortcutButton() {
    const addButton = document.createElement('div');
    addButton.className = 'top-site';
    addButton.setAttribute('role', 'gridcell');

    const buttonElement = document.createElement('button');
    buttonElement.className = 'add-shortcut-btn';
    buttonElement.setAttribute('aria-label', chrome.i18n.getMessage('addNewShortcutAriaLabel'));
    buttonElement.innerHTML = `
      <div class="plus-icon">+</div>
      <div class="add-text">${chrome.i18n.getMessage('addShortcutButtonText')}</div>
    `;

    buttonElement.addEventListener('click', () => {
      this.showAddShortcutDialog();
    });

    addButton.appendChild(buttonElement);
    return addButton;
  }

  /**
   * Show context menu for custom shortcuts
   */
  showContextMenu(event, site) {
    // Remove existing context menu if any
    const existingMenu = document.querySelector('.top-site-context-menu');
    if (existingMenu) {
      existingMenu.remove();
    }

    const contextMenu = document.createElement('div');
    contextMenu.className = 'top-site-context-menu';
    contextMenu.innerHTML = `
      <div class="context-menu-item" data-action="edit">${chrome.i18n.getMessage('editShortcutContextMenu')}</div>
      <div class="context-menu-item" data-action="remove">${chrome.i18n.getMessage('removeShortcutContextMenu')}</div>
    `;

    // Position the menu
    contextMenu.style.left = event.pageX + 'px';
    contextMenu.style.top = event.pageY + 'px';

    // Add event listeners
    contextMenu.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      if (action === 'edit') {
        this.editShortcut(site);
      } else if (action === 'remove') {
        this.removeCustomShortcut(site.url);
      }
      contextMenu.remove();
    });

    // Close menu when clicking elsewhere
    const closeMenu = (e) => {
      if (!contextMenu.contains(e.target)) {
        contextMenu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 10);

    document.body.appendChild(contextMenu);
  }

  /**
   * Show add shortcut dialog
   */
  showAddShortcutDialog() {
    this.createShortcutModal(chrome.i18n.getMessage('addShortcutModalTitle'), '', '', (name, url) => {
      // Ensure URL has protocol
      const finalUrl = url.startsWith('http') ? url : `https://${url}`;
      this.addCustomShortcut(name, finalUrl);
    });
  }

  /**
   * Edit a custom shortcut
   */
  editShortcut(site) {
    this.createShortcutModal(chrome.i18n.getMessage('editShortcutModalTitle'), site.title, site.url, (name, url) => {
      // Remove old shortcut and add new one
      this.removeCustomShortcut(site.url).then(() => {
        const finalUrl = url.startsWith('http') ? url : `https://${url}`;
        this.addCustomShortcut(name, finalUrl);
      });
    });
  }

  /**
   * Create a proper modal dialog for shortcut input
   */
  createShortcutModal(title, initialName = '', initialUrl = '', onConfirm) {
    // Remove any existing modal
    const existingModal = document.querySelector('.shortcut-modal');
    if (existingModal) {
      existingModal.remove();
    }

    const modal = document.createElement('div');
    modal.className = 'shortcut-modal';
    modal.innerHTML = `
      <div class="shortcut-modal-content">
        <div class="shortcut-modal-header">
          <h3>${title}</h3>
          <button class="shortcut-modal-close">&times;</button>
        </div>
        <div class="shortcut-modal-body">
          <div class="input-group">
            <label for="shortcut-name">${chrome.i18n.getMessage('shortcutNameLabel')}</label>
            <input type="text" id="shortcut-name" value="${initialName}" placeholder="${chrome.i18n.getMessage('shortcutNamePlaceholder')}" maxlength="20">
            <div class="error-message" id="name-error"></div>
          </div>
          <div class="input-group">
            <label for="shortcut-url">${chrome.i18n.getMessage('shortcutUrlLabel')}</label>
            <input type="text" id="shortcut-url" value="${initialUrl}" placeholder="${chrome.i18n.getMessage('shortcutUrlPlaceholder')}">
            <div class="error-message" id="url-error"></div>
          </div>
        </div>
        <div class="shortcut-modal-footer">
          <button class="shortcut-btn secondary" id="shortcut-cancel">${chrome.i18n.getMessage('shortcutCancelButton')}</button>
          <button class="shortcut-btn primary" id="shortcut-ok">${chrome.i18n.getMessage('shortcutOkButton')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Focus on first input
    const nameInput = modal.querySelector('#shortcut-name');
    const urlInput = modal.querySelector('#shortcut-url');
    nameInput.focus();

    // Handle form validation
    const validateForm = () => {
      const name = nameInput.value.trim();
      const url = urlInput.value.trim();
      let isValid = true;

      // Clear previous errors
      modal.querySelector('#name-error').textContent = '';
      modal.querySelector('#url-error').textContent = '';

      if (!name) {
        modal.querySelector('#name-error').textContent = chrome.i18n.getMessage('shortcutNameRequired');
        isValid = false;
      }

      if (!url) {
        modal.querySelector('#url-error').textContent = chrome.i18n.getMessage('shortcutUrlRequired');
        isValid = false;
      } else if (!this.isValidUrl(url)) {
        modal.querySelector('#url-error').textContent = chrome.i18n.getMessage('shortcutUrlInvalid');
        isValid = false;
      }

      return isValid;
    };

    // Handle OK button
    const okButton = modal.querySelector('#shortcut-ok');
    okButton.addEventListener('click', () => {
      if (validateForm()) {
        const name = nameInput.value.trim();
        const url = urlInput.value.trim();
        onConfirm(name, url);
        modal.remove();
      }
    });

    // Handle Cancel button
    const cancelButton = modal.querySelector('#shortcut-cancel');
    cancelButton.addEventListener('click', () => {
      modal.remove();
    });

    // Handle close button
    const closeButton = modal.querySelector('.shortcut-modal-close');
    closeButton.addEventListener('click', () => {
      modal.remove();
    });

    // Handle Enter key
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (validateForm()) {
          const name = nameInput.value.trim();
          const url = urlInput.value.trim();
          onConfirm(name, url);
          modal.remove();
        }
      } else if (e.key === 'Escape') {
        modal.remove();
      }
    });

    // Close modal when clicking outside
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  }

  /**
   * Validate URL format
   */
  isValidUrl(string) {
    try {
      // Add protocol if missing for validation
      const url = string.startsWith('http') ? string : `https://${string}`;
      new URL(url);
      return true;
    } catch (_) {
      // Also accept domain-only format
      const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.[a-zA-Z]{2,}([\/\w\.-]*)*\/?$/;
      return domainRegex.test(string) || string.includes('.') || string === 'localhost';
    }
  }

  /**
   * Cleanup method
   */
  destroy() {
    // Clear timeouts
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
      this.updateTimeout = null;
    }

    // Remove storage listener
    if (this.storageChangeListener) {
      chrome.storage.onChanged.removeListener(this.storageChangeListener);
      this.storageChangeListener = null;
    }

    // Destroy options menu
    if (this.optionsMenu) {
      this.optionsMenu.destroy();
      this.optionsMenu = null;
    }

    // Remove container from DOM
    if (this.container && this.container.parentNode) {
      this.container.remove();
    }

    // Clear state
    this.container = null;
    this.isInitialized = false;
  }
}

// Export the class
export default TopSites; 