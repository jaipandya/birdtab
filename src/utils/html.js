/**
 * Safe HTML templating: build DOM from markup without innerHTML.
 *
 *   setHtml(el, html`<p class="name">${bird.name}</p>${trustedHtml(ICON_SVG)}`);
 *
 * Every value interpolated into html`` is escaped, unless it is itself an
 * html`` result or wrapped in trustedHtml() (markup we wrote ourselves, such
 * as icon SVG constants). Arrays are joined, each item treated the same way,
 * so build lists with .map() and no .join(''): joining makes a plain string,
 * which is then escaped.
 * So data from the media release, storage or the network can never become
 * markup, and Firefox add-on review has no innerHTML assignments to flag.
 */

import { escapeHtml } from './escapeHtml.js';

class SafeHtml {
  constructor(markup) {
    this.markup = markup;
  }

  toString() {
    return this.markup;
  }
}

function render(value) {
  if (value instanceof SafeHtml) return value.markup;
  if (Array.isArray(value)) return value.map(render).join('');
  if (value === false || value === null || value === undefined) return '';
  return escapeHtml(value);
}

/** Tagged template: escapes interpolated values, returns SafeHtml. */
export function html(strings, ...values) {
  let markup = strings[0];
  values.forEach((value, i) => {
    markup += render(value) + strings[i + 1];
  });
  return new SafeHtml(markup);
}

/** Marks markup we wrote ourselves (icons, fixed snippets) as safe to insert. */
export function trustedHtml(markup) {
  return new SafeHtml(markup == null ? '' : String(markup));
}

/** The nodes of a SafeHtml (or an array of them), parsed in an inert document (nothing runs or loads). */
function toNodes(content) {
  if (Array.isArray(content)) {
    content = new SafeHtml(render(content));
  }
  if (!(content instanceof SafeHtml)) {
    return [document.createTextNode(content == null ? '' : String(content))];
  }
  const doc = new DOMParser().parseFromString(`<body>${content.markup}</body>`, 'text/html');
  return [...doc.body.childNodes].map((node) => document.adoptNode(node));
}

/** Replaces el's children. A plain string is inserted as text, never as markup. */
export function setHtml(el, content) {
  el.replaceChildren(...toNodes(content));
}

/** Like insertAdjacentHTML: position is 'beforebegin', 'afterbegin', 'beforeend' or 'afterend'. */
export function insertHtml(el, position, content) {
  const nodes = toNodes(content);
  switch (position) {
    case 'beforebegin': el.before(...nodes); break;
    case 'afterbegin': el.prepend(...nodes); break;
    case 'beforeend': el.append(...nodes); break;
    case 'afterend': el.after(...nodes); break;
    default: throw new Error(`Unknown position: ${position}`);
  }
}
