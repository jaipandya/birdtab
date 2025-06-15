/**
 * Top Sites module for displaying most visited websites
 * Only works when user has granted topSites permission
 */

class TopSites {
  constructor() {
    this.container = null;
    this.isInitialized = false;
    this.updateTimeout = null;
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
      <div class="top-sites-grid" role="grid" aria-label="Most visited sites and custom shortcuts">
        <!-- Top sites will be populated here -->
      </div>
    `;

    // Insert after search container
    const searchContainer = document.getElementById('search-container');
    if (searchContainer) {
      searchContainer.insertAdjacentElement('afterend', this.container);
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
          console.warn('Error checking topSites permission:', error);
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
        console.error('Error updating top sites visibility:', error);
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
      const sites = [];
      
      // Get custom shortcuts if quick access is enabled
      if (settings.quickAccessEnabled) {
        const customShortcuts = await this.getCustomShortcuts();
        sites.push(...customShortcuts);
      }
      
      // Get top sites from Chrome API with error handling
      let topSites = [];
      try {
        topSites = await chrome.topSites.get();
      } catch (error) {
        console.warn('Could not get top sites from Chrome API:', error);
        // Continue with just custom shortcuts if available
      }
      
      if (topSites && topSites.length > 0) {
        // Add top sites, avoiding duplicates
        const existingUrls = new Set(sites.map(site => site.url));
        const uniqueTopSites = topSites.filter(site => !existingUrls.has(site.url));
        sites.push(...uniqueTopSites);
      }
      
      if (sites.length > 0) {
        await this.renderTopSites(sites); // Pass all sites, renderTopSites will handle the limit
        this.show();
      } else {
        this.hide();
      }
    } catch (error) {
      console.error('Error loading top sites:', error);
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

    // Create site elements
    for (const site of displaySites) {
      const siteElement = await this.createSiteElement(site);
      grid.appendChild(siteElement);
    }

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
    link.setAttribute('aria-label', `Visit ${site.title || this.getDomainFromUrl(site.url)}`);

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
      };
      favicon.appendChild(img);
    } else {
      favicon.innerHTML = this.getDefaultIcon();
    }

    // Create title element
    const title = document.createElement('div');
    title.className = 'top-site-title';
    title.textContent = this.truncateTitle(site.title || this.getDomainFromUrl(site.url));

    // Add custom shortcut indicator
    if (site.isCustom) {
      siteDiv.classList.add('custom-shortcut');
      
      // Add remove button (Chrome-style)
      const removeButton = document.createElement('div');
      removeButton.className = 'remove-shortcut';
      removeButton.innerHTML = '×';
      removeButton.title = 'Remove shortcut';
      
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
      console.error('Error creating favicon URL:', error);
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
      return 'Website';
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
    }
  }

  /**
   * Hide the top sites container
   */
  hide() {
    if (this.container) {
      this.container.classList.add('hidden');
    }
  }

  /**
   * Get settings from Chrome storage
   */
  getSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get([
          'quickAccessEnabled'
        ], (result) => {
          if (chrome.runtime.lastError) {
            console.error('Error getting settings:', chrome.runtime.lastError);
            resolve({}); // Return empty object on error
          } else {
            resolve(result);
          }
        });
      } catch (error) {
        console.error('Error accessing storage:', error);
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
            console.error('Error getting custom shortcuts:', chrome.runtime.lastError);
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
        console.error('Error accessing custom shortcuts:', error);
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
           'customShortcuts'
         ];
         
         const hasRelevantChanges = relevantChanges.some(key => changes.hasOwnProperty(key));
         
         if (hasRelevantChanges) {
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
   * Create "Add Shortcut" button
   */
  createAddShortcutButton() {
    const addButton = document.createElement('div');
    addButton.className = 'top-site';
    addButton.setAttribute('role', 'gridcell');
    
    const buttonElement = document.createElement('button');
    buttonElement.className = 'add-shortcut-btn';
    buttonElement.setAttribute('aria-label', 'Add new custom shortcut');
    buttonElement.innerHTML = `
      <div class="plus-icon">+</div>
      <div class="add-text">Add shortcut</div>
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
      <div class="context-menu-item" data-action="edit">Edit shortcut</div>
      <div class="context-menu-item" data-action="remove">Remove</div>
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
    this.createShortcutModal('Add Shortcut', '', '', (name, url) => {
      // Ensure URL has protocol
      const finalUrl = url.startsWith('http') ? url : `https://${url}`;
      this.addCustomShortcut(name, finalUrl);
    });
  }

  /**
   * Edit a custom shortcut
   */
  editShortcut(site) {
    this.createShortcutModal('Edit Shortcut', site.title, site.url, (name, url) => {
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
            <label for="shortcut-name">Name:</label>
            <input type="text" id="shortcut-name" value="${initialName}" placeholder="Enter shortcut name" maxlength="20">
            <div class="error-message" id="name-error"></div>
          </div>
          <div class="input-group">
            <label for="shortcut-url">URL:</label>
            <input type="text" id="shortcut-url" value="${initialUrl}" placeholder="Enter URL (e.g., google.com)">
            <div class="error-message" id="url-error"></div>
          </div>
        </div>
        <div class="shortcut-modal-footer">
          <button class="shortcut-btn secondary" id="shortcut-cancel">Cancel</button>
          <button class="shortcut-btn primary" id="shortcut-ok">OK</button>
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
        modal.querySelector('#name-error').textContent = 'Name is required';
        isValid = false;
      }

      if (!url) {
        modal.querySelector('#url-error').textContent = 'URL is required';
        isValid = false;
      } else if (!this.isValidUrl(url)) {
        modal.querySelector('#url-error').textContent = 'Please enter a valid URL';
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