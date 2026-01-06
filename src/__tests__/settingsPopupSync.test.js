/**
 * Tests to ensure Settings Modal and Popup Menu are in sync
 * This test verifies that all settings available in the settings modal
 * are also available in the toolbar popup menu
 */

const { readFileSync } = require('fs');
const { join } = require('path');

describe('Settings and Popup Menu Sync', () => {
  let popupHTML;
  let popupJS;
  let settingsModalJS;
  
  beforeAll(() => {
    // Read the actual source files
    const srcPath = join(__dirname, '..');
    popupHTML = readFileSync(join(srcPath, 'popup.html'), 'utf8');
    popupJS = readFileSync(join(srcPath, 'popup.js'), 'utf8');
    settingsModalJS = readFileSync(join(srcPath, 'settingsModal.js'), 'utf8');
  });

  describe('HTML Elements Sync', () => {
    test('popup.html should have region select matching settingsModal', () => {
      expect(popupHTML).toContain('id="region"');
      expect(settingsModalJS).toContain('id="modal-region"');
    });

    test('popup.html should have auto-play checkbox matching settingsModal', () => {
      expect(popupHTML).toContain('id="auto-play"');
      expect(settingsModalJS).toContain('id="modal-auto-play"');
    });

    test('popup.html should have quiet hours checkbox matching settingsModal', () => {
      expect(popupHTML).toContain('id="quiet-hours"');
      expect(settingsModalJS).toContain('id="modal-quiet-hours"');
    });

    test('popup.html should have productivity checkbox matching settingsModal', () => {
      expect(popupHTML).toContain('id="enable-productivity"');
      expect(settingsModalJS).toContain('id="modal-enable-productivity"');
    });

    test('popup.html should have video mode checkbox matching settingsModal', () => {
      expect(popupHTML).toContain('id="video-mode"');
      expect(settingsModalJS).toContain('id="modal-video-mode"');
    });

    test('popup.html should have high-res checkbox matching settingsModal', () => {
      expect(popupHTML).toContain('id="high-res"');
      expect(settingsModalJS).toContain('id="modal-high-res"');
    });

    test('popup.html should have Pro badges for premium features', () => {
      // Count Pro badges in popup
      const proBadgeMatches = popupHTML.match(/class="pro-badge"/g);
      expect(proBadgeMatches).toBeTruthy();
      expect(proBadgeMatches.length).toBeGreaterThanOrEqual(3); // region, video-mode, high-res
    });
  });

  describe('JavaScript Element References Sync', () => {
    test('popup.js should reference all setting elements', () => {
      expect(popupJS).toContain("getElementById('region')");
      expect(popupJS).toContain("getElementById('auto-play')");
      expect(popupJS).toContain("getElementById('quiet-hours')");
      expect(popupJS).toContain("getElementById('enable-productivity')");
      expect(popupJS).toContain("getElementById('video-mode')");
      expect(popupJS).toContain("getElementById('high-res')");
    });

    test('settingsModal.js should reference all setting elements with modal- prefix', () => {
      expect(settingsModalJS).toContain("getElementById('modal-region')");
      expect(settingsModalJS).toContain("getElementById('modal-auto-play')");
      expect(settingsModalJS).toContain("getElementById('modal-quiet-hours')");
      expect(settingsModalJS).toContain("getElementById('modal-enable-productivity')");
      expect(settingsModalJS).toContain("getElementById('modal-video-mode')");
      expect(settingsModalJS).toContain("getElementById('modal-high-res')");
    });
  });

  describe('Storage Keys Sync', () => {
    const expectedStorageKeys = [
      'region',
      'autoPlay',
      'quietHours',
      'quickAccessEnabled',
      'videoMode',
      'highResImages'
    ];

    test('popup.js should load all storage keys', () => {
      // Check chrome.storage.sync.get call in popup.js
      const storageGetMatch = popupJS.match(/chrome\.storage\.sync\.get\(\[(.*?)\]/s);
      expect(storageGetMatch).toBeTruthy();
      
      const loadedKeys = storageGetMatch[1];
      expectedStorageKeys.forEach(key => {
        expect(loadedKeys).toContain(`'${key}'`);
      });
    });

    test('settingsModal.js should load all storage keys', () => {
      // Check chrome.storage.sync.get call in settingsModal.js
      const storageGetMatch = settingsModalJS.match(/chrome\.storage\.sync\.get\(\[(.*?)\]/s);
      expect(storageGetMatch).toBeTruthy();
      
      const loadedKeys = storageGetMatch[1];
      expectedStorageKeys.forEach(key => {
        expect(loadedKeys).toContain(`'${key}'`);
      });
    });

    test('popup.js should save all settings to storage', () => {
      // Verify saveSettings function includes all keys
      expect(popupJS).toContain('region: regionSelect.value');
      expect(popupJS).toContain('autoPlay: autoPlayCheckbox.checked');
      expect(popupJS).toContain('quietHours: quietHoursCheckbox.checked');
      expect(popupJS).toContain('videoMode: videoModeCheckbox.checked');
      expect(popupJS).toContain('highResImages: highResCheckbox.checked');
    });

    test('settingsModal.js should save all settings to storage', () => {
      // Verify saveSettings method includes all keys
      expect(settingsModalJS).toContain('settings.region = this.regionSelect.value');
      expect(settingsModalJS).toContain('settings.autoPlay = this.autoPlayCheckbox.checked');
      expect(settingsModalJS).toContain('settings.quietHours = this.quietHoursCheckbox.checked');
      expect(settingsModalJS).toContain('settings.quickAccessEnabled = this.enableProductivityCheckbox.checked');
      expect(settingsModalJS).toContain('settings.videoMode = this.videoModeCheckbox.checked');
      expect(settingsModalJS).toContain('settings.highResImages = this.highResCheckbox.checked');
    });
  });

  describe('Event Listeners Sync', () => {
    test('popup.js should have event listeners for all checkboxes', () => {
      expect(popupJS).toContain("regionSelect.addEventListener('change', saveSettings)");
      expect(popupJS).toContain("autoPlayCheckbox.addEventListener('change', saveSettings)");
      expect(popupJS).toContain("quietHoursCheckbox.addEventListener('change', saveSettings)");
      expect(popupJS).toContain("videoModeCheckbox.addEventListener('change', saveSettings)");
      expect(popupJS).toContain("highResCheckbox.addEventListener('change', saveSettings)");
    });

    test('popup.js should have special handler for productivity toggle', () => {
      expect(popupJS).toContain("enableProductivityCheckbox.addEventListener('change'");
      expect(popupJS).toContain('chrome.permissions.request');
    });

    test('settingsModal.js should have event listeners for all settings', () => {
      expect(settingsModalJS).toContain("this.regionSelect.addEventListener('change'");
      expect(settingsModalJS).toContain("this.autoPlayCheckbox.addEventListener('change'");
      expect(settingsModalJS).toContain("this.quietHoursCheckbox.addEventListener('change'");
      expect(settingsModalJS).toContain("this.videoModeCheckbox.addEventListener('change'");
      expect(settingsModalJS).toContain("this.highResCheckbox.addEventListener('change'");
    });
  });

  describe('i18n Keys Sync', () => {
    const expectedI18nKeys = [
      'birdingRegion',
      'autoPlayBirdCalls',
      'quietHours',
      'quickAccessFeatures',
      'videoMode',
      'highResImages',
      'proBadge'
    ];

    test('popup.html should have all i18n keys', () => {
      expectedI18nKeys.forEach(key => {
        expect(popupHTML).toContain(`data-i18n="${key}"`);
      });
    });

    test('settingsModal.js should have all i18n keys in modal HTML', () => {
      expectedI18nKeys.forEach(key => {
        expect(settingsModalJS).toContain(`data-i18n="${key}"`);
      });
    });
  });

  describe('Help Text Sync', () => {
    test('popup.html should have help text for all settings', () => {
      expect(popupHTML).toContain('data-i18n="regionHelpText"');
      expect(popupHTML).toContain('data-i18n="autoPlayHelpText"');
      expect(popupHTML).toContain('data-i18n="quietHoursHelpText"');
      expect(popupHTML).toContain('data-i18n="productivityHelpText"');
      expect(popupHTML).toContain('data-i18n="videoModeHelpText"');
      expect(popupHTML).toContain('data-i18n="highResHelpText"');
    });

    test('settingsModal.js should have help text for all settings', () => {
      expect(settingsModalJS).toContain('data-i18n="regionHelpText"');
      expect(settingsModalJS).toContain('data-i18n="autoPlayHelpText"');
      expect(settingsModalJS).toContain('data-i18n="quietHoursHelpText"');
      expect(settingsModalJS).toContain('data-i18n="productivityHelpText"');
      expect(settingsModalJS).toContain('data-i18n="videoModeHelpText"');
      expect(settingsModalJS).toContain('data-i18n="highResHelpText"');
    });
  });

  describe('Variable Declarations Sync', () => {
    test('popup.js should declare all checkbox/select variables', () => {
      expect(popupJS).toContain('const regionSelect');
      expect(popupJS).toContain('const autoPlayCheckbox');
      expect(popupJS).toContain('const quietHoursCheckbox');
      expect(popupJS).toContain('const enableProductivityCheckbox');
      expect(popupJS).toContain('const videoModeCheckbox');
      expect(popupJS).toContain('const highResCheckbox');
    });

    test('settingsModal.js should assign all checkbox/select instance variables', () => {
      expect(settingsModalJS).toContain('this.regionSelect =');
      expect(settingsModalJS).toContain('this.autoPlayCheckbox =');
      expect(settingsModalJS).toContain('this.quietHoursCheckbox =');
      expect(settingsModalJS).toContain('this.enableProductivityCheckbox =');
      expect(settingsModalJS).toContain('this.videoModeCheckbox =');
      expect(settingsModalJS).toContain('this.highResCheckbox =');
    });
  });

  describe('Feature Completeness', () => {
    test('popup.html should have same number of toggle settings as settingsModal', () => {
      const popupToggles = (popupHTML.match(/class="toggle-container"/g) || []).length;
      const modalToggles = (settingsModalJS.match(/class="toggle-container"/g) || []).length;
      
      expect(popupToggles).toBe(modalToggles);
    });

    test('both should handle productivity permissions the same way', () => {
      // Both should request permissions
      expect(popupJS).toContain('chrome.permissions.request');
      expect(settingsModalJS).toContain('chrome.permissions.request');
      
      // Both should handle topSites and favicon permissions
      expect(popupJS).toContain("'topSites'");
      expect(popupJS).toContain("'favicon'");
      expect(settingsModalJS).toContain("'topSites'");
      expect(settingsModalJS).toContain("'favicon'");
    });
  });
});
