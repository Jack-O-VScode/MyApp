/* Pictures attached to notes.

   They live in the same private `transfers` bucket as everything else, under

       <user id>/notes/<note id>/<timestamp>-<name>

   which the existing storage policy already confines to their owner. The note
   itself only holds `![name](att:<note id>/<timestamp>-<name>)` — no user id,
   so the same text works on every device signed in to the same account.

   A fetched picture is kept in Cache Storage, so a note opened on the train
   still shows what was attached to it.
*/
window.Attachments = (function () {
  'use strict';

  var BUCKET = 'transfers';
  var CACHE = 'note-attachments';
  var MAX_SIDE = 2048;
  var SHRINK_OVER = 1.5 * 1024 * 1024;

  var urls = {};        // ref -> object URL, for this session

  function available() {
    return !!(window.Sync && Sync.getStatus().signedIn);
  }

  function encodeKey(key) {
    return key.split('/').map(encodeURIComponent).join('/');
  }

  function safeName(name) {
    return String(name || 'image').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-60) || 'image';
  }

  function fullKey(auth, ref) {
    return auth.userId + '/notes/' + ref;
  }

  function cacheRequest(ref) {
    return new Request(location.origin + '/__attachment/' + encodeURIComponent(ref));
  }

  /* ------------------------------------------------------------ shrinking -- */

  // Phone photos are far bigger than a note needs. Anything large is redrawn
  // at no more than 2048px on its long side; if that fails, or does not help,
  // the original goes up unchanged.
  function shrink(file) {
    if (file.size < SHRINK_OVER || !/^image\/(jpeg|png|webp)$/i.test(file.type) ||
        typeof createImageBitmap !== 'function') {
      return Promise.resolve(file);
    }
    return createImageBitmap(file).then(function (bitmap) {
      var scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) {
          resolve(blob && blob.size < file.size ? blob : file);
        }, 'image/jpeg', 0.85);
      });
    }).catch(function () { return file; });
  }

  /* ------------------------------------------------------------ transport -- */

  // Resolves to the reference to write into the note.
  function upload(noteId, file) {
    if (!available()) return Promise.reject(new Error('Turn on sync to attach pictures.'));
    return shrink(file).then(function (blob) {
      return Sync.authorized().then(function (auth) {
        var name = safeName(file.name);
        if (blob !== file) name = name.replace(/\.[^.]*$/, '') + '.jpg';
        var ref = noteId + '/' + Date.now() + '-' + name;
        var form = new FormData();
        form.append('cacheControl', '3600');
        form.append('', blob, name);
        return fetch(auth.url + '/storage/v1/object/' + BUCKET + '/' + encodeKey(fullKey(auth, ref)), {
          method: 'POST',
          headers: Object.assign({ 'x-upsert': 'true' }, auth.headers),
          body: form
        }).then(function (response) {
          if (!response.ok) {
            return response.text().then(function (text) {
              throw new Error(/bucket not found/i.test(text)
                ? 'No “transfers” bucket yet — run the setup SQL from the README.'
                : (text || 'Upload failed'));
            });
          }
          remember(ref, blob);
          return ref;
        });
      });
    });
  }

  function remember(ref, blob) {
    urls[ref] = URL.createObjectURL(blob);
    if (!window.caches) return;
    caches.open(CACHE).then(function (cache) {
      return cache.put(cacheRequest(ref), new Response(blob));
    }).catch(function () {});
  }

  // An object URL for an attached picture: from this session, then from the
  // on-device cache, and only then from the project.
  function url(ref) {
    if (urls[ref]) return Promise.resolve(urls[ref]);
    var cached = window.caches
      ? caches.open(CACHE).then(function (cache) { return cache.match(cacheRequest(ref)); })
        .catch(function () { return null; })
      : Promise.resolve(null);

    return cached.then(function (hit) {
      if (hit) return hit.blob().then(function (blob) {
        urls[ref] = URL.createObjectURL(blob);
        return urls[ref];
      });
      if (!available()) throw new Error('Sign in to sync to see this picture.');
      return Sync.authorized().then(function (auth) {
        return fetch(auth.url + '/storage/v1/object/' + BUCKET + '/' + encodeKey(fullKey(auth, ref)), {
          headers: auth.headers
        });
      }).then(function (response) {
        if (!response.ok) throw new Error('This picture is no longer there.');
        return response.blob();
      }).then(function (blob) {
        remember(ref, blob);
        return urls[ref];
      });
    });
  }

  // Everything attached to a note, gone with the note. Best effort: a note
  // deleted offline leaves its pictures behind rather than failing to delete.
  function removeAll(noteId) {
    if (!available() || !noteId) return Promise.resolve();
    return Sync.authorized().then(function (auth) {
      var prefix = auth.userId + '/notes/' + noteId;
      return fetch(auth.url + '/storage/v1/object/list/' + BUCKET, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, auth.headers),
        body: JSON.stringify({ prefix: prefix, limit: 1000 })
      }).then(function (response) {
        return response.ok ? response.json() : [];
      }).then(function (rows) {
        var keys = (rows || []).filter(function (row) { return row && row.id; })
          .map(function (row) { return prefix + '/' + row.name; });
        if (!keys.length) return null;
        return fetch(auth.url + '/storage/v1/object/' + BUCKET, {
          method: 'DELETE',
          headers: Object.assign({ 'Content-Type': 'application/json' }, auth.headers),
          body: JSON.stringify({ prefixes: keys })
        });
      });
    }).catch(function () {});
  }

  return { available: available, upload: upload, url: url, removeAll: removeAll };
})();
