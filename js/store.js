/* Data layer.

   localStorage is the source of truth: the app reads and writes here and works
   with no connection at all. js/sync.js, when it is set up, mirrors these same
   records to a server so a second device sees them.

   Two details exist purely for sync:
   - deletes are soft (`deleted: true` tombstones), because a hard delete on one
     device would simply be re-created by the other on the next pull;
   - every local change sets `dirty: true`, which is what the pusher looks for.
*/
window.Store = (function () {
  'use strict';

  var KEY = 'calendar-notes.v1';
  var TOMBSTONE_TTL = 90 * 24 * 60 * 60 * 1000;   // forget deletions after 90 days

  var state = { events: [], notes: [] };
  var listeners = [];
  var available = true;

  function uid() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function now() {
    return Date.now();
  }

  function normalise(item) {
    if (typeof item.deleted !== 'boolean') item.deleted = false;
    if (typeof item.dirty !== 'boolean') item.dirty = false;
    if (typeof item.updatedAt !== 'number') item.updatedAt = Number(item.createdAt) || now();
    if (typeof item.createdAt !== 'number') item.createdAt = item.updatedAt;
    return item;
  }

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.events)) state.events = parsed.events.map(normalise);
      if (parsed && Array.isArray(parsed.notes)) state.notes = parsed.notes.map(normalise);
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

  // A tombstone only has to outlive the other devices' next sync. Keeping them
  // forever would grow the store without bound.
  function purgeTombstones() {
    var cutoff = now() - TOMBSTONE_TTL;
    function keep(item) {
      return !item.deleted || item.dirty || item.updatedAt > cutoff;
    }
    var before = state.events.length + state.notes.length;
    state.events = state.events.filter(keep);
    state.notes = state.notes.filter(keep);
    if (state.events.length + state.notes.length !== before) write();
  }

  read();
  purgeTombstones();

  // Keep two open windows/tabs of the app in sync.
  window.addEventListener('storage', function (event) {
    if (event.key !== KEY) return;
    read();
    emit();
  });

  function live(list) {
    return list.filter(function (item) { return !item.deleted; });
  }

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
    return sortEvents(live(state.events).filter(function (item) { return item.date === date; }));
  }

  function eventsInRange(startDate, endDate) {
    return sortEvents(live(state.events).filter(function (item) {
      return item.date >= startDate && item.date <= endDate;
    }));
  }

  function saveEvent(input) {
    var stamp = now();
    if (input.id) {
      var existing = getEvent(input.id);
      if (!existing) return null;
      existing.title = input.title;
      existing.date = input.date;
      existing.time = input.time;
      existing.details = input.details;
      existing.updatedAt = stamp;
      existing.dirty = true;
      commit();
      return existing;
    }
    var created = normalise({
      id: uid(),
      title: input.title,
      date: input.date,
      time: input.time,
      details: input.details,
      createdAt: stamp,
      updatedAt: stamp,
      dirty: true
    });
    state.events.push(created);
    commit();
    return created;
  }

  function deleteEvent(id) {
    var item = getEvent(id);
    if (!item) return;
    item.deleted = true;
    item.updatedAt = now();
    item.dirty = true;
    commit();
  }

  function getEvent(id) {
    return live(state.events).filter(function (item) { return item.id === id; })[0] || null;
  }

  /* -------------------------------------------------------------- notes -- */

  function allNotes(query) {
    var list = live(state.notes);
    if (query) {
      var needle = query.toLowerCase();
      list = list.filter(function (note) {
        return (note.title + '\n' + note.body).toLowerCase().indexOf(needle) !== -1;
      });
    }
    return list.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
  }

  function getNote(id) {
    return live(state.notes).filter(function (note) { return note.id === id; })[0] || null;
  }

  function createNote() {
    var stamp = now();
    var note = normalise({
      id: uid(), title: '', body: '', createdAt: stamp, updatedAt: stamp, dirty: true
    });
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
    note.updatedAt = now();
    note.dirty = true;
    commit();
    return note;
  }

  function deleteNote(id) {
    var note = getNote(id);
    if (!note) return;
    note.deleted = true;
    note.updatedAt = now();
    note.dirty = true;
    commit();
  }

  /* --------------------------------------------------------------- sync -- */

  var KINDS = { event: 'events', note: 'notes' };

  function listFor(kind) {
    return state[KINDS[kind]] || null;
  }

  function toRecord(item, kind) {
    var payload = kind === 'event'
      ? { title: item.title, date: item.date, time: item.time || '', details: item.details || '' }
      : { title: item.title, body: item.body };
    return {
      id: item.id,
      kind: kind,
      payload: payload,
      deleted: !!item.deleted,
      created_at: item.createdAt,
      updated_at: item.updatedAt
    };
  }

  function fromRecord(record) {
    var payload = record.payload || {};
    var stamp = Number(record.updated_at) || now();
    var base = {
      id: record.id,
      deleted: !!record.deleted,
      dirty: false,
      createdAt: Number(record.created_at) || stamp,
      updatedAt: stamp
    };
    if (record.kind === 'event') {
      base.title = String(payload.title || '');
      base.date = String(payload.date || '');
      base.time = String(payload.time || '');
      base.details = String(payload.details || '');
    } else {
      base.title = String(payload.title || '');
      base.body = String(payload.body || '');
    }
    return base;
  }

  // Everything changed locally and not yet accepted by the server.
  function pendingRecords() {
    var out = [];
    Object.keys(KINDS).forEach(function (kind) {
      listFor(kind).forEach(function (item) {
        if (item.dirty) out.push(toRecord(item, kind));
      });
    });
    return out;
  }

  // Called once the server has accepted a push. Anything edited again in the
  // meantime keeps its dirty flag, so the next push picks it up.
  function markSynced(records) {
    var byId = {};
    records.forEach(function (record) { byId[record.id] = record.updated_at; });
    var touched = false;
    Object.keys(KINDS).forEach(function (kind) {
      listFor(kind).forEach(function (item) {
        if (item.dirty && byId[item.id] === item.updatedAt) {
          item.dirty = false;
          touched = true;
        }
      });
    });
    if (touched) write();
  }

  function markAllDirty() {
    Object.keys(KINDS).forEach(function (kind) {
      listFor(kind).forEach(function (item) { item.dirty = true; });
    });
    write();
  }

  function hasLocalData() {
    return live(state.events).length > 0 || live(state.notes).length > 0;
  }

  // Merge rows pulled from the server. Newest edit wins, per record; a record
  // we have never seen is simply added.
  function applyRemote(records) {
    var applied = 0;
    records.forEach(function (record) {
      var list = listFor(record.kind);
      if (!list || !record.id) return;

      var index = -1;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === record.id) { index = i; break; }
      }
      var incoming = fromRecord(record);

      if (index === -1) {
        // No point resurrecting a tombstone we never had the original of.
        if (incoming.deleted) return;
        list.push(incoming);
        applied++;
        return;
      }
      if (incoming.updatedAt > list[index].updatedAt) {
        list[index] = incoming;
        applied++;
      }
    });
    if (applied) commit();
    return applied;
  }

  /* ------------------------------------------------------ backup / load -- */

  function exportData() {
    return {
      app: 'calendar-notes',
      version: 1,
      exportedAt: new Date().toISOString(),
      events: live(state.events),
      notes: live(state.notes)
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
        var stamp = Number(item.updatedAt) || Number(item.createdAt) || now();
        var clean = normalise(Object.assign({}, item, {
          id: item.id || uid(),
          createdAt: Number(item.createdAt) || stamp,
          updatedAt: stamp,
          dirty: true
        }));
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
    importData: importData,
    pendingRecords: pendingRecords,
    markSynced: markSynced,
    markAllDirty: markAllDirty,
    hasLocalData: hasLocalData,
    applyRemote: applyRemote
  };
})();
