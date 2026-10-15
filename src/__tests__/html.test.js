/**
 * utils/html.js: values in html`` are escaped, nested html`` and
 * trustedHtml() aren't, and setHtml/insertHtml never treat a plain string as markup.
 */

const { html, trustedHtml, setHtml, insertHtml } = require('../utils/html.js');

describe('html templates', () => {
  let el;

  beforeEach(() => {
    document.body.innerHTML = '<div id="target"></div>';
    el = document.getElementById('target');
  });

  test('escapes interpolated text, including in attributes', () => {
    const name = '<img src=x onerror=alert(1)> & "quotes"';
    setHtml(el, html`<p title="${name}">${name}</p>`);
    const p = el.querySelector('p');
    expect(p.textContent).toBe(name);
    expect(p.getAttribute('title')).toBe(name);
    expect(el.querySelector('img')).toBeNull();
  });

  test('keeps nested html and trusted markup', () => {
    const icon = trustedHtml('<svg class="icon"></svg>');
    setHtml(el, html`<div>${icon}${html`<span class="inner">${'a<b'}</span>`}</div>`);
    expect(el.querySelector('svg.icon')).not.toBeNull();
    expect(el.querySelector('span.inner').textContent).toBe('a<b');
  });

  test('joins arrays and skips empty values', () => {
    const items = ['one', '<two>'].map((t) => html`<li>${t}</li>`);
    setHtml(el, html`<ul>${items}${false}${null}${undefined}</ul>`);
    expect([...el.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['one', '<two>']);
  });

  test('setHtml accepts an array of fragments', () => {
    setHtml(el, [html`<b>1</b>`, html`<b>2</b>`]);
    expect(el.querySelectorAll('b')).toHaveLength(2);
  });

  test('setHtml inserts a plain string as text', () => {
    setHtml(el, '<b>not bold</b>');
    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toBe('<b>not bold</b>');
  });

  test('setHtml replaces existing children', () => {
    el.textContent = 'old';
    setHtml(el, html`<i>new</i>`);
    expect(el.innerHTML).toBe('<i>new</i>');
  });

  test('insertHtml inserts at each position', () => {
    el.textContent = 'x';
    insertHtml(el, 'afterbegin', html`<i>a</i>`);
    insertHtml(el, 'beforeend', html`<i>b</i>`);
    insertHtml(el, 'beforebegin', html`<i id="before"></i>`);
    insertHtml(el, 'afterend', html`<i id="after"></i>`);
    expect(el.innerHTML).toBe('<i>a</i>x<i>b</i>');
    expect(el.previousElementSibling.id).toBe('before');
    expect(el.nextElementSibling.id).toBe('after');
  });
});
