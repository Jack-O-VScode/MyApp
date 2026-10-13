'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./harness');

const { Markdown } = load(['js/markdown.js']);

test('HTML in a note is shown as text, never run', () => {
  const html = Markdown.render('<img src=x onerror=alert(1)> <script>alert(1)</script>');
  assert.ok(!html.includes('<img'), html);
  assert.ok(!html.includes('<script'), html);
  assert.ok(html.includes('&lt;script&gt;'), html);
});

test('only http(s) and mailto become links', () => {
  assert.ok(Markdown.render('[site](https://example.com)').includes('<a href="https://example.com"'));
  assert.ok(Markdown.render('[mail](mailto:a@b.c)').includes('href="mailto:a@b.c"'));
  const evil = Markdown.render('[click](javascript:alert(1))');
  assert.ok(!evil.includes('<a'), evil);
});

test('a link cannot break out of its attribute', () => {
  const html = Markdown.render('[x](https://a.com/"onmouseover="alert(1))');
  assert.ok(!/href="[^"]*"onmouseover/.test(html), html);
});

test('headings, emphasis, lists and code', () => {
  assert.equal(Markdown.render('# Title'), '<h2>Title</h2>');
  assert.equal(Markdown.render('**bold** and *it*'), '<p><strong>bold</strong> and <em>it</em></p>');
  assert.equal(Markdown.render('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(Markdown.render('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
  assert.equal(Markdown.render('`a*b*c`'), '<p><code>a*b*c</code></p>');
  assert.equal(Markdown.render('```\n<b>\n```'), '<pre><code>&lt;b&gt;</code></pre>');
});

test('snake_case words are not italicised', () => {
  assert.equal(Markdown.render('my_var_name'), '<p>my_var_name</p>');
});

test('checklists carry their line, and ticking flips only that line', () => {
  const source = 'Shopping\n- [ ] milk\n- [x] eggs';
  const html = Markdown.render(source);
  assert.ok(html.includes('data-line="1"'));
  assert.ok(html.includes('data-line="2" checked'));
  assert.equal(Markdown.toggleLine(source, 1), 'Shopping\n- [x] milk\n- [x] eggs');
  assert.equal(Markdown.toggleLine(source, 2), 'Shopping\n- [ ] milk\n- [ ] eggs');
  assert.equal(Markdown.toggleLine(source, 0), source);
});

test('attached pictures become placeholders the editor fills in', () => {
  const html = Markdown.render('![cat](att:note1/123-cat.jpg)');
  assert.ok(html.includes('data-att="note1/123-cat.jpg"'), html);
  assert.ok(!html.includes('<img'), html);
});

test('plain text previews drop the punctuation', () => {
  assert.equal(Markdown.plain('# Plan\n**Do** the [thing](https://x.y)\n- [ ] one'),
    'Plan\nDo the thing\n☐ one');
});
