/* Packing a folder into one .zip, in the browser, so it can travel as a single
   file and be opened back into the same folder on the other side — Windows,
   macOS and the iPhone's Files app all open a zip with a tap.

   Just enough of the format for that, no encryption. ZIP64 is used only when
   the archive needs it — past 4 GB, or past 65,535 entries — since sending to
   a device has no size limit, and a folder of phone videos gets there easily.
   Each file is deflated where the browser can and where it actually helps;
   photos, videos and archives are already compressed and go in as they are,
   without spending time finding that out.

   The output is a Blob assembled from parts, so a file stored as-is is never
   copied into memory a second time.
*/
window.Zip = (function () {
  'use strict';

  var UTF8_NAMES = 0x0800;                 // general-purpose flag bit 11
  var LIMIT32 = 0xFFFFFFFF;                // a field this full means "see ZIP64"
  var LIMIT16 = 0xFFFF;

  // Formats that are compressed already. Deflating them again saves nothing
  // and, for a video, takes as long as reading the whole thing twice.
  var PACKED = /\.(jpe?g|png|gif|webp|heic|heif|avif|mp4|m4v|mov|mkv|webm|avi|3gp|mp3|m4a|aac|ogg|opus|flac|zip|gz|tgz|bz2|xz|7z|rar|dmg|iso|apk|ipa|docx|xlsx|pptx|pages|numbers|key|pdf)$/i;

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
  function deflate(blob, path) {
    if (!blob.size || !blob.stream || PACKED.test(path) || !canDeflate()) return Promise.resolve(null);
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

  // 64-bit little-endian, written as two halves: setBigUint64 is too new for
  // the older iPhones this still has to run on.
  function set64(view, at, value) {
    view.setUint32(at, value % 0x100000000, true);
    view.setUint32(at + 4, Math.floor(value / 0x100000000), true);
  }

  // The ZIP64 "extra field" carrying full-width sizes (and the offset, in the
  // central directory).
  function zip64Extra(values) {
    var extra = header(4 + values.length * 8);
    extra.view.setUint16(0, 0x0001, true);
    extra.view.setUint16(2, values.length * 8, true);
    values.forEach(function (value, index) { set64(extra.view, 4 + index * 8, value); });
    return extra.bytes;
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
  // `options.zip64` forces the ZIP64 layout on a small archive, for testing.
  function build(entries, options) {
    var onProgress = (options && options.onProgress) || function () {};
    var force64 = !!(options && options.zip64);
    var encoder = new TextEncoder();
    var list = (entries || []).map(function (entry) {
      var isFolder = !entry.file;
      var path = cleanPath(entry.path);
      return { path: isFolder ? path + '/' : path, file: entry.file, lastModified: entry.lastModified };
    }).filter(function (entry) { return entry.path && entry.path !== '/'; });

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
        ? Promise.all([crcOf(file), deflate(file, entry.path)])
        : Promise.resolve([0, null]);

      return work.then(function (results) {
        var crc = results[0];
        var packed = results[1];
        var method = packed ? 8 : 0;
        var body = packed || file;
        var size = file ? file.size : 0;
        var stored = body ? body.size : 0;
        // Sizes that do not fit 32 bits live in the local header's ZIP64
        // field; an offset that does not fit only matters to the directory.
        var big = force64 || size >= LIMIT32 || stored >= LIMIT32;
        var far = force64 || big || offset >= LIMIT32;
        var version = far ? 45 : 20;
        var localExtra = big ? zip64Extra([size, stored]) : new Uint8Array(0);
        var centralExtra = far ? zip64Extra([size, stored, offset]) : new Uint8Array(0);

        var local = header(30);
        local.view.setUint32(0, 0x04034b50, true);
        local.view.setUint16(4, version, true);
        local.view.setUint16(6, UTF8_NAMES, true);
        local.view.setUint16(8, method, true);
        local.view.setUint16(10, stamp.time, true);
        local.view.setUint16(12, stamp.date, true);
        local.view.setUint32(14, crc, true);
        local.view.setUint32(18, big ? LIMIT32 : stored, true);
        local.view.setUint32(22, big ? LIMIT32 : size, true);
        local.view.setUint16(26, name.length, true);
        local.view.setUint16(28, localExtra.length, true);

        var record = header(46);
        record.view.setUint32(0, 0x02014b50, true);
        record.view.setUint16(4, version, true);
        record.view.setUint16(6, version, true);
        record.view.setUint16(8, UTF8_NAMES, true);
        record.view.setUint16(10, method, true);
        record.view.setUint16(12, stamp.time, true);
        record.view.setUint16(14, stamp.date, true);
        record.view.setUint32(16, crc, true);
        record.view.setUint32(20, far ? LIMIT32 : stored, true);
        record.view.setUint32(24, far ? LIMIT32 : size, true);
        record.view.setUint16(28, name.length, true);
        record.view.setUint16(30, centralExtra.length, true);
        // Comment, disk number and internal attributes stay 0.
        record.view.setUint32(38, file ? 0 : 0x10, true);   // MS-DOS "directory" bit
        record.view.setUint32(42, far ? LIMIT32 : offset, true);

        parts.push(local.bytes, name, localExtra);
        if (body) parts.push(body);
        central.push(record.bytes, name, centralExtra);
        offset += 30 + name.length + localExtra.length + stored;

        done += size;
        onProgress(total ? done / total : (index + 1) / list.length);
        return add(index + 1);
      });
    }

    return add(0).then(function () {
      var directorySize = central.reduce(function (sum, part) { return sum + part.length; }, 0);
      var tail = [];
      var huge = force64 || list.length >= LIMIT16 || offset >= LIMIT32 || directorySize >= LIMIT32;

      if (huge) {
        // ZIP64 end of central directory, then the locator that points to it.
        var record = header(56);
        record.view.setUint32(0, 0x06064b50, true);
        set64(record.view, 4, 44);
        record.view.setUint16(12, 45, true);
        record.view.setUint16(14, 45, true);
        set64(record.view, 24, list.length);
        set64(record.view, 32, list.length);
        set64(record.view, 40, directorySize);
        set64(record.view, 48, offset);
        var locator = header(20);
        locator.view.setUint32(0, 0x07064b50, true);
        set64(locator.view, 8, offset + directorySize);
        locator.view.setUint32(16, 1, true);
        tail.push(record.bytes, locator.bytes);
      }

      var end = header(22);
      end.view.setUint32(0, 0x06054b50, true);
      // Each field says "see ZIP64" only where it has actually run out.
      end.view.setUint16(8, Math.min(list.length, LIMIT16), true);
      end.view.setUint16(10, Math.min(list.length, LIMIT16), true);
      end.view.setUint32(12, Math.min(directorySize, LIMIT32), true);
      end.view.setUint32(16, Math.min(offset, LIMIT32), true);
      tail.push(end.bytes);
      return new Blob(parts.concat(central, tail), { type: 'application/zip' });
    });
  }

  return { build: build, crc32: function (bytes) { return crcUpdate(0, bytes); }, cleanPath: cleanPath };
})();
