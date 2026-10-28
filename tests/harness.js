/* Loads the app's browser scripts into a fresh sandbox, so the tests run the
   real files with nothing but Node — no bundler, no browser, no dependencies.

   Each call gets its own sandbox and its own empty localStorage, so one test's
   events never leak into the next. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function memoryStorage(seed) {
  const data = new Map(Object.entries(seed || {}));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    dump: () => Object.fromEntries(data)
  };
}

// Just enough of a document for scripts that wire listeners at load time.
function stubDocument() {
  return {
    addEventListener() {},
    removeEventListener() {},
    createElement() { return { getContext: () => null, style: {} }; },
    body: { classList: { add() {}, remove() {} } }
  };
}

function load(files, options) {
  const opts = options || {};
  const sandbox = {
    console,
    Intl,
    URL,
    Blob,
    File,
    Response,
    TextEncoder,
    TextDecoder,
    CompressionStream,
    DecompressionStream,
    crypto: globalThis.crypto,
    btoa,
    atob,
    setTimeout,
    clearTimeout,
    localStorage: memoryStorage(opts.storage),
    document: stubDocument(),
    navigator: { userAgent: 'node' },
    location: { origin: 'http://localhost', hash: '' },
    addEventListener() {},
    removeEventListener() {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  files.forEach((file) => {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    vm.runInContext(source, sandbox, { filename: file });
  });
  return sandbox;
}

// Values made inside the sandbox have the sandbox's own Array and Object, which
// strict deep-equality treats as different types. Compare them as data.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = { load, plain };
