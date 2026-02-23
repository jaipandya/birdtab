/**
 * Storage Migration Module
 *
 * Handles migration of settings from chrome.storage.sync to chrome.storage.local.
 * This simplifies license management and makes settings device-specific.
 *
 * Keys that REMAIN in sync (cross-device):
 * - onboardingComplete
 * - featureTourVersion
 * - seenFeatures
 *
 * All other settings move to local storage.
 */

import { CONFIG } from './config.js';
import { log } from './logger.js';

// Current migration version - increment when making migration changes
const MIGRATION_VERSION = 1;

// Storage key for tracking migration status (in local storage)
const MIGRATION_FLAG_KEY = 'storageMigrationVersion';

/**
 * Check if migration is needed
 * Returns true if:
 * 1. Migration hasn't run yet (no flag in local storage)
 * 2. There's data in sync storage to migrate
 *
 * @returns {Promise<boolean>}
 */
export async function needsMigration() {
  try {
    // Check if already migrated
    const localResult = await chrome.storage.local.get([MIGRATION_FLAG_KEY]);
    if (localResult[MIGRATION_FLAG_KEY] >= MIGRATION_VERSION) {
      log('Storage migration: Already migrated');
      return false;
    }

    // Check if there's data in sync to migrate
    // Look for any key that should be in local storage
    const syncKeys = Object.keys(CONFIG.STORAGE_DEFAULTS);
    const syncResult = await chrome.storage.sync.get(syncKeys);

    // Filter out keys that should stay in sync
    const migratableKeys = Object.keys(syncResult).filter(
      key => !CONFIG.SYNC_STORAGE_KEYS.includes(key)
    );

    const hasDataToMigrate = migratableKeys.length > 0;
    log(`Storage migration: Has data to migrate: ${hasDataToMigrate} (${migratableKeys.length} keys)`);

    return hasDataToMigrate;
  } catch (error) {
    log(`Storage migration: Error checking migration status: ${error.message}`);
    return false;
  }
}

/**
 * Run the migration from sync to local storage
 * 1. Read all migratable data from sync storage
 * 2. Merge with defaults (for any missing values)
 * 3. Write to local storage
 * 4. DELETE the migrated keys from sync storage
 * 5. Set migration flag in local storage
 *
 * @returns {Promise<boolean>} True if migration succeeded
 */
export async function runMigration() {
  try {
    log('Storage migration: Starting migration...');

    // Get all keys we might need to migrate
    const allKeys = Object.keys(CONFIG.STORAGE_DEFAULTS);
    const syncResult = await chrome.storage.sync.get(allKeys);

    // Build the data to write to local storage
    // Start with defaults, then override with existing sync values
    const localData = { ...CONFIG.STORAGE_DEFAULTS };

    for (const key of allKeys) {
      if (syncResult[key] !== undefined && !CONFIG.SYNC_STORAGE_KEYS.includes(key)) {
        localData[key] = syncResult[key];
      }
    }

    // Write to local storage
    await chrome.storage.local.set(localData);
    log('Storage migration: Data written to local storage');

    // Delete migrated keys from sync storage
    const keysToDelete = allKeys.filter(
      key => !CONFIG.SYNC_STORAGE_KEYS.includes(key) && syncResult[key] !== undefined
    );

    if (keysToDelete.length > 0) {
      await chrome.storage.sync.remove(keysToDelete);
      log(`Storage migration: Deleted ${keysToDelete.length} keys from sync storage`);
    }

    // Set migration flag
    await chrome.storage.local.set({ [MIGRATION_FLAG_KEY]: MIGRATION_VERSION });
    log('Storage migration: Migration completed successfully');

    return true;
  } catch (error) {
    log(`Storage migration: Migration failed: ${error.message}`);
    return false;
  }
}

/**
 * Initialize local storage for a fresh install
 * Sets all defaults in local storage
 *
 * @returns {Promise<boolean>} True if initialization succeeded
 */
export async function initializeFreshInstall() {
  try {
    log('Storage migration: Initializing fresh install...');

    // Set all defaults in local storage
    await chrome.storage.local.set({
      ...CONFIG.STORAGE_DEFAULTS,
      [MIGRATION_FLAG_KEY]: MIGRATION_VERSION
    });

    log('Storage migration: Fresh install initialized with defaults');
    return true;
  } catch (error) {
    log(`Storage migration: Fresh install initialization failed: ${error.message}`);
    return false;
  }
}

/**
 * Check if local storage has been initialized
 * (Either through migration or fresh install)
 *
 * @returns {Promise<boolean>}
 */
export async function isLocalStorageInitialized() {
  try {
    const result = await chrome.storage.local.get([MIGRATION_FLAG_KEY]);
    return result[MIGRATION_FLAG_KEY] >= MIGRATION_VERSION;
  } catch (error) {
    log(`Storage migration: Error checking initialization: ${error.message}`);
    return false;
  }
}

/**
 * Ensure local storage is initialized
 * Called on extension startup to handle edge cases
 *
 * @returns {Promise<void>}
 */
export async function ensureLocalStorageInitialized() {
  const isInitialized = await isLocalStorageInitialized();

  if (!isInitialized) {
    // Check if there's sync data to migrate
    const shouldMigrate = await needsMigration();

    if (shouldMigrate) {
      await runMigration();
    } else {
      // No sync data - initialize with defaults
      await initializeFreshInstall();
    }
  }
}
