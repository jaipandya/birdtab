/**
 * Permission dialog tests: onConfirm must run inside the Continue click,
 * because Firefox only allows permissions.request() while handling user input.
 */

jest.mock('../i18n.js', () => ({ getMessage: (key) => key }));

const { showPermissionDialog } = require('../permissionDialog.js');

function click(selector) {
  document.querySelector(selector).dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('showPermissionDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('resolves true on Continue and false on Go back', async () => {
    const confirmed = showPermissionDialog();
    click('.permission-dialog-btn-confirm');
    await expect(confirmed).resolves.toBe(true);

    const cancelled = showPermissionDialog();
    click('.permission-dialog-btn-cancel');
    await expect(cancelled).resolves.toBe(false);
  });

  test('runs onConfirm synchronously in the click and resolves with its result', async () => {
    let calledDuringClick = false;
    let inClick = false;
    const onConfirm = jest.fn(() => {
      calledDuringClick = inClick;
      return Promise.resolve('granted');
    });

    const result = showPermissionDialog({ onConfirm });
    inClick = true;
    click('.permission-dialog-btn-confirm');
    inClick = false;

    expect(calledDuringClick).toBe(true);
    await expect(result).resolves.toBe('granted');
  });

  test('does not run onConfirm on Go back', async () => {
    const onConfirm = jest.fn();
    const result = showPermissionDialog({ onConfirm });
    click('.permission-dialog-btn-cancel');
    await expect(result).resolves.toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('rejects when onConfirm throws', async () => {
    const result = showPermissionDialog({
      onConfirm: () => { throw new Error('request failed'); }
    });
    click('.permission-dialog-btn-confirm');
    await expect(result).rejects.toThrow('request failed');
  });
});
