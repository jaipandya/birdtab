import { getMessage } from './i18n.js';

/**
 * Permission Dialog - A reusable full-screen dialog for requesting permissions
 *
 * Usage:
 *   const result = await showPermissionDialog({
 *     title: 'permissionDialogTitle',           // i18n key
 *     subtitle: 'permissionDialogSubtitle',     // i18n key
 *     privacyText: 'permissionDialogPrivacy',   // i18n key (optional)
 *     privacyLinkText: 'privacyPolicy',         // i18n key (optional)
 *     privacyLinkUrl: 'https://...',            // URL (optional)
 *     cancelText: 'goBack',                     // i18n key (optional, defaults to 'goBack')
 *     confirmText: 'continue',                  // i18n key (optional, defaults to 'continue')
 *   });
 *
 *   if (result) {
 *     // User clicked Continue
 *   } else {
 *     // User clicked Go back
 *   }
 */

let activeDialog = null;

/**
 * Show a permission dialog and return a promise that resolves to true (continue) or false (go back)
 * @param {Object} options - Dialog configuration
 * @returns {Promise<boolean>} - Resolves to true if user clicks Continue, false if Go back
 */
export function showPermissionDialog(options = {}) {
  return new Promise((resolve) => {
    // Close any existing dialog
    if (activeDialog) {
      activeDialog.remove();
      activeDialog = null;
    }

    const {
      title = 'permissionDialogTitle',
      subtitle = 'permissionDialogSubtitle',
      privacyText = 'permissionDialogPrivacy',
      privacyLinkText = 'privacyPolicy',
      privacyLinkUrl = 'https://birdtab.app/privacy',
      cancelText = 'goBack',
      confirmText = 'continue'
    } = options;

    // Create dialog element
    const dialog = document.createElement('div');
    dialog.className = 'permission-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'permission-dialog-title');

    // Build privacy section HTML
    let privacyHTML = '';
    if (privacyText) {
      const privacyMessage = getMessage(privacyText) || 'We value and protect your privacy.';
      const linkText = getMessage(privacyLinkText) || 'Privacy Policy';

      if (privacyLinkUrl) {
        privacyHTML = `
          <p class="permission-dialog-privacy">
            ${privacyMessage} <a href="${privacyLinkUrl}" target="_blank" rel="noopener noreferrer">${linkText}</a>
          </p>
        `;
      } else {
        privacyHTML = `<p class="permission-dialog-privacy">${privacyMessage}</p>`;
      }
    }

    dialog.innerHTML = `
      <div class="permission-dialog-backdrop"></div>
      <div class="permission-dialog-content">
        <h1 id="permission-dialog-title" class="permission-dialog-title">
          ${getMessage(title) || 'Permission Required'}
        </h1>
        <p class="permission-dialog-subtitle">
          ${getMessage(subtitle) || 'This feature requires additional permissions.'}
        </p>
        ${privacyHTML}
        <div class="permission-dialog-buttons">
          <button type="button" class="permission-dialog-btn permission-dialog-btn-cancel">
            ${getMessage(cancelText) || 'Go back'}
          </button>
          <button type="button" class="permission-dialog-btn permission-dialog-btn-confirm">
            ${getMessage(confirmText) || 'Continue'}
          </button>
        </div>
      </div>
    `;

    // Add to DOM
    document.body.appendChild(dialog);
    activeDialog = dialog;

    // Get button references
    const cancelBtn = dialog.querySelector('.permission-dialog-btn-cancel');
    const confirmBtn = dialog.querySelector('.permission-dialog-btn-confirm');

    // Focus the confirm button for accessibility
    setTimeout(() => confirmBtn.focus(), 100);

    // Handle cancel
    const handleCancel = () => {
      cleanup();
      resolve(false);
    };

    // Handle confirm
    const handleConfirm = () => {
      cleanup();
      resolve(true);
    };

    // Handle escape key
    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
      // Trap focus within dialog
      if (e.key === 'Tab') {
        const focusableElements = dialog.querySelectorAll('button, a[href]');
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    // Handle backdrop click
    const handleBackdropClick = (e) => {
      if (e.target.classList.contains('permission-dialog-backdrop')) {
        handleCancel();
      }
    };

    // Cleanup function
    const cleanup = () => {
      cancelBtn.removeEventListener('click', handleCancel);
      confirmBtn.removeEventListener('click', handleConfirm);
      document.removeEventListener('keydown', handleKeydown);
      dialog.removeEventListener('click', handleBackdropClick);

      // Animate out
      dialog.classList.add('permission-dialog-closing');
      setTimeout(() => {
        if (dialog.parentNode) {
          dialog.remove();
        }
        if (activeDialog === dialog) {
          activeDialog = null;
        }
      }, 200);
    };

    // Bind events
    cancelBtn.addEventListener('click', handleCancel);
    confirmBtn.addEventListener('click', handleConfirm);
    document.addEventListener('keydown', handleKeydown);
    dialog.addEventListener('click', handleBackdropClick);

    // Trigger entrance animation
    requestAnimationFrame(() => {
      dialog.classList.add('permission-dialog-visible');
    });
  });
}

/**
 * Close any active permission dialog
 */
export function closePermissionDialog() {
  if (activeDialog) {
    activeDialog.classList.add('permission-dialog-closing');
    setTimeout(() => {
      if (activeDialog && activeDialog.parentNode) {
        activeDialog.remove();
      }
      activeDialog = null;
    }, 200);
  }
}

export default { showPermissionDialog, closePermissionDialog };
