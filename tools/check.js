#!/usr/bin/env node
/* Parses every script the app ships, without running it, so a stray bracket
 * fails here instead of as a blank screen on someone's phone. Also refuses a
 * build without patch notes.
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

// Every build has patch notes. The popup after an update shows the releases
// newer than the one a device last saw, so a build that ships without its own
// entry would update silently — and its changes would never be announced.
const build = Number((/var CACHE = 'calendar-notes-v(\d+)'/.exec(sw) || [])[1]);
const sandbox = { window: {} };
require('vm').runInNewContext(fs.readFileSync(path.join(ROOT, 'js/changelog.js'), 'utf8'), sandbox);
const releases = sandbox.window.CHANGELOG || [];
const versions = releases.map((release) => release.version);
if (!build) {
  failed++;
  process.stderr.write('Could not read the build number from CACHE in sw.js\n');
} else if (versions[0] !== build) {
  failed++;
  process.stderr.write('sw.js is build ' + build + ' but the newest patch notes in js/changelog.js are for ' +
    versions[0] + '. Add an entry for version ' + build + ' at the top of CHANGELOG.\n');
}
versions.forEach((version, index) => {
  if (index && version >= versions[index - 1]) {
    failed++;
    process.stderr.write('js/changelog.js must be newest first, each version once (look at ' + version + ')\n');
  }
});
releases.forEach((release) => {
  if (!release.title || !release.date || !(release.changes || []).length) {
    failed++;
    process.stderr.write('Patch notes for version ' + release.version + ' need a title, a date and at least one change\n');
  }
});

console.log(failed ? failed + ' problem(s)' : 'Checked ' + files.length + ' scripts: all parse, all cached, build ' + build + ' has patch notes.');
process.exit(failed ? 1 : 0);
