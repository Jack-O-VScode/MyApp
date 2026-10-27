/* Packing a folder into one .zip, in the browser, so it can travel as a single
   file and be opened back into the same folder on the other side — Windows,
   macOS and the iPhone's Files app all open a zip with a tap.

   Just enough of the format for that: no ZIP64 (a folder that needs it is far
   past anything the transfer bucket would take anyway), no encryption. Each
   file is deflated where the browser can and where it actually helps; photos
   and videos are already compressed and go in as they are.

   The output is a Blob assembled from parts, so a file stored as-is is never
   copied into memory a second time.
*/
window.Zip = (function () {
  'use strict';

  var MAX_ENTRIES = 65535;                 // without ZIP64
  var UTF8_NAMES = 0x0800;                 // general-purpose flag bit 11

  /* --------------------------------------------------------------- crc32 -- */

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crcUpdate(crc, bytes) {
    var c = crc ^ 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // Read a Blob a chunk at a time, so a big file is never held twice.
  function crcOf(blob) {
    if (!blob.size) return Promise.resolve(0);
    if (!blob.stream) {
      return blob.arrayBuffer().then(function (buffer) { return crcUpdate(0, new Uint8Array(buffer)); });
    }
    var reader = blob.stream().getReader();
    var crc = 0;
    function pump() {
      return reader.read().then(function (step) {
        if (step.done) return crc;
        crc = crcUpdate(crc, step.value);
        return pump();
      });
    }
    return pump();
  }

  /* ----------------------------------------------------------- compression -- */

  function canDeflate() {
    try {
      return typeof CompressionStream === 'function' && !!new CompressionStream('deflate-raw');
    } catch (err) {
      return false;
    }
  }

  // The deflated bytes, or null where that is not possible or not smaller.
  function deflate(blob) {
    if (!blob.size || !blob.stream || !canDeflate()) return Promise.resolve(null);
    return new Response(blob.stream().pipeThrough(new CompressionStream('deflate-raw')))
      .blob()
      .then(function (packed) { return packed.size < blob.size ? packed : null; })
      .catch(function () { return null; });
  }

  /* ----------------------------------------------------------------- bytes -- */

  function header(size) {
    var buffer = new ArrayBuffer(size);
    return { bytes: new Uint8Array(buffer), view: new DataView(buffer) };
  }

  // MS-DOS date and time, which is what zip keeps. It starts in 1980.
  function dosStamp(time) {
    var date = new Date(time || Date.now());
    if (date.getFullYear() < 1980) date = new Date(1980, 0, 1);
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
  }

  // A path inside the zip: forward slashes, nothing absolute, no "..".
  function cleanPath(path) {
    return String(path || '').replace(/\\/g, '/').split('/')
      .filter(function (part) { return part && part !== '.' && part !== '..'; })
      .join('/');
  }

  /* ---------------------------------------------------------------- build -- */

  // `entries`: [{ path: 'Photos/2024/a.jpg', file: Blob, lastModified }] —
  // a folder of its own is { path: 'Photos/empty/', file: null }.
  // Resolves to a Blob of the whole archive.
  function build(entries, options) {
    var onProgress = (options && options.onProgress) || function () {};
    var encoder = new TextEncoder();
    var list = (entries || []).map(function (entry) {
      var isFolder = !entry.file;
      var path = cleanPath(entry.path);
      return { path: isFolder ? path + '/' : path, file: entry.file, lastModified: entry.lastModified };
    }).filter(function (entry) { return entry.path && entry.path !== '/'; });

    if (list.length > MAX_ENTRIES) {
      return Promise.reject(new Error('That folder holds more than ' + MAX_ENTRIES +
        ' files and folders, which is more than a zip can list.'));
    }

    var total = list.reduce(function (sum, entry) { return sum + (entry.file ? entry.file.size : 0); }, 0);
    var done = 0;
    var parts = [];
    var central = [];
    var offset = 0;

    function add(index) {
      if (index >= list.length) return Promise.resolve();
      var entry = list[index];
      var file = entry.file;
      var name = encoder.encode(entry.path);
      var stamp = dosStamp(entry.lastModified || (file && file.lastModified));

      var work = file
        ? Promise.all([crcOf(file), deflate(file)])
        : Promise.resolve([0, null]);

      return work.then(function (results) {
        var crc = results[0];
        var packed = results[1];
        var method = packed ? 8 : 0;
        var body = packed || file;
        var size = file ? file.size : 0;
        var stored = body ? body.size : 0;

        var local = header(30);
        local.view.setUint32(0, 0x04034b50, true);
        local.view.setUint16(4, 20, true);
        local.view.setUint16(6, UTF8_NAMES, true);
        local.view.setUint16(8, method, true);
        local.view.setUint16(10, stamp.time, true);
        local.view.setUint16(12, stamp.date, true);
        local.view.setUint32(14, crc, true);
        local.view.setUint32(18, stored, true);
        local.view.setUint32(22, size, true);
        local.view.setUint16(26, name.length, true);
        local.view.setUint16(28, 0, true);

        var record = header(46);
        record.view.setUint32(0, 0x02014b50, true);
        record.view.setUint16(4, 20, true);
        record.view.setUint16(6, 20, true);
        record.view.setUint16(8, UTF8_NAMES, true);
        record.view.setUint16(10, method, true);
        record.view.setUint16(12, stamp.time, true);
        record.view.setUint16(14, stamp.date, true);
        record.view.setUint32(16, crc, true);
        record.view.setUint32(20, stored, true);
        record.view.setUint32(24, size, true);
        record.view.setUint16(28, name.length, true);
        // Extra field, comment, disk number and internal attributes stay 0.
        record.view.setUint32(38, file ? 0 : 0x10, true);   // MS-DOS "directory" bit
        record.view.setUint32(42, offset, true);

        parts.push(local.bytes, name);
        if (body) parts.push(body);
        central.push(record.bytes, name);
        offset += 30 + name.length + stored;

        done += size;
        onProgress(total ? done / total : (index + 1) / list.length);
        return add(index + 1);
      });
    }

    return add(0).then(function () {
      var directorySize = central.reduce(function (sum, part) { return sum + part.length; }, 0);
      var end = header(22);
      end.view.setUint32(0, 0x06054b50, true);
      end.view.setUint16(8, list.length, true);
      end.view.setUint16(10, list.length, true);
      end.view.setUint32(12, directorySize, true);
      end.view.setUint32(16, offset, true);
      return new Blob(parts.concat(central, [end.bytes]), { type: 'application/zip' });
    });
  }

  return { build: build, crc32: function (bytes) { return crcUpdate(0, bytes); }, cleanPath: cleanPath };
})();
