/* Note list, search, tag filtering and the full-screen note editor.

   Notes are Markdown. The editor stays a plain textarea — what you type is
   what is stored, readable anywhere — and Preview shows it formatted, with
   working checkboxes and any attached pictures.

   A note can be locked with a password (js/notelock.js). While one is open
   and unlocked, this file holds its key — never the password — and every
   save is encrypted before it reaches the store. Leaving the note, or a
   couple of minutes in the background, drops the key and clears the text
   off the screen. */
window.NotesView = (function () {
  'use strict';

  var SAVE_DELAY = 400;
  var RELOCK_AFTER = 2 * 60 * 1000;    // in the background this long, a locked note locks again

  var els = {};
  var currentId = null;
  var saveTimer = null;
  var query = '';
  var activeTag = '';
  var previewing = false;

  // The open note's lock: `keyring` while it is unlocked (or was just locked
  // here), `sealed` while it is still waiting for its password.
  var keyring = null;
  var sealed = false;
  var lastSealed = null;              // the text the store's seal already holds
  var saving = Promise.resolve();     // locked saves run one after another
  var hiddenAt = 0;
  var lockMode = 'set';

  function formatStamp(stamp) {
    var date = new Date(stamp);
    var now = new Date();
    var sameDay = date.toDateString() === now.toDateString();
    if (sameDay) {
      return 'Today ' + Fmt.clock(date);
    }
    var sameYear = date.getFullYear() === now.getFullYear();
    return date.toLocaleDateString(undefined, sameYear
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function preview(note) {
    if (note.locked) return '🔒 Locked — open it with its password';
    var text = Markdown.plain(note.body).trim();
    return text ? text.slice(0, 240) : 'No additional text';
  }

  /* ------------------------------------------------------------- the list -- */

  function renderTagFilters() {
    var tags = Store.allTags();
    els.tagFilters.innerHTML = '';
    els.tagFilters.hidden = !tags.length;
    if (!tags.length) return;

    var all = document.createElement('button');
    all.type = 'button';
    all.className = 'chip' + (activeTag ? '' : ' is-on');
    all.dataset.tag = '';
    all.textContent = 'All';
    els.tagFilters.appendChild(all);

    tags.forEach(function (tag) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (activeTag === tag.name ? ' is-on' : '');
      chip.dataset.tag = tag.name;
      chip.textContent = tag.name + ' · ' + tag.count;
      els.tagFilters.appendChild(chip);
    });
  }

  function render() {
    renderTagFilters();

    var notes = Store.allNotes(query, activeTag);
    els.list.innerHTML = '';

    if (!notes.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = query
        ? 'No notes match “' + query + '”.'
        : (activeTag ? 'No notes tagged “' + activeTag + '”.' : 'No notes yet. Tap “New note” to start one.');
      els.list.appendChild(empty);
      return;
    }

    var fragment = document.createDocumentFragment();
    notes.forEach(function (note) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'note-card' + (note.pinned ? ' is-pinned' : '');
      card.dataset.id = note.id;

      var head = document.createElement('span');
      head.className = 'note-card-head';
      var title = document.createElement('h3');
      title.textContent = note.title.trim() || 'Untitled note';
      head.appendChild(title);
      if (note.locked) card.classList.add('is-locked');
      if (note.pinned) {
        var pin = document.createElement('span');
        pin.className = 'pin-mark';
        pin.setAttribute('aria-label', 'Pinned');
        pin.textContent = '📌';
        head.appendChild(pin);
      }

      var text = document.createElement('p');
      text.textContent = preview(note);

      var progress = Store.checklistProgress(note.body);

      var footer = document.createElement('span');
      footer.className = 'note-foot';
      if (progress) {
        var done = document.createElement('span');
        done.className = 'tag check-count' + (progress.done === progress.total ? ' is-complete' : '');
        done.textContent = progress.done + '/' + progress.total + ' done';
        footer.appendChild(done);
      }
      if (note.tags.length) {
        var tags = document.createElement('span');
        tags.className = 'note-tags-row';
        note.tags.forEach(function (name) {
          var tag = document.createElement('span');
          tag.className = 'tag';
          tag.textContent = name;
          tags.appendChild(tag);
        });
        footer.appendChild(tags);
      }
      var date = document.createElement('span');
      date.className = 'note-date';
      date.textContent = formatStamp(note.updatedAt);
      footer.appendChild(date);

      card.appendChild(head);
      card.appendChild(text);
      card.appendChild(footer);
      fragment.appendChild(card);
    });
    els.list.appendChild(fragment);
  }

  /* --------------------------------------------------------------- editor -- */

  function setPinButton(pinned) {
    els.pin.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    els.pin.setAttribute('aria-label', pinned ? 'Unpin note' : 'Pin note');
    els.pin.classList.toggle('is-on', pinned);
  }

  function open(id) {
    var note = Store.getNote(id);
    if (!note) return;
    currentId = id;
    keyring = null;
    lastSealed = null;
    sealed = !!note.locked;
    els.title.value = note.title;
    els.body.value = sealed ? '' : note.body;
    els.tags.value = note.tags.join(', ');
    setPinButton(note.pinned);
    renderLink(note);
    els.status.textContent = 'Edited ' + formatStamp(note.updatedAt);
    els.editor.hidden = false;
    document.body.style.overflow = 'hidden';
    showSealed(note);
    if (!sealed) (note.title || note.body ? els.body : els.title).focus();
  }

  /* ----------------------------------------------------------------- lock -- */

  function setLockButton() {
    var locked = sealed || !!keyring;
    els.lock.classList.toggle('is-on', locked);
    els.lock.setAttribute('aria-label', locked ? 'Locked — manage the lock' : 'Lock note with a password');
    els.lock.hidden = !NoteLock.supported();
  }

  // A locked note opens on its password prompt; nothing of its text is on the
  // page until the password is right.
  function showSealed(note) {
    els.unlock.hidden = !sealed;
    els.format.hidden = sealed;
    els.tagsRow.hidden = sealed;
    els.title.readOnly = sealed;
    els.check.disabled = sealed;
    if (sealed) {
      els.body.hidden = true;
      els.rendered.hidden = true;
      els.rendered.innerHTML = '';
      var hint = note && note.locked && note.locked.hint;
      els.unlockHint.hidden = !hint;
      els.unlockHint.textContent = hint ? 'Hint: ' + hint : '';
      els.unlockPassword.value = '';
      els.unlockError.hidden = true;
      els.unlockPassword.focus();
    } else {
      setPreview(false);
    }
    setLockButton();
  }

  function unlock(submitEvent) {
    submitEvent.preventDefault();
    var id = currentId;
    var note = id && Store.getNote(id);
    var password = els.unlockPassword.value;
    if (!note || !note.locked || !password) return;
    els.unlockButton.disabled = true;
    els.unlockButton.textContent = 'Unlocking…';
    NoteLock.open(note.locked, password, id).then(function (opened) {
      if (currentId !== id) return;
      keyring = opened.keyring;
      lastSealed = opened.text;
      sealed = false;
      els.body.value = opened.text;
      showSealed(note);
      els.body.focus();
    }, function (err) {
      els.unlockError.textContent = err.message;
      els.unlockError.hidden = false;
      els.unlockPassword.select();
    }).then(function () {
      els.unlockPassword.value = currentId === id && sealed ? els.unlockPassword.value : '';
      els.unlockButton.disabled = false;
      els.unlockButton.textContent = 'Unlock';
    });
  }

  function openLockDialog(mode) {
    lockMode = mode;
    var managing = mode === 'manage';
    els.lockTitle.textContent = managing ? 'Locked note'
      : (mode === 'change' ? 'Change the password' : 'Lock this note');
    els.lockSet.hidden = managing;
    els.lockManage.hidden = !managing;
    els.lockSubmit.textContent = mode === 'change' ? 'Change password' : 'Lock';
    els.lockPassword.value = '';
    els.lockRepeat.value = '';
    els.lockHint.value = keyring ? keyring.hint : '';
    els.lockError.hidden = true;
    // Pictures live as files in the sync project; they cannot be sealed.
    var pictures = (els.body.value.match(/!\[[^\]]*\]\(att:/g) || []).length;
    els.lockPictures.hidden = !pictures || managing;
    els.lockPictures.textContent = pictures === 1
      ? 'The picture in this note is a separate file and is not encrypted — only your account can reach it.'
      : 'The ' + pictures + ' pictures in this note are separate files and are not encrypted — only your account can reach them.';
    els.lockModal.hidden = false;
    if (!managing) els.lockPassword.focus();
  }

  function closeLockDialog() {
    els.lockModal.hidden = true;
    els.lockPassword.value = '';
    els.lockRepeat.value = '';
  }

  function lockError(message) {
    els.lockError.textContent = message;
    els.lockError.hidden = false;
  }

  // Seal what is on screen under a new password: first lock, or a change.
  function applyLock(submitEvent) {
    submitEvent.preventDefault();
    var id = currentId;
    if (!id) return;
    var password = els.lockPassword.value;
    if (password.length < 4) return lockError('Use at least 4 characters.');
    if (password !== els.lockRepeat.value) return lockError('The two passwords are not the same.');

    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    var text = els.body.value;
    var changing = lockMode === 'change';
    els.lockSubmit.disabled = true;
    els.lockSubmit.textContent = changing ? 'Changing…' : 'Locking…';
    saving.then(function () {
      return NoteLock.seal(text, password, id, els.lockHint.value.trim());
    }).then(function (result) {
      if (currentId !== id) return;
      Store.updateNote(id, { title: els.title.value, tags: els.tags.value.split(','), locked: result.locked });
      keyring = result.keyring;
      lastSealed = text;
      closeLockDialog();
      setLockButton();
      if (window.App) {
        App.toast(changing ? 'Password changed.' : 'Locked. You will need the password to open it again.');
      }
    }).catch(function (err) {
      lockError((err && err.message) || 'The note could not be locked.');
    }).then(function () {
      els.lockSubmit.disabled = false;
      els.lockSubmit.textContent = changing ? 'Change password' : 'Lock';
    });
  }

  function removeLock() {
    var id = currentId;
    if (!id || !keyring) return;
    if (!window.confirm('Remove the lock? The note will be saved and synced as plain text again.')) return;
    var text = els.body.value;
    saving.then(function () {
      if (currentId !== id) return;
      Store.updateNote(id, { body: text, locked: null });
      keyring = null;
      lastSealed = null;
      closeLockDialog();
      setLockButton();
      if (window.App) App.toast('Lock removed.');
    });
  }

  /* -------------------------------------------------------- linked event -- */

  // A note made from an event says which one, and goes back to it.
  function renderLink(note) {
    var event = note.eventId ? Store.getEvent(note.eventId) : null;
    els.link.hidden = !event;
    if (!event) return;
    var day = note.eventDate || event.date;
    els.linkOpen.textContent = '📅 ' + event.title + ' · ' + Store.fromKey(day)
      .toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function openLinkedEvent() {
    var note = currentId && Store.getNote(currentId);
    var event = note && note.eventId ? Store.getEvent(note.eventId) : null;
    if (!event) return;
    var day = note.eventDate || event.date;
    close();
    location.hash = '#calendar';
    CalendarView.selectDate(day);
    CalendarView.editEvent(event.id, day);
  }

  /* -------------------------------------------------------------- preview -- */

  function setPreview(on) {
    previewing = on;
    els.previewToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    els.previewToggle.textContent = on ? 'Edit' : 'Preview';
    els.previewToggle.classList.toggle('is-on', on);
    els.body.hidden = on;
    els.rendered.hidden = !on;
    if (on) renderPreview();
  }

  function renderPreview() {
    var body = els.body.value;
    els.rendered.innerHTML = body.trim()
      ? Markdown.render(body)
      : '<p class="empty">Nothing written yet.</p>';
    Array.prototype.forEach.call(els.rendered.querySelectorAll('[data-att]'), function (slot) {
      Attachments.url(slot.dataset.att).then(function (src) {
        var img = document.createElement('img');
        img.className = 'md-image';
        img.alt = slot.getAttribute('aria-label') || '';
        img.src = src;
        slot.replaceWith(img);
      }).catch(function (err) {
        slot.classList.remove('is-loading');
        slot.classList.add('is-missing');
        slot.textContent = '🖼 ' + (slot.getAttribute('aria-label') || 'picture') + ' — ' + err.message;
      });
    });
  }

  /* ----------------------------------------------------------- formatting -- */

  function edit(value, selectStart, selectEnd) {
    els.body.value = value;
    els.body.focus();
    els.body.selectionStart = selectStart;
    els.body.selectionEnd = selectEnd;
    scheduleSave();
  }

  // Wraps the selection — or a placeholder, selected so typing replaces it.
  function wrap(before, after, placeholder) {
    var body = els.body;
    var start = body.selectionStart;
    var end = body.selectionEnd;
    var chosen = body.value.slice(start, end) || placeholder;
    edit(body.value.slice(0, start) + before + chosen + after + body.value.slice(end),
      start + before.length, start + before.length + chosen.length);
  }

  // Adds a marker to the start of the line, or takes it off if it is there.
  function toggleLinePrefix(prefix) {
    var body = els.body;
    var value = body.value;
    var caret = body.selectionStart;
    var lineStart = value.lastIndexOf('\n', caret - 1) + 1;
    var has = value.slice(lineStart, lineStart + prefix.length) === prefix;
    var next = has
      ? value.slice(0, lineStart) + value.slice(lineStart + prefix.length)
      : value.slice(0, lineStart) + prefix + value.slice(lineStart);
    var shift = has ? -prefix.length : prefix.length;
    var at = Math.max(lineStart, caret + shift);
    edit(next, at, at);
  }

  function format(kind) {
    if (previewing) setPreview(false);
    if (kind === 'bold') wrap('**', '**', 'bold');
    else if (kind === 'italic') wrap('*', '*', 'italic');
    else if (kind === 'heading') toggleLinePrefix('## ');
    else if (kind === 'list') toggleLinePrefix('- ');
    else if (kind === 'link') wrap('[', '](https://)', 'link text');
  }

  // Puts text on a line of its own at the cursor.
  function insertBlock(text) {
    var body = els.body;
    var value = body.value;
    var at = body.selectionEnd;
    var before = value.slice(0, at);
    var lead = before && !/\n$/.test(before) ? '\n' : '';
    var insert = lead + text + '\n';
    edit(before + insert + value.slice(at), at + insert.length, at + insert.length);
  }

  function attachImage(file) {
    if (!file || !currentId || keyring || sealed) return;
    if (!/^image\//.test(file.type)) {
      if (window.App) App.toast('That is not a picture.');
      return;
    }
    var noteId = currentId;
    els.status.textContent = 'Uploading picture…';
    Attachments.upload(noteId, file).then(function (ref) {
      if (currentId !== noteId) return;
      if (previewing) setPreview(false);
      var alt = String(file.name || 'picture').replace(/\.[^.]*$/, '').replace(/[\[\]()]/g, '');
      insertBlock('![' + alt + '](att:' + ref + ')');
      setPreview(true);
    }).catch(function (err) {
      els.status.textContent = '';
      if (window.App) App.toast(err.message || 'The picture could not be uploaded.');
    });
  }

  function fields() {
    return {
      title: els.title.value,
      body: els.body.value,
      tags: els.tags.value.split(',')
    };
  }

  // Saves what is on screen now. A plain note is written straight away; a
  // locked one is encrypted first, so its saves queue up behind each other.
  // Either way, what gets saved is read the moment this is called.
  function save() {
    var id = currentId;
    if (!id || sealed) return Promise.resolve(id ? Store.getNote(id) : null);
    var values = fields();
    if (!keyring) return Promise.resolve(Store.updateNote(id, values));

    var ring = keyring;
    saving = saving.then(function () {
      if (values.body === lastSealed) {
        return Store.updateNote(id, { title: values.title, tags: values.tags });
      }
      return NoteLock.reseal(values.body, ring, id).then(function (locked) {
        if (currentId === id) lastSealed = values.body;
        return Store.updateNote(id, { title: values.title, tags: values.tags, locked: locked });
      });
    }).catch(function (err) {
      console.warn('Could not save the locked note:', err);
      if (currentId === id) els.status.textContent = 'Could not save — keep this open and try again';
      return null;
    });
    return saving;
  }

  function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    return save();
  }

  function scheduleSave() {
    if (!currentId || sealed) return;
    els.status.textContent = 'Saving…';
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      save().then(function (note) {
        if (note && currentId === note.id) els.status.textContent = 'Saved ' + formatStamp(note.updatedAt);
      });
    }, SAVE_DELAY);
  }

  function close() {
    if (!currentId) return;
    var id = currentId;
    var saved = flush();

    // Nothing of a locked note stays on the page once it is left.
    currentId = null;
    keyring = null;
    sealed = false;
    lastSealed = null;
    els.body.value = '';
    els.rendered.innerHTML = '';
    els.unlockPassword.value = '';
    closeLockDialog();
    els.editor.hidden = true;
    document.body.style.overflow = '';

    saved.then(function () {
      // An untouched blank note would only clutter the list.
      var note = Store.getNote(id);
      if (note && !note.locked && !note.title.trim() && !note.body.trim() && !note.tags.length) {
        Store.deleteNote(note.id);
      }
      render();
    });
    render();
  }

  function remove() {
    if (!currentId) return;
    if (!window.confirm('Delete this note?')) return;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    Store.deleteNote(currentId);
    Attachments.removeAll(currentId);
    currentId = null;
    keyring = null;
    sealed = false;
    lastSealed = null;
    els.body.value = '';
    els.rendered.innerHTML = '';
    els.editor.hidden = true;
    document.body.style.overflow = '';
    render();
  }

  /* ------------------------------------------------------------------ api -- */

  function init() {
    els = {
      list: document.getElementById('note-list'),
      tagFilters: document.getElementById('tag-filters'),
      search: document.getElementById('note-search'),
      editor: document.getElementById('note-editor'),
      title: document.getElementById('note-title'),
      body: document.getElementById('note-body'),
      tags: document.getElementById('note-tags'),
      pin: document.getElementById('note-pin'),
      check: document.getElementById('note-check'),
      status: document.getElementById('note-status'),
      rendered: document.getElementById('note-rendered'),
      previewToggle: document.getElementById('note-preview'),
      format: document.querySelector('#note-editor .note-format'),
      image: document.getElementById('note-image'),
      imageFile: document.getElementById('note-image-file'),
      link: document.getElementById('note-link'),
      linkOpen: document.getElementById('note-link-open'),
      tagsRow: document.querySelector('#note-editor .note-tags'),
      lock: document.getElementById('note-lock'),
      unlock: document.getElementById('note-unlock'),
      unlockHint: document.getElementById('note-unlock-hint'),
      unlockPassword: document.getElementById('note-unlock-password'),
      unlockError: document.getElementById('note-unlock-error'),
      unlockButton: document.getElementById('note-unlock-button'),
      lockModal: document.getElementById('lock-modal'),
      lockTitle: document.getElementById('lock-title'),
      lockSet: document.getElementById('lock-set'),
      lockManage: document.getElementById('lock-manage'),
      lockPassword: document.getElementById('lock-password'),
      lockRepeat: document.getElementById('lock-repeat'),
      lockHint: document.getElementById('lock-hint'),
      lockPictures: document.getElementById('lock-pictures'),
      lockError: document.getElementById('lock-error'),
      lockSubmit: document.getElementById('lock-submit')
    };

    els.unlock.addEventListener('submit', unlock);
    els.lock.addEventListener('click', function () {
      if (!currentId) return;
      if (sealed) {
        els.unlockPassword.focus();
        return;
      }
      openLockDialog(keyring ? 'manage' : 'set');
    });
    els.lockSet.addEventListener('submit', applyLock);
    document.getElementById('lock-remove').addEventListener('click', removeLock);
    document.getElementById('lock-change').addEventListener('click', function () { openLockDialog('change'); });
    document.getElementById('lock-now').addEventListener('click', close);
    Array.prototype.forEach.call(els.lockModal.querySelectorAll('[data-lock-close]'), function (button) {
      button.addEventListener('click', closeLockDialog);
    });
    els.lockModal.addEventListener('mousedown', function (clickEvent) {
      if (clickEvent.target === els.lockModal) closeLockDialog();
    });

    els.previewToggle.addEventListener('click', function () {
      flush();
      setPreview(!previewing);
      if (!previewing) els.body.focus();
    });
    els.format.addEventListener('click', function (clickEvent) {
      var button = clickEvent.target.closest('[data-format]');
      if (button) format(button.dataset.format);
    });
    els.image.addEventListener('click', function () {
      if (keyring || sealed) {
        if (window.App) App.toast('Pictures cannot be encrypted, so they are turned off in locked notes.');
        return;
      }
      if (!Attachments.available()) {
        if (window.App) App.toast('Pictures are stored in your sync project — turn on Sync first.');
        return;
      }
      els.imageFile.click();
    });
    els.imageFile.addEventListener('change', function () {
      attachImage(this.files && this.files[0]);
      this.value = '';
    });
    // Ticking a box in the preview ticks the line it came from.
    els.rendered.addEventListener('change', function (changeEvent) {
      var line = changeEvent.target.dataset.line;
      if (line === undefined) return;
      els.body.value = Markdown.toggleLine(els.body.value, Number(line));
      scheduleSave();
      renderPreview();
    });
    els.linkOpen.addEventListener('click', openLinkedEvent);
    document.getElementById('note-link-remove').addEventListener('click', function () {
      if (!currentId) return;
      var note = Store.updateNote(currentId, { eventId: '' });
      if (note) renderLink(note);
    });

    els.search.addEventListener('input', function () {
      query = els.search.value.trim();
      render();
    });

    els.tagFilters.addEventListener('click', function (clickEvent) {
      var chip = clickEvent.target.closest('[data-tag]');
      if (!chip) return;
      activeTag = chip.dataset.tag;
      render();
    });

    document.getElementById('add-note').addEventListener('click', function () {
      open(Store.createNote().id);
    });

    els.list.addEventListener('click', function (clickEvent) {
      var card = clickEvent.target.closest('.note-card');
      if (card) open(card.dataset.id);
    });

    els.title.addEventListener('input', scheduleSave);
    els.body.addEventListener('input', scheduleSave);
    els.tags.addEventListener('input', scheduleSave);
    els.tags.addEventListener('blur', flush);

    // Checklists are plain "- [ ]" lines, so this just rewrites the line the
    // cursor is on and puts the cursor back where it was.
    els.check.addEventListener('click', function () {
      if (previewing) setPreview(false);
      var body = els.body;
      var value = body.value;
      var caret = body.selectionStart;
      var lineStart = value.lastIndexOf('\n', caret - 1) + 1;
      var lineEnd = value.indexOf('\n', caret);
      if (lineEnd === -1) lineEnd = value.length;

      var line = value.slice(lineStart, lineEnd);
      var replaced = Store.cycleChecklistLine(line);
      body.value = value.slice(0, lineStart) + replaced + value.slice(lineEnd);

      var shift = replaced.length - line.length;
      body.selectionStart = body.selectionEnd = Math.max(lineStart, caret + shift);
      body.focus();
      scheduleSave();
    });

    els.pin.addEventListener('click', function () {
      if (!currentId) return;
      var note = Store.getNote(currentId);
      if (!note) return;
      var pinned = !note.pinned;
      Store.updateNote(currentId, { pinned: pinned });
      setPinButton(pinned);
    });

    document.getElementById('note-back').addEventListener('click', close);
    document.getElementById('note-delete').addEventListener('click', remove);

    // Don't lose keystrokes when the app is backgrounded or closed. A locked
    // note left open in the background locks itself again after a while: a
    // phone put down unlocked should not leave the note readable to whoever
    // picks it up.
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        flush();
        return;
      }
      if (keyring && currentId && hiddenAt && Date.now() - hiddenAt > RELOCK_AFTER) {
        var id = currentId;
        flush().then(function () {
          if (currentId === id && keyring) open(id);
        });
      }
      hiddenAt = 0;
    });

    render();
  }

  return {
    init: init,
    render: render,
    newNote: function (link) { open(Store.createNote(link).id); },
    openNote: open,
    isEditorOpen: function () { return !els.editor.hidden; },
    closeEditor: close,
    isLockDialogOpen: function () { return !els.lockModal.hidden; },
    closeLockDialog: closeLockDialog
  };
})();
