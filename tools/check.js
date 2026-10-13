#!/usr/bin/env node
/* Parses every script the app ships, without running it, so a stray bracket
 * fails here instead of as a blank screen on someone's phone.
 *   node tools/check.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const files = fs.readdirSync(path.join(ROOT, 'js'))
  .filter((name) => name.endsWith('.js'))
  .map((name) => path.join('js', name))
  .concat(['sw.js']);

let failed = 0;
files.forEach((file) => {
  try {
    execFileSync(process.execPath, ['--check', path.join(ROOT, file)], { stdio: 'pipe' });
  } catch (err) {
    failed++;
    process.stderr.write(String(err.stderr || err.message));
  }
});

// Every script the page loads must also be in the offline shell, or the app
// breaks the first time it opens without a connection.
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const loaded = Array.from(html.matchAll(/<script src="([^"]+)"/g), (match) => match[1]);
loaded.forEach((src) => {
  if (!sw.includes("'" + src + "'")) {
    failed++;
    process.stderr.write(src + ' is loaded by index.html but missing from the cache list in sw.js\n');
  }
});

console.log(failed ? failed + ' problem(s)' : 'Checked ' + files.length + ' scripts: all parse, all cached.');
process.exit(failed ? 1 : 0);
