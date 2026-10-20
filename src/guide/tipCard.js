/**
 * One tip on the page (guide.js decides which, and when): a small glass card beside the thing it
 * talks about, with a soft ring around that thing. It never dims the photo or takes focus; the
 * page stays usable around it.
 *
 * Placement: next to `target` (above it in the lower half of the page, below it in the upper
 * half), its arrow on the target's centre; at the bottom centre pointing down (`placement:
 * 'bottom-edge'`, for Chrome's own footer under the page); or in the corner (no target). A card
 * that would cover `avoid` (the bird's name) rises above it instead, without its arrow; the ring
 * still marks the target.
 *
 * A card can offer `choices` (a short list, the one in use marked) and `actions` (buttons), and
 * can change what it says in place (`update`), e.g. "Saved" with Undo after a choice.
 */

import { html, setHtml } from '../utils/html.js';

const GAP = 14;
const MARGIN = 16;

let current = null;

export function isTipCardOpen() {
  return current !== null;
}

export function closeTipCard() {
  current?.close();
}

/**
 * @typedef {Object} TipContent
 * @property {string} title
 * @property {string} text
 * @property {string} [image] - a picture above the text
 * @property {Array<{label: string, help?: string, current?: boolean, onClick: Function}>} [choices]
 * @property {Array<{label: string, kind?: 'primary'|'secondary'|'quiet', href?: string, onClick?: Function}>} [actions]
 * @property {'row'|'stacked'} [actionsLayout] - stacked: the primary button across the card, the others under it
 */

/**
 * @param {TipContent & {
 *   id: string,
 *   target?: Element|null,
 *   placement?: 'auto'|'bottom-edge'|'corner',
 *   avoid?: string,
 *   onClose: (reason: 'close'|'escape'|'target'|'action'|'replaced') => void,
 * }} tip
 * @returns {{ close: Function, update: (content: TipContent) => void }}
 */
