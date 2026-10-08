import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPrompt, compactHtml } from '../src/prompt.js';

test('compactHtml removes noise and truncates', () => {
  assert.equal(compactHtml('<div>\n  <!-- c -->\n  <b>  x </b>\n</div>'), '<div><b> x </b></div>');
  assert.equal(compactHtml('<img src="data:image/png;base64,AAAAAAAA">'), '<img src="data:image/png…">');
  assert.equal(compactHtml('<p>abcdef</p>', 4), '<p>a…');
});

test('buildPrompt is short and complete', () => {
  const prompt = buildPrompt({
    url: 'http://localhost:3000/',
    selector: '#cta',
    html: '<button id="cta">Buy</button>',
    instruction: ' make it green ',
    component: { name: 'Hero', file: 'src/Hero.tsx', line: 12 },
    stack: ['React', 'Vite'],
  });
  assert.equal(
    prompt,
    'Change the element `#cta` on http://localhost:3000/.\nComponent: Hero (src/Hero.tsx:12)\nStack: React, Vite\n```html\n<button id="cta">Buy</button>\n```\nTask: make it green',
  );
});

test('buildPrompt lists every element of a multi-selection', () => {
  const prompt = buildPrompt({
    url: 'http://localhost:3000/',
    selector: '#a',
    html: '<a id="a">A</a>',
    instruction: 'align these',
    stack: ['Vue'],
    targets: [
      { selector: '#a', html: '<a id="a">A</a>', component: { name: 'Nav', file: 'src/Nav.vue', line: 3 } },
      { selector: '.b', html: '<p class="b">\n  B\n</p>', component: null },
    ],
  });
  assert.equal(
    prompt,
    [
      'Change these 2 elements on http://localhost:3000/.',
      'Stack: Vue',
      '1. `#a` (component: Nav (src/Nav.vue:3))',
      '```html',
      '<a id="a">A</a>',
      '```',
      '2. `.b`',
      '```html',
      '<p class="b"> B </p>',
      '```',
      'Task: align these',
    ].join('\n'),
  );
});

test('buildPrompt with a single listed target matches the single-element format', () => {
  const base = { url: 'http://x/', selector: '#a', html: '<i id="a"></i>', instruction: 'go' };
  assert.equal(buildPrompt({ ...base, targets: [{ selector: '#a', html: '<i id="a"></i>' }] }), buildPrompt(base));
});
