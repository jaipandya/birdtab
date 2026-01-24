import { getMessage } from './i18n.js';

/**
 * Confirmation Dialog - A subtle confirmation modal styled like the feature tour
 *
 * Usage:
 *   const confirmed = await showConfirmationDialog({
 *     title: 'hideClockTitle',           // i18n key
 *     subtitle: 'hideClockSubtitle',     // i18n key
 *     cancelText: 'cancel',              // i18n key
 *     confirmText: 'hide',               // i18n key
 *   });
 *
 *   if (confirmed) {
 *     // User clicked Confirm
 *   }
 */

let activeDialog = null;

/**
 * Show a confirmation dialog and return a promise that resolves to true (confirm) or false (cancel)
 * @param {Object} options - Dialog configuration
 * @returns {Promise<boolean>} - Resolves to true if user confirms, false otherwise
 */
export function showConfirmationDialog(options = {}) {
  return new Promise((resolve) => {
    // Close any existing dialog
    if (activeDialog) {
      activeDialog.remove();
      activeDialog = null;
    }

    const {
      title = 'confirm',
      subtitle = '',
      cancelText = 'cancel',
      confirmText = 'ok'
    } = options;

    // Create backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'confirmation-dialog-backdrop';

    // Create dialog
    const dialog = document.createElement('div');
    dialog.className = 'confirmation-dialog';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'confirmation-dialog-title');
    dialog.setAttribute('aria-describedby', 'confirmation-dialog-subtitle');

    dialog.innerHTML = `
      <h3 id="confirmation-dialog-title" class="confirmation-dialog-title">
        ${getMessage(title) || 'Confirm'}
      </h3>
      <p id="confirmation-dialog-subtitle" class="confirmation-dialog-subtitle">
        ${getMessage(subtitle) || ''}
      </p>
      <div class="confirmation-dialog-actions">
        <button type="button" class="confirmation-dialog-btn secondary" id="confirm-cancel">
          ${getMessage(cancelText) || 'Cancel'}
        </button>
        <button type="button" class="confirmation-dialog-btn primary" id="confirm-ok">
          ${getMessage(confirmText) || 'OK'}
        </button>
      </div>
    `;

    // Add to DOM
    document.body.appendChild(backdrop);
    document.body.appendChild(dialog);
    activeDialog = { backdrop, dialog };

    // Get button references
    const cancelBtn = dialog.querySelector('#confirm-cancel');
    const confirmBtn = dialog.querySelector('#confirm-ok');

    // Focus the cancel button for accessibility (safer default)
    setTimeout(() => cancelBtn.focus(), 100);

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

    // Handle keyboard
    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
      // Trap focus within dialog
      if (e.key === 'Tab') {
        const focusableElements = dialog.querySelectorAll('button');
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
    const handleBackdropClick = () => {
      handleCancel();
    };

    // Cleanup function
    const cleanup = () => {
      cancelBtn.removeEventListener('click', handleCancel);
      confirmBtn.removeEventListener('click', handleConfirm);
      document.removeEventListener('keydown', handleKeydown);
      backdrop.removeEventListener('click', handleBackdropClick);

      // Animate out
      backdrop.classList.add('closing');
      dialog.classList.add('closing');

      setTimeout(() => {
        if (backdrop.parentNode) backdrop.remove();
        if (dialog.parentNode) dialog.remove();
        activeDialog = null;
      }, 200);
    };

    // Bind events
    cancelBtn.addEventListener('click', handleCancel);
    confirmBtn.addEventListener('click', handleConfirm);
    document.addEventListener('keydown', handleKeydown);
    backdrop.addEventListener('click', handleBackdropClick);
  });
}

/**
 * Close any active confirmation dialog
 */
export function closeConfirmationDialog() {
  if (activeDialog) {
    const { backdrop, dialog } = activeDialog;
    backdrop.classList.add('closing');
    dialog.classList.add('closing');
    setTimeout(() => {
      if (backdrop && backdrop.parentNode) backdrop.remove();
      if (dialog && dialog.parentNode) dialog.remove();
      activeDialog = null;
    }, 200);
  }
}

export default { showConfirmationDialog, closeConfirmationDialog };
