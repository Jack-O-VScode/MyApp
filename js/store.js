/* Data layer for events, tasks and notes.

   localStorage is the source of truth: the app reads and writes here and works
   with no connection at all. js/sync.js, when it is set up, mirrors these same
   records to a server so a second device sees them.

   Two details exist purely for sync:
   - deletes are soft (`deleted: true` tombstones), because a hard delete on one
     device would simply be re-created by the other on the next pull;
   - every local change sets `dirty: true`, which is what the pusher looks for.

   Repeating events are stored once, as a master carrying a `repeat` rule. The
   individual days you see are generated on demand and never stored, so a
   weekly standup stays a single record forever.
*/
window.Store = (function () {
  'use strict';

  var KEY = 'calendar-notes.v1';
  var TOMBSTONE_TTL = 90 * 24 * 60 * 60 * 1000;   // forget deletions after 90 days
  var LISTS = { event: 'events', task: 'tasks', note: 'notes' };

  var state = { events: [], tasks: [], notes: [], settings: null };
  var listeners = [];
  var available = true;

  function uid() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  var lastStamp = 0;

  // Wall clock, nudged forward so two changes in the same millisecond still
  // come out in the order they happened. Ordering drives both the note list
  // and last-write-wins in sync, so ties there are worth avoiding.
  function now() {
    var stamp = Date.now();
    if (stamp <= lastStamp) stamp = lastStamp + 1;
    lastStamp = stamp;
    return stamp;
  }

  function listFor(kind) {
    return state[LISTS[kind]] || null;
  }

  /* ----------------------------------------------------------- date keys -- */

  // Local-time keys throughout, deliberately not toISOString() — that shifts
  // the day for anyone east or west of UTC.
  function toKey(date) {
    var month = String(date.getMonth() + 1).padStart(2, '0');
    var day = String(date.getDate()).padStart(2, '0');
    return date.getFullYear() + '-' + month + '-' + day;
  }

  function fromKey(key) {
    var parts = String(key).split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function todayKey() {
    return toKey(new Date());
  }

  function shiftKey(key, days) {
    var date = fromKey(key);
    date.setDate(date.getDate() + days);
    return toKey(date);
  }

  function isKey(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  /* ------------------------------------------------------------- loading -- */

  function normalise(item, kind) {
    if (typeof item.deleted !== 'boolean') item.deleted = false;
    if (typeof item.dirty !== 'boolean') item.dirty = false;
    if (typeof item.updatedAt !== 'number') item.updatedAt = Number(item.createdAt) || now();
    if (typeof item.createdAt !== 'number') item.createdAt = item.updatedAt;

    if (kind === 'event') {
      if (typeof item.repeat !== 'string') item.repeat = '';
      if (typeof item.repeatUntil !== 'string') item.repeatUntil = '';
      if (typeof item.color !== 'string') item.color = '';
      // Minutes before the event; -1 means "no reminder".
      if (typeof item.remind !== 'number') item.remind = -1;
      if (!Array.isArray(item.skips)) item.skips = [];
    } else if (kind === 'task') {
      if (typeof item.done !== 'boolean') item.done = false;
      if (typeof item.due !== 'string') item.due = '';
      if (typeof item.details !== 'string') item.details = '';
      if (typeof item.repeat !== 'string') item.repeat = '';
      if (typeof item.repeatDay !== 'number') item.repeatDay = 0;
    } else if (kind === 'note') {
      if (typeof item.pinned !== 'boolean') item.pinned = false;
      if (!Array.isArray(item.tags)) item.tags = [];
    }
    return item;
  }

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (!parsed) return;
      Object.keys(LISTS).forEach(function (kind) {
        var list = parsed[LISTS[kind]];
        if (Array.isArray(list)) {
          state[LISTS[kind]] = list.map(function (item) { return normalise(item, kind); });
        }
      });
      if (parsed.settings && typeof parsed.settings === 'object') state.settings = parsed.settings;
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
    var removed = false;
    Object.keys(LISTS).forEach(function (kind) {
      var list = listFor(kind);
      var kept = list.filter(keep);
      if (kept.length !== list.length) {
        state[LISTS[kind]] = kept;
        removed = true;
      }
    });
    if (removed) write();
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

  function find(kind, id) {
    return live(listFor(kind)).filter(function (item) { return item.id === id; })[0] || null;
  }

  function touch(item) {
    item.updatedAt = now();
    item.dirty = true;
  }

  function remove(kind, id) {
    var item = find(kind, id);
    if (!item) return false;
    item.deleted = true;
    touch(item);
    commit();
    return true;
  }

  /* ---------------------------------------------------------- recurrence -- */

  var REPEATS = ['daily', 'weekly', 'monthly', 'yearly'];
  var COLORS = ['blue', 'green', 'orange', 'red', 'purple', 'grey'];
  // Minutes before an event. -1 is "none"; 0 is "when it starts".
  var REMIND_CHOICES = [-1, 0, 10, 30, 60, 120, 1440];

  // The next date a rule lands on after `dateKey`. `anchorDay` keeps a monthly
  // rule on its original day: without it, the 31st would slip to the 28th in
  // February and stay there.
  function nextDate(dateKey, repeat, anchorDay) {
    var date = fromKey(dateKey);
    if (repeat === 'daily' || repeat === 'weekly') {
      date.setDate(date.getDate() + (repeat === 'daily' ? 1 : 7));
      return toKey(date);
    }
    var day = anchorDay || date.getDate();
    if (repeat === 'monthly') {
      var year = date.getFullYear();
      var month = date.getMonth() + 1;
      var lastDay = new Date(year, month + 1, 0).getDate();
      return toKey(new Date(year, month, Math.min(day, lastDay)));
    }
    if (repeat === 'yearly') {
      var nextYear = date.getFullYear() + 1;
      var lastInMonth = new Date(nextYear, date.getMonth() + 1, 0).getDate();
      return toKey(new Date(nextYear, date.getMonth(), Math.min(day, lastInMonth)));
    }
    return dateKey;
  }

  function repeatLabel(item) {
    switch (item.repeat) {
      case 'daily':
        return 'Every day';
      case 'weekly':
        return 'Every ' + fromKey(item.date).toLocaleDateString(undefined, { weekday: 'long' });
      case 'monthly':
        return 'Monthly on day ' + fromKey(item.date).getDate();
      case 'yearly':
        return 'Every year on ' + fromKey(item.date)
          .toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
      default:
        return '';
    }
  }

  // One generated day of a repeating event. It carries the master's id so an
  // edit knows what to write back to, plus the date it actually falls on.
  function occurrence(master, dateKey) {
    return {
      id: master.id,
      occurrenceId: master.id + '@' + dateKey,
      repeating: !!master.repeat,
      date: dateKey,
      title: master.title,
      time: master.time || '',
      details: master.details || '',
      color: master.color || '',
      remind: typeof master.remind === 'number' ? master.remind : -1,
      repeat: master.repeat,
      repeatUntil: master.repeatUntil,
      createdAt: master.createdAt,
      updatedAt: master.updatedAt
    };
  }

  // Every day `master` lands on within [start, end]. Work is bounded by the
  // range, so an event repeating since 2010 costs no more than a new one.
  function occurrencesOf(master, start, end) {
    var out = [];
    if (!master.repeat || REPEATS.indexOf(master.repeat) === -1) {
      if (master.date >= start && master.date <= end) out.push(occurrence(master, master.date));
      return out;
    }

    var limit = master.repeatUntil && master.repeatUntil < end ? master.repeatUntil : end;
    if (master.date > limit) return out;
    var from = start > master.date ? start : master.date;

    function push(key) {
      if (key < from || key > limit) return;
      if (master.skips.indexOf(key) !== -1) return;
      out.push(occurrence(master, key));
    }

    var anchor = fromKey(master.date);

    if (master.repeat === 'daily' || master.repeat === 'weekly') {
      var step = master.repeat === 'daily' ? 1 : 7;
      var dayMs = 24 * 60 * 60 * 1000;
      // Whole days between two local midnights, so DST cannot shift the count.
      var gap = Math.round((fromKey(from).getTime() - anchor.getTime()) / dayMs);
      var ahead = gap > 0 ? Math.ceil(gap / step) * step : 0;
      var cursor = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + ahead);
      while (toKey(cursor) <= limit) {
        push(toKey(cursor));
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + step);
      }
      return out;
    }

    if (master.repeat === 'monthly') {
      var day = anchor.getDate();
      var month = new Date(fromKey(from).getFullYear(), fromKey(from).getMonth(), 1);
      var lastMonth = fromKey(limit);
      while (month <= lastMonth) {
        var year = month.getFullYear();
        var index = month.getMonth();
        // The 31st simply does not happen in a 30-day month.
        if (new Date(year, index + 1, 0).getDate() >= day) {
          push(toKey(new Date(year, index, day)));
        }
        month = new Date(year, index + 1, 1);
      }
      return out;
    }

    // Yearly, with the same reasoning as monthly for 29 February.
    var firstYear = fromKey(from).getFullYear();
    var lastYear = fromKey(limit).getFullYear();
    for (var y = firstYear; y <= lastYear; y++) {
      var candidate = new Date(y, anchor.getMonth(), anchor.getDate());
      if (candidate.getMonth() === anchor.getMonth()) push(toKey(candidate));
    }
    return out;
  }

  /* -------------------------------------------------------------- events -- */

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

  function eventsInRange(startDate, endDate) {
    var out = [];
    live(state.events).forEach(function (master) {
      out = out.concat(occurrencesOf(master, startDate, endDate));
    });
    return sortEvents(out);
  }

  function eventsOn(date) {
    return eventsInRange(date, date);
  }

  function saveEvent(input) {
    var stamp = now();
    var fields = {
      title: input.title,
      date: input.date,
      time: input.time || '',
      details: input.details || '',
      color: COLORS.indexOf(input.color) === -1 ? '' : input.color,
      remind: REMIND_CHOICES.indexOf(Number(input.remind)) === -1 ? -1 : Number(input.remind),
      repeat: REPEATS.indexOf(input.repeat) === -1 ? '' : input.repeat,
      repeatUntil: isKey(input.repeatUntil) ? input.repeatUntil : ''
    };

    if (input.id) {
      var master = find('event', input.id);
      if (!master) return null;

      // "Only this day" on a repeating event: hide that occurrence and store
      // the edit as its own one-off, leaving the series alone.
      if (input.scope === 'occurrence' && master.repeat && input.occurrenceDate) {
        if (master.skips.indexOf(input.occurrenceDate) === -1) {
          master.skips.push(input.occurrenceDate);
          touch(master);
        }
        var detached = normalise(Object.assign({
          id: uid(), createdAt: stamp, updatedAt: stamp, dirty: true
        }, fields, { repeat: '', repeatUntil: '', skips: [] }), 'event');
        state.events.push(detached);
        commit();
        return detached;
      }

      Object.assign(master, fields);
      // Days skipped under an old rule mean nothing under a new one.
      if (input.resetSkips) master.skips = [];
      touch(master);
      commit();
      return master;
    }

    var created = normalise(Object.assign({
      id: uid(), skips: [], createdAt: stamp, updatedAt: stamp, dirty: true
    }, fields), 'event');
    state.events.push(created);
    commit();
    return created;
  }

  // scope 'occurrence' hides one day of a series; anything else deletes it all.
  function deleteEvent(id, scope, occurrenceDate) {
    var master = find('event', id);
    if (!master) return;
    if (scope === 'occurrence' && master.repeat && occurrenceDate) {
      if (master.skips.indexOf(occurrenceDate) === -1) master.skips.push(occurrenceDate);
      touch(master);
      commit();
      return;
    }
    remove('event', id);
  }

  /* --------------------------------------------------------------- tasks -- */

  function sortTasks(list) {
    return list.sort(function (a, b) {
      // Done work sinks; above it, dated before undated, soonest first.
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (a.done) return b.updatedAt - a.updatedAt;
      if (!a.due !== !b.due) return a.due ? -1 : 1;
      if (a.due !== b.due) return a.due < b.due ? -1 : 1;
      return a.createdAt - b.createdAt;
    });
  }

  function allTasks(filter) {
    var options = filter || {};
    var list = live(state.tasks);
    if (options.query) {
      var needle = options.query.toLowerCase();
      list = list.filter(function (task) {
        return (task.title + '\n' + task.details).toLowerCase().indexOf(needle) !== -1;
      });
    }
    if (options.openOnly) list = list.filter(function (task) { return !task.done; });
    return sortTasks(list);
  }

  function tasksOn(date) {
    return sortTasks(live(state.tasks).filter(function (task) { return task.due === date; }));
  }

  // Everything still open and dated today or earlier — what the Today screen
  // lists and the app-icon badge counts.
  function tasksDue(dateKey) {
    return sortTasks(live(state.tasks).filter(function (task) {
      return !task.done && task.due && task.due <= dateKey;
    }));
  }

  function saveTask(input) {
    var stamp = now();
    var repeat = REPEATS.indexOf(input.repeat) === -1 ? '' : input.repeat;
    var fields = {
      title: input.title,
      due: isKey(input.due) ? input.due : '',
      details: input.details || '',
      // A rule with no date has nothing to repeat from.
      repeat: isKey(input.due) ? repeat : '',
      repeatDay: isKey(input.due) && repeat ? fromKey(input.due).getDate() : 0
    };
    if (input.id) {
      var task = find('task', input.id);
      if (!task) return null;
      Object.assign(task, fields);
      touch(task);
      commit();
      return task;
    }
    var created = normalise(Object.assign({
      id: uid(), done: false, doneAt: 0, createdAt: stamp, updatedAt: stamp, dirty: true
    }, fields), 'task');
    state.tasks.push(created);
    commit();
    return created;
  }

  // Ticking a repeating task does not finish it — it moves to its next date.
  // Storing one row that rolls forward beats generating an occurrence per week
  // and leaving a trail of completed copies behind.
  function toggleTask(id) {
    var task = find('task', id);
    if (!task) return null;

    if (task.repeat && task.due && !task.done) {
      var today = todayKey();
      var next = nextDate(task.due, task.repeat, task.repeatDay);
      // An overdue daily task should land on tomorrow, not on last Tuesday.
      var guard = 0;
      while (next <= today && guard++ < 500) {
        next = nextDate(next, task.repeat, task.repeatDay);
      }
      task.due = next;
      task.doneAt = now();
      touch(task);
      commit();
      return { task: task, advancedTo: next };
    }

    task.done = !task.done;
    task.doneAt = task.done ? now() : 0;
    touch(task);
    commit();
    return { task: task, advancedTo: '' };
  }

  function deleteTask(id) {
    remove('task', id);
  }

  function clearDoneTasks() {
    var count = 0;
    live(state.tasks).forEach(function (task) {
      if (!task.done) return;
      task.deleted = true;
      touch(task);
      count++;
    });
    if (count) commit();
    return count;
  }

  /* --------------------------------------------------------------- notes -- */

  function sortNotes(list) {
    return list.sort(function (a, b) {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      // Two notes saved in the same millisecond would otherwise swap places
      // between renders.
      if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
      return b.createdAt - a.createdAt;
    });
  }

  function allNotes(query, tag) {
    var list = live(state.notes);
    if (query) {
      var needle = query.toLowerCase();
      list = list.filter(function (note) {
        return (note.title + '\n' + note.body + '\n' + note.tags.join(' '))
          .toLowerCase().indexOf(needle) !== -1;
      });
    }
    if (tag) {
      list = list.filter(function (note) { return note.tags.indexOf(tag) !== -1; });
    }
    return sortNotes(list);
  }

  function allTags() {
    var counts = {};
    live(state.notes).forEach(function (note) {
      note.tags.forEach(function (name) { counts[name] = (counts[name] || 0) + 1; });
    });
    return Object.keys(counts).sort().map(function (name) {
      return { name: name, count: counts[name] };
    });
  }

  function getNote(id) {
    return find('note', id);
  }

  function createNote() {
    var stamp = now();
    var note = normalise({
      id: uid(), title: '', body: '', pinned: false, tags: [],
      createdAt: stamp, updatedAt: stamp, dirty: true
    }, 'note');
    state.notes.push(note);
    commit();
    return note;
  }

  function cleanTags(tags) {
    var seen = [];
    (tags || []).forEach(function (raw) {
      var name = String(raw).trim().replace(/^#/, '').slice(0, 24);
      if (name && seen.indexOf(name) === -1) seen.push(name);
    });
    return seen.slice(0, 8);
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
    if (typeof fields.pinned === 'boolean' && fields.pinned !== note.pinned) {
      note.pinned = fields.pinned;
      changed = true;
    }
    if (fields.tags) {
      var tags = cleanTags(fields.tags);
      if (tags.join(' ') !== note.tags.join(' ')) {
        note.tags = tags;
        changed = true;
      }
    }
    if (!changed) return note;
    touch(note);
    commit();
    return note;
  }

  function deleteNote(id) {
    remove('note', id);
  }

  /* ----------------------------------------------------------- settings -- */

  // One synced record, so the digest time and default lead are the same on
  // every device. Anything device-specific (a push subscription) stays out of
  // here and lives only on the device it belongs to.
  var SETTINGS_ID = 'prefs';
  var DEFAULT_SETTINGS = {
    remindersOn: false,
    digestTime: '08:00',    // when the daily "what's due" summary fires
    digestOn: true,
    defaultRemind: -1       // pre-selected reminder for a new event
  };

  function getSettings() {
    var stored = state.settings || {};
    return Object.assign({}, DEFAULT_SETTINGS, stored.values || {});
  }

  function saveSettings(patch) {
    var current = getSettings();
    var next = Object.assign({}, current, patch || {});
    var changed = Object.keys(next).some(function (key) { return next[key] !== current[key]; });
    if (!changed) return next;

    state.settings = {
      id: SETTINGS_ID,
      values: next,
      createdAt: (state.settings && state.settings.createdAt) || now(),
      updatedAt: now(),
      deleted: false,
      dirty: true
    };
    commit();
    return next;
  }

  /* ---------------------------------------------------------- checklists -- */

  var CHECK_LINE = /^(\s*)-\s\[( |x|X)\]\s?(.*)$/;

  // Notes keep checklists as plain "- [ ]" lines, so the body stays readable
  // text everywhere else — in search, in a backup, in another editor.
  function checklistProgress(body) {
    var done = 0;
    var total = 0;
    String(body || '').split('\n').forEach(function (line) {
      var match = CHECK_LINE.exec(line);
      if (!match) return;
      total++;
      if (match[2] !== ' ') done++;
    });
    return total ? { done: done, total: total } : null;
  }

  // Cycles one line: plain -> unticked -> ticked -> plain.
  function cycleChecklistLine(line) {
    var match = CHECK_LINE.exec(line);
    if (!match) {
      var indent = /^(\s*)/.exec(line)[1];
      return indent + '- [ ] ' + line.slice(indent.length);
    }
    if (match[2] === ' ') return match[1] + '- [x] ' + match[3];
    return match[1] + match[3];
  }

  /* -------------------------------------------------------------- search -- */

  // One query across everything, for the search box on the Today screen.
  function search(query) {
    var text = String(query || '').trim();
    if (!text) return { events: [], tasks: [], notes: [] };
    var needle = text.toLowerCase();
    var today = todayKey();

    var events = [];
    live(state.events).forEach(function (master) {
      if ((master.title + '\n' + master.details).toLowerCase().indexOf(needle) === -1) return;
      // Show a hit on its next occurrence rather than where the series began.
      var upcoming = occurrencesOf(master, today, shiftKey(today, 400))[0];
      events.push(upcoming || occurrence(master, master.date));
    });

    return {
      events: sortEvents(events).slice(0, 8),
      tasks: allTasks({ query: text }).slice(0, 8),
      notes: allNotes(text).slice(0, 8)
    };
  }

  /* ---------------------------------------------------------------- sync -- */

  function toRecord(item, kind) {
    var payload;
    if (kind === 'event') {
      payload = {
        title: item.title, date: item.date, time: item.time || '',
        details: item.details || '', color: item.color || '',
        remind: typeof item.remind === 'number' ? item.remind : -1,
        repeat: item.repeat || '', repeatUntil: item.repeatUntil || '',
        skips: item.skips || []
      };
    } else if (kind === 'task') {
      payload = {
        title: item.title, due: item.due || '', details: item.details || '',
        done: !!item.done, doneAt: item.doneAt || 0,
        repeat: item.repeat || '', repeatDay: item.repeatDay || 0
      };
    } else {
      payload = {
        title: item.title, body: item.body,
        pinned: !!item.pinned, tags: item.tags || []
      };
    }
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
      base.color = String(payload.color || '');
      base.remind = typeof payload.remind === 'number' ? payload.remind : -1;
      base.repeat = String(payload.repeat || '');
      base.repeatUntil = String(payload.repeatUntil || '');
      base.skips = Array.isArray(payload.skips) ? payload.skips.slice() : [];
    } else if (record.kind === 'task') {
      base.title = String(payload.title || '');
      base.due = String(payload.due || '');
      base.details = String(payload.details || '');
      base.done = !!payload.done;
      base.doneAt = Number(payload.doneAt) || 0;
      base.repeat = String(payload.repeat || '');
      base.repeatDay = Number(payload.repeatDay) || 0;
    } else {
      base.title = String(payload.title || '');
      base.body = String(payload.body || '');
      base.pinned = !!payload.pinned;
      base.tags = Array.isArray(payload.tags) ? payload.tags.slice() : [];
    }
    return normalise(base, record.kind);
  }

  // Everything changed locally and not yet accepted by the server.
  function settingsRecord() {
    return {
      id: SETTINGS_ID,
      kind: 'setting',
      payload: { values: getSettings() },
      deleted: false,
      created_at: state.settings.createdAt,
      updated_at: state.settings.updatedAt
    };
  }

  function pendingRecords() {
    var out = [];
    Object.keys(LISTS).forEach(function (kind) {
      listFor(kind).forEach(function (item) {
        if (item.dirty) out.push(toRecord(item, kind));
      });
    });
    if (state.settings && state.settings.dirty) out.push(settingsRecord());
    return out;
  }

  // Called once the server has accepted a push. Anything edited again in the
  // meantime keeps its dirty flag, so the next push picks it up.
  function markSynced(records) {
    var byId = {};
    records.forEach(function (record) { byId[record.id] = record.updated_at; });
    var touched = false;
    Object.keys(LISTS).forEach(function (kind) {
      listFor(kind).forEach(function (item) {
        if (item.dirty && byId[item.id] === item.updatedAt) {
          item.dirty = false;
          touched = true;
        }
      });
    });
    if (state.settings && state.settings.dirty &&
        byId[SETTINGS_ID] === state.settings.updatedAt) {
      state.settings.dirty = false;
      touched = true;
    }
    if (touched) write();
  }

  function markAllDirty() {
    Object.keys(LISTS).forEach(function (kind) {
      listFor(kind).forEach(function (item) { item.dirty = true; });
    });
    if (state.settings) state.settings.dirty = true;
    write();
  }

  function hasLocalData() {
    return live(state.events).length + live(state.tasks).length + live(state.notes).length > 0;
  }

  // Merge rows pulled from the server. Newest edit wins, per record; a record
  // we have never seen is simply added.
  function applyRemote(records) {
    var applied = 0;
    records.forEach(function (record) {
      if (record.kind === 'setting') {
        var incomingStamp = Number(record.updated_at) || 0;
        var mine = state.settings ? state.settings.updatedAt : -1;
        if (incomingStamp > mine) {
          state.settings = {
            id: SETTINGS_ID,
            values: Object.assign({}, DEFAULT_SETTINGS, (record.payload || {}).values || {}),
            createdAt: Number(record.created_at) || incomingStamp,
            updatedAt: incomingStamp,
            deleted: false,
            dirty: false
          };
          applied++;
        }
        return;
      }

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
      version: 2,
      exportedAt: new Date().toISOString(),
      events: live(state.events),
      tasks: live(state.tasks),
      notes: live(state.notes),
      settings: getSettings()
    };
  }

  var VALID = {
    event: function (value) {
      return value && typeof value.title === 'string' && isKey(value.date);
    },
    task: function (value) {
      return value && typeof value.title === 'string';
    },
    note: function (value) {
      return value && typeof value.title === 'string' && typeof value.body === 'string';
    }
  };

  // Merges a backup into what is already here; an entry with a known id wins
  // only if it is newer, so importing the same file twice is harmless.
  function importData(payload) {
    var kinds = Object.keys(LISTS).filter(function (kind) {
      return Array.isArray(payload && payload[LISTS[kind]]);
    });
    if (!kinds.length) {
      throw new Error('That file does not look like a Calendar & Notes backup.');
    }
    var added = 0;
    var updated = 0;

    if (payload.settings && typeof payload.settings === 'object') {
      saveSettings(payload.settings);
    }

    kinds.forEach(function (kind) {
      var list = listFor(kind);
      payload[LISTS[kind]].forEach(function (item) {
        if (!VALID[kind](item)) return;
        var stamp = Number(item.updatedAt) || Number(item.createdAt) || now();
        var clean = normalise(Object.assign({}, item, {
          id: item.id || uid(),
          createdAt: Number(item.createdAt) || stamp,
          updatedAt: stamp,
          dirty: true
        }), kind);
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
    });
    commit();
    return { added: added, updated: updated };
  }

  return {
    subscribe: function (fn) { listeners.push(fn); },
    isPersistent: function () { return available; },
    toKey: toKey,
    fromKey: fromKey,
    todayKey: todayKey,
    shiftKey: shiftKey,
    isKey: isKey,
    repeatLabel: repeatLabel,
    eventsOn: eventsOn,
    eventsInRange: eventsInRange,
    saveEvent: saveEvent,
    deleteEvent: deleteEvent,
    getEvent: function (id) { return find('event', id); },
    allTasks: allTasks,
    tasksOn: tasksOn,
    tasksDue: tasksDue,
    saveTask: saveTask,
    toggleTask: toggleTask,
    deleteTask: deleteTask,
    clearDoneTasks: clearDoneTasks,
    nextDate: nextDate,
    colors: function () { return COLORS.slice(); },
    checklistProgress: checklistProgress,
    cycleChecklistLine: cycleChecklistLine,
    getTask: function (id) { return find('task', id); },
    getSettings: getSettings,
    saveSettings: saveSettings,
    remindChoices: function () { return REMIND_CHOICES.slice(); },
    allNotes: allNotes,
    allTags: allTags,
    getNote: getNote,
    createNote: createNote,
    updateNote: updateNote,
    deleteNote: deleteNote,
    search: search,
    exportData: exportData,
    importData: importData,
    pendingRecords: pendingRecords,
    markSynced: markSynced,
    markAllDirty: markAllDirty,
    hasLocalData: hasLocalData,
    applyRemote: applyRemote
  };
})();
