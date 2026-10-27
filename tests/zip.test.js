'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./harness');

const { Zip } = load(['js/zip.js']);

// A reader written from the spec, independent of js/zip.js: walks the central
// directory and checks each local entry, its CRC and, once inflated, its bytes.
async function readZip(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50, 'end of central directory');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out = {};
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50, 'central record');
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const stored = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const flags = view.getUint16(at + 8, true);
    const external = view.getUint32(at + 38, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    assert.equal(flags & 0x0800, 0x0800, 'names are flagged UTF-8');

    assert.equal(view.getUint32(local, true), 0x04034b50, 'local header for ' + name);
    const localName = view.getUint16(local + 26, true);
    const extra = view.getUint16(local + 28, true);
    const start = local + 30 + localName + extra;
    let data = bytes.subarray(start, start + stored);
    if (method === 8) {
      data = new Uint8Array(await new Response(new Blob([data]).stream()
        .pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    } else {
      assert.equal(method, 0);
    }
    assert.equal(data.length, size, 'size of ' + name);
    assert.equal(Zip.crc32(data), crc, 'crc of ' + name);
    out[name] = { text: new TextDecoder().decode(data), method, folder: !!(external & 0x10) };
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return out;
}

test('crc32 matches the standard check value', () => {
  assert.equal(Zip.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
});

test('a folder round-trips: paths, contents, subfolders and empty folders', async () => {
  const repetitive = 'all work and no play '.repeat(500);
  const blob = await Zip.build([
    { path: 'Trip/notes.txt', file: new Blob([repetitive]) },
    { path: 'Trip/photos/día 1.txt', file: new Blob(['ñ — unicode name']) },
    { path: 'Trip/empty', file: null },
    { path: 'Trip/zero.txt', file: new Blob([]) }
  ]);
  const files = await readZip(blob);
  assert.deepEqual(Object.keys(files).sort(),
    ['Trip/empty/', 'Trip/notes.txt', 'Trip/photos/día 1.txt', 'Trip/zero.txt']);
  assert.equal(files['Trip/notes.txt'].text, repetitive);
  assert.equal(files['Trip/notes.txt'].method, 8, 'text that shrinks is deflated');
  assert.equal(files['Trip/photos/día 1.txt'].text, 'ñ — unicode name');
  assert.equal(files['Trip/empty/'].folder, true);
  assert.equal(files['Trip/zero.txt'].text, '');
  assert.ok(blob.size < repetitive.length, 'the archive is smaller than its text');
});

test('data that does not shrink is stored as it is', async () => {
  const noise = new Uint8Array(4096);
  let seed = 7;
  for (let i = 0; i < noise.length; i++) { seed = (seed * 1103515245 + 12345) >>> 0; noise[i] = seed >>> 24; }
  const files = await readZip(await Zip.build([{ path: 'x/noise.bin', file: new Blob([noise]) }]));
  assert.equal(files['x/noise.bin'].method, 0);
});

test('paths cannot climb out of the folder', () => {
  assert.equal(Zip.cleanPath('/a/../b\\c/./d'), 'a/b/c/d');
});

test('progress runs to the end', async () => {
  const seen = [];
  await Zip.build([{ path: 'a/1', file: new Blob(['x']) }, { path: 'a/2', file: new Blob(['yy']) }],
    { onProgress: (fraction) => seen.push(fraction) });
  assert.equal(seen[seen.length - 1], 1);
});
