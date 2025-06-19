# BirdTab Development Scripts

This folder contains utility scripts for maintaining and validating the BirdTab extension.

## Available Scripts

### 🔍 Translation Checking Scripts

#### `check_i18n_completeness.js`
Checks if all language files have complete translations compared to the English reference.

**Usage:**
```bash
node scripts/check_i18n_completeness.js
# or
npm run check:i18n
```

**What it does:**
- Compares all language files against English (reference language)
- Reports missing translation strings for each language
- Shows completion percentage for each language
- Helps ensure all features are properly internationalized

#### `check_unused_strings.js`
Identifies translation strings that might not be used in the codebase.

**Usage:**
```bash
node scripts/check_unused_strings.js
# or
npm run check:unused
```

**What it does:**
- Scans all translation keys in English messages.json
- Searches the entire codebase for usage of each string
- Reports potentially unused strings
- Helps identify obsolete translations that can be removed

**Search patterns detected:**
- `chrome.i18n.getMessage('keyName')`
- `chrome.i18n.getMessage("keyName")`
- `chrome.i18n.getMessage(\`keyName\`)`
- `__MSG_keyName__` (manifest.json format)
- `data-i18n="keyName"` (HTML attributes)
- String literals in quotes
- Object keys and variable assignments

## Common Workflow

1. **After adding new features:**
   ```bash
   npm run check:i18n
   ```
   Ensure all new strings are translated in all languages.

2. **During code cleanup:**
   ```bash
   npm run check:unused
   ```
   Find and remove obsolete translation strings.

3. **Before releases:**
   ```bash
   npm run check:i18n && npm run check:unused
   ```
   Ensure complete translations and clean up unused strings.

## Notes

- The unused string checker may report false positives for:
  - Dynamically constructed key names
  - Strings used in Chrome extension predefined variables (`@@ui_locale`, `@@bidi_dir`)
  - Future features or debugging strings
  - Strings used in ways not detected by the search patterns

- Always manually verify before removing "unused" strings
- The scripts exclude build directories, node_modules, and translation files from searches
- Both scripts provide colored output for better readability

## File Structure

```
scripts/
├── README.md                    # This documentation
├── check_i18n_completeness.js  # Translation completeness checker
└── check_unused_strings.js     # Unused strings detector
``` 