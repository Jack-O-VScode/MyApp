/* Reading a folder the person picked or dropped, for both halves of the
   Transfer screen. What comes out is { name, entries: [{ path, file }] },
   ready for Zip.build — a folder of its own has file: null, so even an empty
   one arrives as the same shape that was sent. */
window.Folders = (function () {
  'use strict';

  // From the folder picker: every file knows its path from the folder down.
  function fromPicked(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return null;
    var root = String(files[0].webkitRelativePath || files[0].name).split('/')[0] || 'Folder';
    return {
      name: root,
      entries: files.map(function (file) {
        return {
          path: file.webkitRelativePath || (root + '/' + file.name),
          file: file,
          lastModified: file.lastModified
        };
      })
    };
  }

  // A directory reader hands entries over in batches; ask until it runs dry.
  function readAll(reader) {
    var all = [];
    return new Promise(function (resolve, reject) {
      (function next() {
        reader.readEntries(function (batch) {
          if (!batch.length) return resolve(all);
          all = all.concat(Array.prototype.slice.call(batch));
          next();
        }, reject);
      })();
    });
  }

  function fileOf(entry) {
    return new Promise(function (resolve, reject) { entry.file(resolve, reject); });
  }

  // Everything under a dropped folder, subfolders included.
  function walk(entry) {
    var path = entry.fullPath.replace(/^\/+/, '');
    if (entry.isFile) {
      return fileOf(entry).then(function (file) {
        return [{ path: path, file: file, lastModified: file.lastModified }];
      });
    }
    return readAll(entry.createReader()).then(function (children) {
      if (!children.length) return [{ path: path, file: null }];
      return Promise.all(children.map(walk)).then(function (nested) {
        return [].concat.apply([], nested);
      });
    });
  }

  // iPhone and iPad have no way to pick a folder from a web page.
  function canPick() {
    var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return !ios && 'webkitdirectory' in document.createElement('input');
  }

  function fileCount(folder) {
    return folder.entries.filter(function (entry) { return entry.file; }).length;
  }

  function rawSize(folder) {
    return folder.entries.reduce(function (sum, entry) { return sum + (entry.file ? entry.file.size : 0); }, 0);
  }

  return {
    fromPicked: fromPicked,
    walk: walk,
    fileOf: fileOf,
    canPick: canPick,
    fileCount: fileCount,
    rawSize: rawSize
  };
})();
