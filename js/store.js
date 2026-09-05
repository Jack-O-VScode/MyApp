/* Data layer. Everything lives in localStorage on the device, so the app works
   offline and nothing is uploaded anywhere. */
window.Store = (function () {
  'use strict';

  var KEY = 'calendar-notes.v1';
  var state = { events: [], notes: [] };
  var listeners = [];
  var available = true;

  function uid() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.events)) state.events = parsed.events;
      if (parsed && Array.isArray(parsed.notes)) state.notes = parsed.notes;
    } catch (err) {
      // Private mode, disabled storage or corrupt data: run in memory instead
      // of blowing up.
      available = false;
      console.warn('Could not read saved data:', err);
    }
  }

  function write() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      available = true;
    } catch (err) {
      available = false;
      console.warn('Could not save data:', err);
    }
  }

  function emit() {
    listeners.forEach(function (fn) { fn(state); });
  }

  function commit() {
    write();
    emit();
  }

  read();

  // Keep two open windows/tabs of the app in sync.
  window.addEventListener('storage', function (event) {
    if (event.key !== KEY) return;
    read();
    emit();
  });

  /* ------------------------------------------------------------- events -- */

  function sortEvents(list) {
    return list.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      // Untimed ("all day") events come first within a day.
      if (!a.time && b.time) return -1;
      if (a.time && !b.time) return 1;
      if (a.time !== b.time) return a.time < b.time ? -1 : 1;
      return a.createdAt - b.createdAt;
    });
  }

  function eventsOn(date) {
    return sortEvents(state.events.filter(function (item) { return item.date === date; }));
  }

  function eventsInRange(startDate, endDate) {
    return sortEvents(state.events.filter(function (item) {
      return item.date >= startDate && item.date <= endDate;
    }));
  }

  function saveEvent(input) {
    var now = Date.now();
    if (input.id) {
      var existing = state.events.filter(function (item) { return item.id === input.id; })[0];
      if (!existing) return null;
      existing.title = input.title;
      existing.date = input.date;
      existing.time = input.time;
      existing.details = input.details;
      existing.updatedAt = now;
      commit();
      return existing;
    }
    var created = {
      id: uid(),
      title: input.title,
      date: input.date,
      time: input.time,
      details: input.details,
      createdAt: now,
      updatedAt: now
    };
    state.events.push(created);
    commit();
    return created;
  }

  function deleteEvent(id) {
    state.events = state.events.filter(function (item) { return item.id !== id; });
    commit();
  }

  function getEvent(id) {
    return state.events.filter(function (item) { return item.id === id; })[0] || null;
  }

  /* -------------------------------------------------------------- notes -- */

  function allNotes(query) {
    var list = state.notes.slice();
    if (query) {
      var needle = query.toLowerCase();
      list = list.filter(function (note) {
        return (note.title + '\n' + note.body).toLowerCase().indexOf(needle) !== -1;
      });
    }
    return list.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
  }

  function getNote(id) {
    return state.notes.filter(function (note) { return note.id === id; })[0] || null;
  }

  function createNote() {
    var now = Date.now();
    var note = { id: uid(), title: '', body: '', createdAt: now, updatedAt: now };
    state.notes.push(note);
    commit();
    return note;
  }

  function updateNote(id, fields) {
    var note = getNote(id);
    if (!note) return null;
    var changed = false;
    if (typeof fields.title === 'string' && fields.title !== note.title) {
      note.title = fields.title;
      changed = true;
    }
    if (typeof fields.body === 'string' && fields.body !== note.body) {
      note.body = fields.body;
      changed = true;
    }
    if (!changed) return note;
    note.updatedAt = Date.now();
    commit();
    return note;
  }

  function deleteNote(id) {
    state.notes = state.notes.filter(function (note) { return note.id !== id; });
    commit();
  }

  /* ------------------------------------------------------ backup / load -- */

  function exportData() {
    return {
      app: 'calendar-notes',
      version: 1,
      exportedAt: new Date().toISOString(),
      events: state.events,
      notes: state.notes
    };
  }

  function isEvent(value) {
    return value && typeof value.title === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date);
  }

  function isNote(value) {
    return value && typeof value.title === 'string' && typeof value.body === 'string';
  }

  // Merges a backup into what is already here; an entry with a known id wins
  // only if it is newer, so importing the same file twice is harmless.
  function importData(payload) {
    if (!payload || (!Array.isArray(payload.events) && !Array.isArray(payload.notes))) {
      throw new Error('That file does not look like a Calendar & Notes backup.');
    }
    var added = 0;
    var updated = 0;

    function merge(list, incoming, valid) {
      incoming.forEach(function (item) {
        if (!valid(item)) return;
        var stamp = Number(item.updatedAt) || Number(item.createdAt) || Date.now();
        var clean = Object.assign({}, item, {
          id: item.id || uid(),
          createdAt: Number(item.createdAt) || stamp,
          updatedAt: stamp
        });
        var existing = null;
        for (var i = 0; i < list.length; i++) {
          if (list[i].id === clean.id) { existing = i; break; }
        }
        if (existing === null) {
          list.push(clean);
          added++;
        } else if (clean.updatedAt > list[existing].updatedAt) {
          list[existing] = clean;
          updated++;
        }
      });
    }

    if (Array.isArray(payload.events)) merge(state.events, payload.events, isEvent);
    if (Array.isArray(payload.notes)) merge(state.notes, payload.notes, isNote);
    commit();
    return { added: added, updated: updated };
  }

  return {
    subscribe: function (fn) { listeners.push(fn); },
    isPersistent: function () { return available; },
    eventsOn: eventsOn,
    eventsInRange: eventsInRange,
    saveEvent: saveEvent,
    deleteEvent: deleteEvent,
    getEvent: getEvent,
    allNotes: allNotes,
    getNote: getNote,
    createNote: createNote,
    updateNote: updateNote,
    deleteNote: deleteNote,
    exportData: exportData,
    importData: importData
  };
})();
