/* Note list, search, tag filtering and the full-screen note editor.

   Notes are Markdown. The editor stays a plain textarea — what you type is
   what is stored, readable anywhere — and Preview shows it formatted, with
   working checkboxes and any attached pictures. */
window.NotesView = (function () {
  'use strict';

  var SAVE_DELAY = 400;

  var els = {};
  var currentId = null;
  var saveTimer = null;
  var query = '';
  var activeTag = '';
  var previewing = false;

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
    els.title.value = note.title;
    els.body.value = note.body;
    els.tags.value = note.tags.join(', ');
    setPinButton(note.pinned);
    renderLink(note);
    els.status.textContent = 'Edited ' + formatStamp(note.updatedAt);
    els.editor.hidden = false;
    document.body.style.overflow = 'hidden';
    setPreview(false);
    (note.title || note.body ? els.body : els.title).focus();
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
    if (!file || !currentId) return;
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

  function flush() {
    if (!currentId) return;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    Store.updateNote(currentId, fields());
  }

  function scheduleSave() {
    if (!currentId) return;
    els.status.textContent = 'Saving…';
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      var note = Store.updateNote(currentId, fields());
      els.status.textContent = note ? 'Saved ' + formatStamp(note.updatedAt) : '';
    }, SAVE_DELAY);
  }

  function close() {
    if (!currentId) return;
    flush();
    // An untouched blank note would only clutter the list.
    var note = Store.getNote(currentId);
    if (note && !note.title.trim() && !note.body.trim() && !note.tags.length) {
      Store.deleteNote(note.id);
    }

    currentId = null;
    els.editor.hidden = true;
    document.body.style.overflow = '';
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
      linkOpen: document.getElementById('note-link-open')
    };

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

    // Don't lose keystrokes when the app is backgrounded or closed.
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
    });

    render();
  }

  return {
    init: init,
    render: render,
    newNote: function (link) { open(Store.createNote(link).id); },
    openNote: open,
    isEditorOpen: function () { return !els.editor.hidden; },
    closeEditor: close
  };
})();
