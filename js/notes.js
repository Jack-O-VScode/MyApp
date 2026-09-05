/* Note list, search and the full-screen note editor. */
window.NotesView = (function () {
  'use strict';

  var SAVE_DELAY = 400;

  var els = {};
  var currentId = null;
  var saveTimer = null;
  var query = '';

  function formatStamp(stamp) {
    var date = new Date(stamp);
    var now = new Date();
    var sameDay = date.toDateString() === now.toDateString();
    if (sameDay) {
      return 'Today ' + date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
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

  function render() {
    var notes = Store.allNotes(query);
    els.list.innerHTML = '';

    if (!notes.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = query
        ? 'No notes match “' + query + '”.'
        : 'No notes yet. Tap “New note” to start one.';
      els.list.appendChild(empty);
      return;
    }

    var fragment = document.createDocumentFragment();
    notes.forEach(function (note) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'note-card';
      card.dataset.id = note.id;

      var title = document.createElement('h3');
      title.textContent = note.title.trim() || 'Untitled note';

      var text = document.createElement('p');
      text.textContent = preview(note);

      var date = document.createElement('span');
      date.className = 'note-date';
      date.textContent = formatStamp(note.updatedAt);

      card.appendChild(title);
      card.appendChild(text);
      card.appendChild(date);
      fragment.appendChild(card);
    });
    els.list.appendChild(fragment);
  }

  /* ------------------------------------------------------------- editor -- */

  function open(id) {
    var note = Store.getNote(id);
    if (!note) return;
    currentId = id;
    els.title.value = note.title;
    els.body.value = note.body;
    els.status.textContent = 'Edited ' + formatStamp(note.updatedAt);
    els.editor.hidden = false;
    document.body.style.overflow = 'hidden';
    (note.title || note.body ? els.body : els.title).focus();
  }

  function flush() {
    if (!currentId) return;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    Store.updateNote(currentId, { title: els.title.value, body: els.body.value });
  }

  function scheduleSave() {
    if (!currentId) return;
    els.status.textContent = 'Saving…';
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      var note = Store.updateNote(currentId, { title: els.title.value, body: els.body.value });
      els.status.textContent = note ? 'Saved ' + formatStamp(note.updatedAt) : '';
    }, SAVE_DELAY);
  }

  function close() {
    if (!currentId) return;
    flush();
    // An untouched blank note would only clutter the list.
    var note = Store.getNote(currentId);
    if (note && !note.title.trim() && !note.body.trim()) Store.deleteNote(note.id);

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

  /* ---------------------------------------------------------------- api -- */

  function init() {
    els = {
      list: document.getElementById('note-list'),
      search: document.getElementById('note-search'),
      editor: document.getElementById('note-editor'),
      title: document.getElementById('note-title'),
      body: document.getElementById('note-body'),
      status: document.getElementById('note-status')
    };

    els.search.addEventListener('input', function () {
      query = els.search.value.trim();
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
    isEditorOpen: function () { return !els.editor.hidden; },
    closeEditor: close
  };
})();