export function showTipCard(tip) {
  current?.close('replaced');

  const card = document.createElement('div');
  card.className = `guide-tip guide-tip-${tip.id}`;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-labelledby', 'guide-tip-title');
  card.setAttribute('aria-describedby', 'guide-tip-text');
  const closeLabel = chrome.i18n.getMessage('closeAlt') || 'Close';
  const currentLabel = chrome.i18n.getMessage('tipCurrentChoice') || 'Current';

  let content = tip;
  const render = () => {
    const actions = content.actions || [];
    const choices = content.choices || [];
    card.dataset.actions = content.actionsLayout || 'row';
    setHtml(card, html`
      <span class="guide-tip-arrow" aria-hidden="true"></span>
      ${content.image ? html`<img class="guide-tip-image" src="${content.image}" alt="">` : ''}
      <div class="guide-tip-head">
        <p class="guide-tip-title" id="guide-tip-title">${content.title}</p>
        <button type="button" class="guide-tip-close" aria-label="${closeLabel}">
          <img src="images/svg/close.svg" alt="" width="12" height="12">
        </button>
      </div>
      <p class="guide-tip-text" id="guide-tip-text">${content.text}</p>
      ${choices.length ? html`
      <div class="guide-tip-choices" role="group" aria-labelledby="guide-tip-text">
        ${choices.map((choice, i) => html`
        <button type="button" class="guide-choice ${choice.current ? 'current' : ''}" data-choice="${i}">
          <span class="guide-choice-text">
            <span class="guide-choice-name">${choice.label}</span>
            ${choice.help ? html`<span class="guide-choice-help">${choice.help}</span>` : ''}
          </span>
          ${choice.current ? html`<span class="guide-choice-current">${currentLabel}</span>` : ''}
        </button>`)}
      </div>` : ''}
      ${actions.length ? html`
      <div class="guide-tip-actions">
        ${actions.map((action, i) => action.href
          ? html`<a class="guide-btn ${action.kind || 'quiet'}" href="${action.href}" target="_blank" rel="noopener noreferrer" data-index="${i}">${action.label}</a>`
          : html`<button type="button" class="guide-btn ${action.kind || 'quiet'}" data-index="${i}">${action.label}</button>`)}
      </div>` : ''}
    `);
  };
  render();

  // Screen readers hear the tip once, without focus moving to it
  const announcer = document.createElement('div');
  announcer.className = 'guide-announcer';
  announcer.setAttribute('aria-live', 'polite');

  const target = tip.target || null;
  const placement = tip.placement || (target ? 'auto' : 'corner');
  card.dataset.placement = placement;

  let beacon = null;
  if (target) {
    beacon = document.createElement('span');
    beacon.className = 'guide-beacon';
    beacon.setAttribute('aria-hidden', 'true');
    const radius = getComputedStyle(target).borderRadius;
    beacon.style.borderRadius = radius && radius !== '0px' ? radius : '12px';
  }

  const position = () => {
    const arrow = card.querySelector('.guide-tip-arrow');
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    delete card.dataset.detached;
    if (placement === 'corner') return;
    // A card above its target is held by its bottom edge, so it grows upwards (an image loading)
    if (placement === 'bottom-edge') {
      card.style.left = `${Math.round((vw - width) / 2)}px`;
      card.style.top = 'auto';
      card.style.bottom = `${GAP + 6}px`;
      card.dataset.side = 'above';
      arrow.style.left = `${Math.round(width / 2)}px`;
      return;
    }
    const rect = target.getBoundingClientRect();
    if (beacon) {
      const pad = 6;
      Object.assign(beacon.style, {
        left: `${rect.left - pad}px`,
        top: `${rect.top - pad}px`,
        width: `${rect.width + pad * 2}px`,
        height: `${rect.height + pad * 2}px`,
      });
    }
    const above = rect.top + rect.height / 2 > vh / 2;
    const centre = rect.left + rect.width / 2;
    const left = Math.min(Math.max(centre - width / 2, MARGIN), vw - width - MARGIN);
    card.style.left = `${Math.round(left)}px`;
    if (above) {
      let bottom = vh - rect.top + GAP + 6;
      // Rise above what mustn't be covered (the bird's name over the heart)
      const avoid = tip.avoid ? document.querySelector(tip.avoid)?.getBoundingClientRect() : null;
      if (avoid && avoid.width && left < avoid.right && left + width > avoid.left && vh - bottom > avoid.top) {
        bottom = vh - avoid.top + GAP;
        card.dataset.detached = '';
      }
      card.style.top = 'auto';
      card.style.bottom = `${Math.round(Math.min(bottom, vh - height - MARGIN))}px`;
    } else {
      card.style.bottom = 'auto';
      card.style.top = `${Math.round(Math.min(rect.bottom + GAP + 6, vh - height - MARGIN))}px`;
    }
    card.dataset.side = above ? 'above' : 'below';
    // The arrow points at the target's centre, never past the card's rounded corners
    arrow.style.left = `${Math.round(Math.min(Math.max(centre - left, 22), width - 22))}px`;
  };

  let closed = false;
  const close = (reason = 'close') => {
    if (closed) return;
    closed = true;
    current = null;
    window.removeEventListener('resize', position);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('click', onDocumentClick, true);
    card.classList.add('leaving');
    beacon?.classList.add('leaving');
    setTimeout(() => {
      card.remove();
      beacon?.remove();
      announcer.remove();
    }, 260);
    tip.onClose(reason);
  };

  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    // Only when the tip has focus, or nothing does: Escape belongs to whatever else is open
    const active = document.activeElement;
    if (card.contains(active) || active === document.body || !active) {
      e.stopPropagation();
      close('escape');
    }
  };
  // Using the thing the tip points at answers it
  const onDocumentClick = (e) => {
    if (target && target.contains(e.target)) close('target');
  };

  card.addEventListener('click', (e) => {
    // The tip's clicks are its own, not the page's play/pause
    e.stopPropagation();
    if (e.target.closest('.guide-tip-close')) {
      close('close');
      return;
    }
    const choice = e.target.closest('[data-choice]');
    const button = e.target.closest('[data-index]');
    const chosen = choice ? content.choices[Number(choice.dataset.choice)] : button ? content.actions[Number(button.dataset.index)] : null;
    if (!chosen) return;
    // A handler that changed the card (update) keeps it open; any other answer closes it
    const before = content;
    chosen.onClick?.();
    if (content === before) close('action');
  });

  if (beacon) document.body.appendChild(beacon);
  document.body.append(card, announcer);
  position();
  card.querySelector('.guide-tip-image')?.addEventListener('load', position, { once: true });
  window.addEventListener('resize', position);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('click', onDocumentClick, true);
  requestAnimationFrame(() => {
    card.classList.add('visible');
    beacon?.classList.add('visible');
    announcer.textContent = `${tip.title}. ${tip.text}`;
  });

  const handle = {
    close,
    /** Say something else in the same card (after a choice: "Saved", Undo). */
    update(next) {
      const hadFocus = card.contains(document.activeElement);
      content = next;
      render();
      position();
      announcer.textContent = `${next.title}. ${next.text}`;
      // Keyboard users stay in the card
      if (hadFocus) card.querySelector('.guide-btn, .guide-choice')?.focus();
    },
  };
  current = handle;
  return handle;
}
