/* Note list, search, tag filtering and the full-screen note editor. */
window.NotesView = (function () {
  'use strict';

  var SAVE_DELAY = 400;

  var els = {};
  var currentId = null;
  var saveTimer = null;
  var query = '';
  var activeTag = '';

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
    var text = note.body.trim();
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
    els.status.textContent = 'Edited ' + formatStamp(note.updatedAt);
    els.editor.hidden = false;
    document.body.style.overflow = 'hidden';
    (note.title || note.body ? els.body : els.title).focus();
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
      status: document.getElementById('note-status')
    };

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
    newNote: function () { open(Store.createNote().id); },
    openNote: open,
    isEditorOpen: function () { return !els.editor.hidden; },
    closeEditor: close
  };
})();
