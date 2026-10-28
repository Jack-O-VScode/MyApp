'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./harness');

const { Zip, Folders } = load(['js/zip.js', 'js/folders.js']);

function get64(view, at) {
  return view.getUint32(at, true) + view.getUint32(at + 4, true) * 0x100000000;
}

// The ZIP64 extra field (id 1) fills in, in order, whichever of size,
// compressed size and offset are 0xFFFFFFFF in the header it belongs to.
function widen(view, start, length, fields) {
  for (let at = start; at < start + length;) {
    const id = view.getUint16(at, true);
    const size = view.getUint16(at + 2, true);
    if (id === 1) {
      let read = at + 4;
      for (const key of ['size', 'stored', 'offset']) {
        if (key in fields && fields[key] === 0xFFFFFFFF) { fields[key] = get64(view, read); read += 8; }
      }
      fields.zip64 = true;
    }
    at += 4 + size;
  }
  return fields;
}

// A reader written from the spec, independent of js/zip.js: walks the central
// directory and checks each local entry, its CRC and, once inflated, its bytes.
async function readZip(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50, 'end of central directory');
  let count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out = {};
  // A ZIP64 locator sits just before the classic end record.
  const locator = end - 20;
  if (locator >= 0 && view.getUint32(locator, true) === 0x07064b50) {
    const record = get64(view, locator + 8);
    assert.equal(view.getUint32(record, true), 0x06064b50, 'ZIP64 end record');
    count = get64(view, record + 32);
    at = get64(view, record + 48);
    out['(zip64)'] = true;
  }
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50, 'central record');
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const flags = view.getUint16(at + 8, true);
    const external = view.getUint32(at + 38, true);
    const { stored, size, offset: local } = widen(view, at + 46 + nameLength, extraLength, {
      size: view.getUint32(at + 24, true),
      stored: view.getUint32(at + 20, true),
      offset: view.getUint32(at + 42, true)
    });
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

test('the ZIP64 layout reads back the same, for folders past 4 GB', async () => {
  const text = 'big folder line\n'.repeat(300);
  const blob = await Zip.build([
    { path: 'Big/a.txt', file: new Blob([text]) },
    { path: 'Big/sub', file: null },
    { path: 'Big/b.bin', file: new Blob([new Uint8Array([1, 2, 3])]) }
  ], { zip64: true });
  const files = await readZip(blob);
  assert.equal(files['(zip64)'], true);
  assert.equal(files['Big/a.txt'].text, text);
  assert.equal(files['Big/sub/'].folder, true);
  assert.equal(files['Big/b.bin'].text.length, 3);
});

test('photos, videos and archives are not recompressed', async () => {
  const compressible = 'a'.repeat(10000);
  const files = await readZip(await Zip.build([
    { path: 'p/IMG_1.JPG', file: new Blob([compressible]) },
    { path: 'p/clip.mov', file: new Blob([compressible]) },
    { path: 'p/notes.txt', file: new Blob([compressible]) }
  ]));
  assert.equal(files['p/IMG_1.JPG'].method, 0);
  assert.equal(files['p/clip.mov'].method, 0);
  assert.equal(files['p/notes.txt'].method, 8);
});

test('a picked folder keeps every file under its own name', () => {
  const picked = [
    { name: 'a.txt', webkitRelativePath: 'Trip/a.txt', lastModified: 1, size: 3 },
    { name: 'b.jpg', webkitRelativePath: 'Trip/pics/b.jpg', lastModified: 2, size: 5 }
  ];
  const folder = Folders.fromPicked(picked);
  assert.equal(folder.name, 'Trip');
  assert.deepEqual(plain(folder.entries.map((entry) => entry.path)), ['Trip/a.txt', 'Trip/pics/b.jpg']);
  assert.equal(Folders.fileCount(folder), 2);
  assert.equal(Folders.rawSize(folder), 8);
  assert.equal(Folders.fromPicked([]), null);
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
