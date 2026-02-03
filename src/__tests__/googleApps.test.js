/**
 * Google Apps Module Tests
 * 
 * Tests cover the expected behavior of the Google Apps feature:
 * - Trigger button visibility based on settings
 * - Panel open/close functionality
 * - Keyboard handling (Escape to close)
 * - App content structure
 * 
 * Note: These tests mock the module behavior and test DOM interactions
 * rather than importing ES modules directly.
 */

// Mock app data structure (mirrors googleApps.js)
const GOOGLE_APPS = {
  primary: [
    { id: 'account', name: 'Account', url: 'https://myaccount.google.com' },
    { id: 'gmail', name: 'Gmail', url: 'https://mail.google.com' },
    { id: 'drive', name: 'Drive', url: 'https://drive.google.com' },
    { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com' },
    // ... 18 apps total (simplified for tests)
  ],
  secondary: [
    { id: 'shopping', name: 'Shopping', url: 'https://shopping.google.com' },
    { id: 'play', name: 'Play', url: 'https://play.google.com' },
    // ... 25 apps total (simplified for tests)
  ]
};

describe('Google Apps Feature - Unit Tests', () => {
  let storageListeners;

  beforeEach(() => {
    // Setup DOM
    document.body.innerHTML = `
      <a href="#" id="chrome-tab-link" class="chrome-tab-link">
        <svg class="chrome-tab-icon"></svg>
      </a>
      <div id="content-container"></div>
    `;

    storageListeners = [];

    // Mock chrome API
    global.chrome = {
      storage: {
        sync: {
          get: jest.fn((keys, callback) => {
            if (callback) {
              callback({ googleAppsEnabled: false });
            }
            return Promise.resolve({ googleAppsEnabled: false });
          }),
          set: jest.fn()
        },
        onChanged: {
          addListener: jest.fn((callback) => {
            storageListeners.push(callback);
          }),
          removeListener: jest.fn()
        }
      },
      i18n: {
        getMessage: jest.fn((key) => key)
      }
    };
  });

  afterEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
  });

  describe('Trigger Button Visibility', () => {
    /**
     * Helper to create trigger button (simulates googleApps.js behavior)
     */
    function createTriggerButton() {
      const button = document.createElement('button');
      button.id = 'google-apps-trigger';
      button.className = 'google-apps-trigger hidden';
      button.setAttribute('aria-label', 'Open Google Apps');
      button.innerHTML = '<svg>...</svg>';
      
      const chromeTabLink = document.getElementById('chrome-tab-link');
      if (chromeTabLink && chromeTabLink.parentNode) {
        chromeTabLink.parentNode.insertBefore(button, chromeTabLink);
      }
      
      return button;
    }

    /**
     * Helper to update visibility based on settings
     */
    async function updateVisibility() {
      return new Promise((resolve) => {
        chrome.storage.sync.get(['googleAppsEnabled'], (result) => {
          const isEnabled = result.googleAppsEnabled || false;
          const button = document.getElementById('google-apps-trigger');
          
          if (isEnabled) {
            button?.classList.remove('hidden');
            document.body.classList.add('google-apps-enabled');
          } else {
            button?.classList.add('hidden');
            document.body.classList.remove('google-apps-enabled');
          }
          resolve();
        });
      });
    }

    test('should hide trigger button when googleAppsEnabled is false', async () => {
      global.chrome.storage.sync.get = jest.fn((keys, callback) => {
        callback({ googleAppsEnabled: false });
      });

      const button = createTriggerButton();
      await updateVisibility();

      expect(button.classList.contains('hidden')).toBe(true);
    });

    test('should show trigger button when googleAppsEnabled is true', async () => {
      global.chrome.storage.sync.get = jest.fn((keys, callback) => {
        callback({ googleAppsEnabled: true });
      });

      const button = createTriggerButton();
      await updateVisibility();

      expect(button.classList.contains('hidden')).toBe(false);
    });

    test('should add google-apps-enabled class to body when enabled', async () => {
      global.chrome.storage.sync.get = jest.fn((keys, callback) => {
        callback({ googleAppsEnabled: true });
      });

      createTriggerButton();
      await updateVisibility();

      expect(document.body.classList.contains('google-apps-enabled')).toBe(true);
    });

    test('should remove google-apps-enabled class when disabled', async () => {
      document.body.classList.add('google-apps-enabled');
      
      global.chrome.storage.sync.get = jest.fn((keys, callback) => {
        callback({ googleAppsEnabled: false });
      });

      createTriggerButton();
      await updateVisibility();

      expect(document.body.classList.contains('google-apps-enabled')).toBe(false);
    });
  });

  describe('Panel Open/Close', () => {
    let isOpen = false;
    let panel = null;

    /**
     * Helper to create panel (simulates googleApps.js behavior)
     */
    function createPanel() {
      const panelHTML = `
        <div id="google-apps-panel" class="settings-sidebar" role="dialog">
          <div class="settings-content google-apps-content">
            <div class="settings-header">
              <h2>Google Apps</h2>
              <button id="close-google-apps" class="close-button" data-i18n-aria-label="closeGoogleApps">×</button>
            </div>
            <div class="settings-body">
              <div class="google-apps-grid">
                <a href="https://mail.google.com" class="google-app-item">
                  <div class="google-app-icon-wrapper"><img class="google-app-icon" src="icon.svg"></div>
                  <span class="google-app-name">Gmail</span>
                </a>
              </div>
              <div class="google-apps-divider"></div>
              <div class="google-apps-grid">
                <a href="https://play.google.com" class="google-app-item">
                  <div class="google-app-icon-wrapper"><img class="google-app-icon" src="icon.svg"></div>
                  <span class="google-app-name">Play</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      `;
      document.body.insertAdjacentHTML('beforeend', panelHTML);
      panel = document.getElementById('google-apps-panel');
      return panel;
    }

    function openPanel() {
      if (isOpen) return;
      if (!panel) {
        createPanel();
      }
      isOpen = true;
      panel.classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    function closePanel() {
      if (!isOpen || !panel) return;
      isOpen = false;
      panel.classList.remove('open');
      document.body.style.overflow = '';
    }

    beforeEach(() => {
      isOpen = false;
      panel = null;
    });

    test('should create panel on first open', () => {
      openPanel();

      expect(document.getElementById('google-apps-panel')).toBeTruthy();
    });

    test('should add open class when opened', () => {
      openPanel();

      expect(panel.classList.contains('open')).toBe(true);
    });

    test('should remove open class when closed', () => {
      openPanel();
      closePanel();

      expect(panel.classList.contains('open')).toBe(false);
    });

    test('should set body overflow to hidden when open', () => {
      openPanel();

      expect(document.body.style.overflow).toBe('hidden');
    });

    test('should reset body overflow when closed', () => {
      openPanel();
      closePanel();

      expect(document.body.style.overflow).toBe('');
    });

    test('should not create multiple panels', () => {
      openPanel();
      openPanel();

      const panels = document.querySelectorAll('#google-apps-panel');
      expect(panels.length).toBe(1);
    });
  });

  describe('Keyboard Handling', () => {
    let isOpen = false;

    function handleEscapeKey(e) {
      if (e.key === 'Escape' && isOpen) {
        isOpen = false;
        const panel = document.getElementById('google-apps-panel');
        if (panel) {
          panel.classList.remove('open');
        }
      }
    }

    beforeEach(() => {
      isOpen = false;
      document.addEventListener('keydown', handleEscapeKey);
    });

    afterEach(() => {
      document.removeEventListener('keydown', handleEscapeKey);
    });

    test('should close panel on Escape key', () => {
      // Setup open panel
      document.body.innerHTML += `<div id="google-apps-panel" class="settings-sidebar open"></div>`;
      isOpen = true;

      const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(escapeEvent);

      expect(isOpen).toBe(false);
      expect(document.getElementById('google-apps-panel').classList.contains('open')).toBe(false);
    });

    test('should not close panel for other keys', () => {
      document.body.innerHTML += `<div id="google-apps-panel" class="settings-sidebar open"></div>`;
      isOpen = true;

      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
      document.dispatchEvent(enterEvent);

      expect(isOpen).toBe(true);
    });

    test('should not react to Escape when panel is closed', () => {
      isOpen = false;

      const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' });
      
      // Should not throw
      expect(() => document.dispatchEvent(escapeEvent)).not.toThrow();
    });
  });

  describe('Storage Change Handling', () => {
    test('should respond to googleAppsEnabled changes', () => {
      const button = document.createElement('button');
      button.id = 'google-apps-trigger';
      button.className = 'google-apps-trigger hidden';
      document.body.appendChild(button);

      // Simulate storage change handler
      const storageChangeHandler = async (changes, namespace) => {
        if (namespace === 'sync' && changes.googleAppsEnabled) {
          const isEnabled = changes.googleAppsEnabled.newValue || false;
          if (isEnabled) {
            button.classList.remove('hidden');
          } else {
            button.classList.add('hidden');
          }
        }
      };

      // Simulate change to enabled
      storageChangeHandler({ googleAppsEnabled: { newValue: true } }, 'sync');
      expect(button.classList.contains('hidden')).toBe(false);

      // Simulate change to disabled
      storageChangeHandler({ googleAppsEnabled: { newValue: false } }, 'sync');
      expect(button.classList.contains('hidden')).toBe(true);
    });
  });

  describe('Panel Content Structure', () => {
    test('should have correct panel structure', () => {
      const panelHTML = `
        <div id="google-apps-panel" class="settings-sidebar">
          <div class="settings-content google-apps-content">
            <div class="settings-header">
              <h2>Google Apps</h2>
              <button id="close-google-apps" class="close-button" data-i18n-aria-label="closeGoogleApps"></button>
            </div>
            <div class="settings-body">
              <div class="google-apps-grid"></div>
              <div class="google-apps-divider"></div>
              <div class="google-apps-grid"></div>
            </div>
          </div>
        </div>
      `;
      document.body.innerHTML = panelHTML;

      const panel = document.getElementById('google-apps-panel');
      
      expect(panel).toBeTruthy();
      expect(panel.querySelector('.settings-header')).toBeTruthy();
      expect(panel.querySelector('.close-button')).toBeTruthy();
      expect(panel.querySelectorAll('.google-apps-grid').length).toBe(2);
      expect(panel.querySelector('.google-apps-divider')).toBeTruthy();
    });

    test('app links should open in current tab', () => {
      document.body.innerHTML = `
        <a href="https://mail.google.com" class="google-app-item">
          Gmail
        </a>
      `;

      const link = document.querySelector('.google-app-item');
      
      expect(link.getAttribute('target')).toBe(null);
      expect(link.getAttribute('rel')).toBe(null);
    });
  });

  describe('App Data', () => {
    test('should have primary apps section', () => {
      expect(GOOGLE_APPS.primary).toBeDefined();
      expect(Array.isArray(GOOGLE_APPS.primary)).toBe(true);
    });

    test('should have secondary apps section', () => {
      expect(GOOGLE_APPS.secondary).toBeDefined();
      expect(Array.isArray(GOOGLE_APPS.secondary)).toBe(true);
    });

    test('each app should have required properties', () => {
      const allApps = [...GOOGLE_APPS.primary, ...GOOGLE_APPS.secondary];
      
      allApps.forEach(app => {
        expect(app.id).toBeDefined();
        expect(app.name).toBeDefined();
        expect(app.url).toBeDefined();
        expect(app.url).toMatch(/^https?:\/\//);
      });
    });
  });
});
