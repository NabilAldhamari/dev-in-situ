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
