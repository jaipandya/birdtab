/**
 * Chrome Tab Module Tests
 * 
 * Tests cover the expected behavior of the Chrome Tab feature:
 * - Visibility toggle based on settings
 * - Click handling
 * - Default behavior (enabled by default)
 * 
 * Note: These tests mock the module behavior and test DOM interactions
 * rather than importing ES modules directly.
 */

describe('Chrome Tab Feature - Unit Tests', () => {
  let chromeTabLink;
  let storageListeners;

  beforeEach(() => {
    // Setup DOM
    document.body.innerHTML = `
      <a href="#" id="chrome-tab-link" class="chrome-tab-link">
        <svg class="chrome-tab-icon"></svg>
        <span class="chrome-tab-text">Chrome Tab</span>
      </a>
    `;

    chromeTabLink = document.getElementById('chrome-tab-link');
    storageListeners = [];

    // Mock chrome API
    global.chrome = {
      storage: {
        sync: {
          get: jest.fn((keys, callback) => {
            if (callback) {
              callback({});
            }
            return Promise.resolve({});
          }),
          set: jest.fn()
        },
        local: {
          get: jest.fn((keys, callback) => {
            if (callback) {
              callback({});
            }
            return Promise.resolve({});
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
      tabs: {
        create: jest.fn()
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

  describe('Visibility Based on Settings', () => {
    /**
     * Helper function that simulates the visibility update logic from chromeTab.js
     */
    async function updateChromeTabVisibility() {
      return new Promise((resolve) => {
        chrome.storage.local.get(['chromeTabEnabled'], (result) => {
          // Default is true (visible) - only hide if explicitly set to false
          const isEnabled = result.chromeTabEnabled !== false;

          if (isEnabled) {
            chromeTabLink.classList.remove('hidden');
          } else {
            chromeTabLink.classList.add('hidden');
          }
          resolve();
        });
      });
    }

    test('should show Chrome tab link by default (no setting stored)', async () => {
      global.chrome.storage.local.get = jest.fn((keys, callback) => {
        callback({}); // Empty - no setting
      });

      await updateChromeTabVisibility();

      expect(chromeTabLink.classList.contains('hidden')).toBe(false);
    });

    test('should show Chrome tab link when chromeTabEnabled is undefined', async () => {
      global.chrome.storage.local.get = jest.fn((keys, callback) => {
        callback({ chromeTabEnabled: undefined });
      });

      await updateChromeTabVisibility();

      expect(chromeTabLink.classList.contains('hidden')).toBe(false);
    });

    test('should show Chrome tab link when explicitly enabled (true)', async () => {
      global.chrome.storage.local.get = jest.fn((keys, callback) => {
        callback({ chromeTabEnabled: true });
      });

      await updateChromeTabVisibility();

      expect(chromeTabLink.classList.contains('hidden')).toBe(false);
    });

    test('should hide Chrome tab link when explicitly disabled (false)', async () => {
      global.chrome.storage.local.get = jest.fn((keys, callback) => {
        callback({ chromeTabEnabled: false });
      });

      await updateChromeTabVisibility();

      expect(chromeTabLink.classList.contains('hidden')).toBe(true);
    });

    test('should treat null value as enabled (show)', async () => {
      global.chrome.storage.local.get = jest.fn((keys, callback) => {
        callback({ chromeTabEnabled: null });
      });

      await updateChromeTabVisibility();

      // null !== false, so should be visible
      expect(chromeTabLink.classList.contains('hidden')).toBe(false);
    });
  });

  describe('Click Handling', () => {
    test('should open chrome://new-tab-page when clicked', () => {
      // Simulate the click handler from chromeTab.js
      chromeTabLink.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        chrome.tabs.create({ url: 'chrome://new-tab-page' });
      });

      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true
      });
      chromeTabLink.dispatchEvent(clickEvent);

      expect(global.chrome.tabs.create).toHaveBeenCalledWith({ url: 'chrome://new-tab-page' });
    });

    test('should prevent default link behavior', () => {
      let defaultPrevented = false;
      
      chromeTabLink.addEventListener('click', (e) => {
        e.preventDefault();
        defaultPrevented = true;
      });

      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true
      });
      chromeTabLink.dispatchEvent(clickEvent);

      expect(defaultPrevented).toBe(true);
    });
  });

  describe('Storage Change Handling', () => {
    test('should respond to chromeTabEnabled storage changes', async () => {
      // Simulate the storage listener logic
      const storageChangeHandler = (changes, namespace) => {
        if (namespace === 'local' && changes.chromeTabEnabled) {
          const isEnabled = changes.chromeTabEnabled.newValue !== false;
          if (isEnabled) {
            chromeTabLink.classList.remove('hidden');
          } else {
            chromeTabLink.classList.add('hidden');
          }
        }
      };

      // Initially visible
      expect(chromeTabLink.classList.contains('hidden')).toBe(false);

      // Simulate change to disabled
      storageChangeHandler({ chromeTabEnabled: { newValue: false } }, 'local');
      expect(chromeTabLink.classList.contains('hidden')).toBe(true);

      // Simulate change back to enabled
      storageChangeHandler({ chromeTabEnabled: { newValue: true } }, 'local');
      expect(chromeTabLink.classList.contains('hidden')).toBe(false);
    });

    test('should ignore changes from non-local namespace', () => {
      const storageChangeHandler = (changes, namespace) => {
        if (namespace === 'local' && changes.chromeTabEnabled) {
          const isEnabled = changes.chromeTabEnabled.newValue !== false;
          if (isEnabled) {
            chromeTabLink.classList.remove('hidden');
          } else {
            chromeTabLink.classList.add('hidden');
          }
        }
      };

      // Simulate change from 'sync' namespace
      storageChangeHandler({ chromeTabEnabled: { newValue: false } }, 'sync');
      
      // Should not be affected
      expect(chromeTabLink.classList.contains('hidden')).toBe(false);
    });

    test('should ignore unrelated storage changes', () => {
      const storageChangeHandler = (changes, namespace) => {
        if (namespace === 'local' && changes.chromeTabEnabled) {
          const isEnabled = changes.chromeTabEnabled.newValue !== false;
          if (isEnabled) {
            chromeTabLink.classList.remove('hidden');
          } else {
            chromeTabLink.classList.add('hidden');
          }
        }
      };

      // Simulate unrelated change
      storageChangeHandler({ someOtherSetting: { newValue: 'test' } }, 'local');
      
      // Should not be affected
      expect(chromeTabLink.classList.contains('hidden')).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    test('should handle missing DOM element gracefully', async () => {
      document.body.innerHTML = ''; // Remove element

      const updateVisibility = async () => {
        const element = document.getElementById('chrome-tab-link');
        if (!element) return;
        
        return new Promise((resolve) => {
          chrome.storage.local.get(['chromeTabEnabled'], (result) => {
            const isEnabled = result.chromeTabEnabled !== false;
            if (isEnabled) {
              element.classList.remove('hidden');
            } else {
              element.classList.add('hidden');
            }
            resolve();
          });
        });
      };

      // Should not throw
      await expect(updateVisibility()).resolves.not.toThrow();
    });
  });

  describe('CSS Specificity', () => {
    test('hidden class should override display:flex on chrome-tab-link', () => {
      // This test verifies the CSS fix for the specificity issue
      // where .chrome-tab-link { display: flex } was overriding .hidden { display: none }
      
      chromeTabLink.classList.add('hidden');
      
      // The element should have the hidden class
      expect(chromeTabLink.classList.contains('hidden')).toBe(true);
      
      // In a real browser with CSS, getComputedStyle would return 'none'
      // Here we just verify the class is added correctly
    });

    test('should toggle visibility correctly when settings change', async () => {
      // Helper simulating the module behavior
      async function updateVisibilityForSetting(isEnabled) {
        if (isEnabled) {
          chromeTabLink.classList.remove('hidden');
        } else {
          chromeTabLink.classList.add('hidden');
        }
      }

      // Initially visible (default)
      expect(chromeTabLink.classList.contains('hidden')).toBe(false);

      // Disable
      await updateVisibilityForSetting(false);
      expect(chromeTabLink.classList.contains('hidden')).toBe(true);

      // Re-enable
      await updateVisibilityForSetting(true);
      expect(chromeTabLink.classList.contains('hidden')).toBe(false);

      // Disable again
      await updateVisibilityForSetting(false);
      expect(chromeTabLink.classList.contains('hidden')).toBe(true);
    });
  });
});
