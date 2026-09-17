/* The Today screen: what is happening now, plus one search box that looks
   across events, tasks and notes at once. */
window.TodayView = (function () {
  'use strict';

  var els = {};
  var query = '';

  function formatTime(time) {
    return Fmt.time(time);
  }

  /* ------------------------------------------------------------- sections -- */

  function renderDate() {
    var today = new Date();
    els.dayNumber.textContent = String(today.getDate());
    // Assembled rather than asked for in one go: a locale is free to order the
    // fields how it likes, and "September 2026 Thursday" is what that gets you.
    els.date.textContent = today.toLocaleDateString(undefined, { weekday: 'long' }) +
      ', ' + today.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    var events = Store.eventsOn(Store.todayKey()).length;
    var due = Store.tasksDue(Store.todayKey()).length;
    var parts = [];
    if (events) parts.push(events + (events === 1 ? ' event' : ' events'));
    if (due) parts.push(due + (due === 1 ? ' task due' : ' tasks due'));
    els.summary.textContent = parts.length ? parts.join(' · ') : 'Nothing on';
  }

  /* ------------------------------------------------------------------ now -- */

  // Minutes since midnight, which is all the comparing below needs.
  function minutesNow() {
    var at = new Date();
    return at.getHours() * 60 + at.getMinutes();
  }

  function minutesOf(time) {
    var parts = String(time || '').split(':');
    if (parts.length !== 2) return -1;
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  function eventRow(item, state) {
    var row = document.createElement('li');
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'event-item' + (state ? ' is-' + state : '');
    button.dataset.event = item.id;
    button.dataset.date = item.date;
    // The colour you gave it, which until now only showed on the Calendar.
    if (item.color) button.dataset.color = item.color;

    var time = document.createElement('span');
    time.className = 'event-time';
    time.textContent = formatTime(item.time);

    var body = document.createElement('span');
    body.className = 'event-body';
    var title = document.createElement('span');
    title.className = 'event-title';
    title.textContent = item.title;
    body.appendChild(title);
    if (state === 'next') {
      var badge = document.createElement('span');
      badge.className = 'next-mark';
      badge.textContent = 'Next';
      title.appendChild(document.createTextNode(' '));
      title.appendChild(badge);
    }
    if (item.repeating) {
      var repeat = document.createElement('span');
      repeat.className = 'repeat-mark';
      repeat.textContent = 'repeats';
      title.appendChild(document.createTextNode(' '));
      title.appendChild(repeat);
    }
    if (item.details) {
      var details = document.createElement('p');
      details.className = 'event-details';
      details.textContent = item.details;
      body.appendChild(details);
    }

    button.appendChild(time);
    button.appendChild(body);
    row.appendChild(button);
    return row;
  }

  function renderEvents() {
    var events = Store.eventsOn(Store.todayKey());
    els.events.innerHTML = '';
    if (!events.length) {
      var empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'Nothing scheduled today.';
      els.events.appendChild(empty);
      return;
    }

    var now = minutesNow();
    // The first timed event still to come. Untimed ones sit at the top of the
    // day and are neither past nor next — they have no time to be either.
    var nextIndex = -1;
    events.forEach(function (item, index) {
      var at = minutesOf(item.time);
      if (nextIndex === -1 && at >= 0 && at >= now) nextIndex = index;
    });

    var fragment = document.createDocumentFragment();
    var drawnLine = false;
    events.forEach(function (item, index) {
      var at = minutesOf(item.time);
      var state = '';
      if (at >= 0) state = index === nextIndex ? 'next' : (at < now ? 'past' : '');

      // One line, where the day is up to — between what has gone and what has
      // not. Only worth drawing if there is something on each side of it.
      if (!drawnLine && index === nextIndex && index > 0) {
        drawnLine = true;
        fragment.appendChild(nowLine());
      }
      fragment.appendChild(eventRow(item, state));
    });
    // Everything today has already happened: the line belongs at the end.
    if (!drawnLine && nextIndex === -1) fragment.appendChild(nowLine());

    els.events.appendChild(fragment);
  }

  // What counts as past and next changes on its own, so the screen has to as
  // well. One timer, only while Today is the screen you are looking at.
  var ticker = null;
  var lastMinute = -1;

  function watchTheClock() {
    if (ticker) return;
    lastMinute = minutesNow();
    ticker = setInterval(function () {
      var view = document.getElementById('view-today');
      if (!view || view.hidden || document.hidden) return;
      var minute = minutesNow();
      if (minute === lastMinute) return;
      lastMinute = minute;
      renderEvents();
      renderDate();
    }, 15000);
  }

  function nowLine() {
    var row = document.createElement('li');
    row.className = 'now-line';
    var label = document.createElement('span');
    label.textContent = Fmt.clock(new Date());
    row.appendChild(label);
    return row;
  }

  function renderTasks() {
    var today = Store.todayKey();
    var due = Store.tasksDue(today);

    // An empty list on the home screen feels broken, so show what is coming
    // up next instead of nothing at all.
    if (!due.length) {
      var upcoming = Store.allTasks({ openOnly: true }).filter(function (task) {
        return task.due && task.due > today;
      }).slice(0, 3);
      if (upcoming.length) {
        els.tasksHead.textContent = 'Coming up';
        TasksView.fillList(els.tasks, upcoming, '');
        return;
      }
    }
    els.tasksHead.textContent = 'Tasks';
    TasksView.fillList(els.tasks, due, 'Nothing due today.');
  }

  function renderNotes() {
    var notes = Store.allNotes().slice(0, 4);
    els.notes.innerHTML = '';
    if (!notes.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No notes yet.';
      els.notes.appendChild(empty);
      return;
    }
    var fragment = document.createDocumentFragment();
    notes.forEach(function (note) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'note-chip';
      card.dataset.note = note.id;
      var title = document.createElement('span');
      title.className = 'note-chip-title';
      title.textContent = note.title.trim() || 'Untitled note';
      var text = document.createElement('span');
      text.className = 'note-chip-text';
      text.textContent = note.body.trim() || 'Empty';
      card.appendChild(title);
      card.appendChild(text);
      fragment.appendChild(card);
    });
    els.notes.appendChild(fragment);
  }

  /* --------------------------------------------------------------- search -- */

  function resultGroup(title, items, build) {
    if (!items.length) return null;
    var section = document.createElement('section');
    section.className = 'result-group';
    var heading = document.createElement('h2');
    heading.textContent = title;
    section.appendChild(heading);
    var list = document.createElement('ul');
    list.className = 'result-list';
    items.forEach(function (item) { list.appendChild(build(item)); });
    section.appendChild(list);
    return section;
  }

  function resultRow(label, sub, dataset) {
    var row = document.createElement('li');
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'result-item';
    Object.keys(dataset).forEach(function (key) { button.dataset[key] = dataset[key]; });
    var main = document.createElement('span');
    main.className = 'result-title';
    main.textContent = label;
    button.appendChild(main);
    if (sub) {
      var meta = document.createElement('span');
      meta.className = 'result-meta';
      meta.textContent = sub;
      button.appendChild(meta);
    }
    row.appendChild(button);
    return row;
  }

  function renderSearch() {
    var hits = Store.search(query);
    els.results.innerHTML = '';

    var groups = [
      resultGroup('Events', hits.events, function (item) {
        var when = Store.fromKey(item.date).toLocaleDateString(undefined, {
          weekday: 'short', day: 'numeric', month: 'short'
        });
        return resultRow(item.title, when + (item.time ? ' · ' + formatTime(item.time) : ''),
          { event: item.id, date: item.date });
      }),
      resultGroup('Tasks', hits.tasks, function (task) {
        return resultRow(task.title, task.done ? 'Done' : (task.due ? 'Due ' + task.due : 'No date'),
          { task: task.id });
      }),
      resultGroup('Notes', hits.notes, function (note) {
        return resultRow(note.title.trim() || 'Untitled note',
          note.body.trim().slice(0, 80), { note: note.id });
      })
    ].filter(Boolean);

    if (!groups.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'Nothing matches “' + query + '”.';
      els.results.appendChild(empty);
      return;
    }
    groups.forEach(function (group) { els.results.appendChild(group); });
  }

  function render() {
    if (query) {
      els.body.hidden = true;
      els.results.hidden = false;
      renderSearch();
      return;
    }
    els.results.hidden = true;
    els.body.hidden = false;
    renderDate();
    renderEvents();
    renderTasks();
    renderNotes();
    watchTheClock();
  }

  /* ------------------------------------------------------------------ init -- */

  // Every clickable thing on this screen opens the editor that owns it.
  function handleClick(clickEvent) {
    var event = clickEvent.target.closest('[data-event]');
    if (event) return CalendarView.editEvent(event.dataset.event, event.dataset.date);

    var task = clickEvent.target.closest('[data-task]');
    if (task) return TasksView.openTask(task.dataset.task);

    var note = clickEvent.target.closest('[data-note]');
    if (note) return NotesView.openNote(note.dataset.note);
  }

  function init() {
    els = {
      view: document.getElementById('view-today'),
      body: document.getElementById('today-body'),
      date: document.getElementById('today-date'),
      dayNumber: document.getElementById('today-day'),
      summary: document.getElementById('today-summary'),
      events: document.getElementById('today-events'),
      tasks: document.getElementById('today-tasks'),
      tasksHead: document.querySelector('#today-tasks').closest('.today-card').querySelector('h2'),
      notes: document.getElementById('today-notes'),
      search: document.getElementById('global-search'),
      results: document.getElementById('search-results')
    };

    els.search.addEventListener('input', function () {
      query = els.search.value.trim();
      render();
    });

    TasksView.wireList(els.tasks);
    els.view.addEventListener('click', handleClick);

    els.view.addEventListener('click', function (clickEvent) {
      var add = clickEvent.target.closest('[data-add]');
      if (!add) return;
      if (add.dataset.add === 'event') CalendarView.newEvent(Store.todayKey());
      else if (add.dataset.add === 'task') TasksView.newTask(Store.todayKey());
      else NotesView.newNote();
    });

    render();
  }

  return {
    init: init,
    render: render,
    clearSearch: function () {
      query = '';
      if (els.search) els.search.value = '';
    }
  };
})();
