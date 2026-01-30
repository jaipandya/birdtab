/**
 * Popup script - Opens BirdTab extension page
 * 
 * When the user clicks the BirdTab icon in the browser toolbar,
 * this script opens the extension's index.html page directly.
 * This ensures users always get the BirdTab page, even if another
 * extension has overridden the new tab page.
 */

// Get the extension's own URL for index.html
const extensionUrl = chrome.runtime.getURL('index.html');

// Open the BirdTab page in a new tab
chrome.tabs.create({ url: extensionUrl });

// Close the popup immediately since we're opening a new tab
window.close();
