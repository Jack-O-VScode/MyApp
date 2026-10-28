/* Locking a note behind a password.

   This is encryption, not hiding. The note's text is sealed with AES-256-GCM
   under a key made from the password by PBKDF2 (SHA-256, 600,000 rounds), and
   only the sealed form is ever stored — in this device's storage, in sync, and
   in backups. The password itself is never kept anywhere, which is the point
   and also the catch: forget it and the text is gone for good.

   The note's id is bound into each seal, so a sealed body copied into another
   note will not open there.

   Stored on the note as:
     locked: { v: 1, iter, salt, iv, data, hint }   (base64 strings, hint as typed)
*/
window.NoteLock = (function () {
  'use strict';

  var api = {
    ITERATIONS: 600000,          // the tests turn this down to stay quick
    supported: supported,
    seal: seal,
    reseal: reseal,
    open: open,
    isLocked: isLocked,
    clean: clean
  };

  function supported() {
    return !!(window.crypto && window.crypto.subtle && window.TextEncoder);
  }

  /* --------------------------------------------------------------- base64 -- */

  function toBase64(bytes) {
    var view = new Uint8Array(bytes);
    var text = '';
    for (var i = 0; i < view.length; i += 0x8000) {
      text += String.fromCharCode.apply(null, view.subarray(i, i + 0x8000));
    }
    return btoa(text);
  }

  function fromBase64(text) {
    var raw = atob(text);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function encode(text) {
    return new TextEncoder().encode(String(text));
  }

  function random(length) {
    return crypto.getRandomValues(new Uint8Array(length));
  }

  /* ------------------------------------------------------------------ keys -- */

  function derive(password, salt, iterations) {
    return crypto.subtle.importKey('raw', encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
          base,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
      });
  }

  function encrypt(key, text, noteId) {
    var iv = random(12);
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: encode(noteId) }, key, encode(text))
      .then(function (data) { return { iv: toBase64(iv), data: toBase64(data) }; });
  }

  /* ------------------------------------------------------------------- api -- */

  // A note is locked when it carries a well-formed seal.
  function clean(locked) {
    if (!locked || typeof locked !== 'object') return null;
    if (locked.v !== 1 || typeof locked.iter !== 'number' || locked.iter < 1) return null;
    if (['salt', 'iv', 'data'].some(function (key) { return typeof locked[key] !== 'string' || !locked[key]; })) {
      return null;
    }
    return {
      v: 1, iter: locked.iter, salt: locked.salt, iv: locked.iv, data: locked.data,
      hint: typeof locked.hint === 'string' ? locked.hint.slice(0, 100) : ''
    };
  }

  function isLocked(note) {
    return !!(note && clean(note.locked));
  }

  // Lock text with a new password. Resolves to { locked, keyring }: the seal to
  // store, and what this session keeps (never the password) to save later edits.
  function seal(text, password, noteId, hint) {
    var salt = random(16);
    var iterations = api.ITERATIONS;
    return derive(password, salt, iterations).then(function (key) {
      var keyring = { key: key, salt: toBase64(salt), iter: iterations, hint: String(hint || '').slice(0, 100) };
      return reseal(text, keyring, noteId).then(function (locked) {
        return { locked: locked, keyring: keyring };
      });
    });
  }

  // Save edits to an already-open locked note: same key, fresh IV.
  function reseal(text, keyring, noteId) {
    return encrypt(keyring.key, text, noteId).then(function (box) {
      return { v: 1, iter: keyring.iter, salt: keyring.salt, iv: box.iv, data: box.data, hint: keyring.hint };
    });
  }

  // Resolves to { text, keyring }, or rejects when the password is wrong.
  function open(locked, password, noteId) {
    var seal = clean(locked);
    if (!seal) return Promise.reject(new Error('This note’s lock is damaged.'));
    return derive(password, fromBase64(seal.salt), seal.iter).then(function (key) {
      return crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(seal.iv), additionalData: encode(noteId) },
        key,
        fromBase64(seal.data)
      ).then(function (plain) {
        return {
          text: new TextDecoder().decode(plain),
          keyring: { key: key, salt: seal.salt, iter: seal.iter, hint: seal.hint }
        };
      });
    }).catch(function (err) {
      if (err && err.message === 'This note’s lock is damaged.') throw err;
      throw new Error('That password is not right.');
    });
  }

  return api;
})();
