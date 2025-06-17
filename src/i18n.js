// Shared i18n utility for Chrome extensions
// This provides a more idiomatic way to handle localization

/**
 * Generic function to localize HTML elements using data-i18n attributes
 * This is the recommended approach for Chrome extension i18n in HTML files
 */
export function localizeHtml() {
  // Localize elements with data-i18n attribute (text content)
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const messageKey = element.getAttribute('data-i18n');
    const message = chrome.i18n.getMessage(messageKey);
    if (message) {
      element.textContent = message;
    }
  });
  
  // Localize title attributes with data-i18n-title
  document.querySelectorAll('[data-i18n-title]').forEach(element => {
    const messageKey = element.getAttribute('data-i18n-title');
    const message = chrome.i18n.getMessage(messageKey);
    if (message) {
      element.title = message;
    }
  });
  
  // Localize alt attributes with data-i18n-alt
  document.querySelectorAll('[data-i18n-alt]').forEach(element => {
    const messageKey = element.getAttribute('data-i18n-alt');
    const message = chrome.i18n.getMessage(messageKey);
    if (message) {
      element.alt = message;
    }
  });
  
  // Localize placeholder attributes with data-i18n-placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    const messageKey = element.getAttribute('data-i18n-placeholder');
    const message = chrome.i18n.getMessage(messageKey);
    if (message) {
      element.placeholder = message;
    }
  });
  
  // Localize aria-label attributes with data-i18n-aria-label
  document.querySelectorAll('[data-i18n-aria-label]').forEach(element => {
    const messageKey = element.getAttribute('data-i18n-aria-label');
    const message = chrome.i18n.getMessage(messageKey);
    if (message) {
      element.setAttribute('aria-label', message);
    }
  });
  
  // Localize document title
  const titleElement = document.querySelector('title[data-i18n]');
  if (titleElement) {
    const messageKey = titleElement.getAttribute('data-i18n');
    const message = chrome.i18n.getMessage(messageKey);
    if (message) {
      document.title = message;
    }
  }
}

/**
 * Get a localized message with optional substitutions
 * @param {string} messageKey - The message key
 * @param {string|string[]} substitutions - Optional substitutions
 * @returns {string} The localized message
 */
export function getMessage(messageKey, substitutions = null) {
  return chrome.i18n.getMessage(messageKey, substitutions) || messageKey;
}

/**
 * Get the current UI language
 * @returns {string} The current UI language
 */
export function getUILanguage() {
  return chrome.i18n.getUILanguage();
}