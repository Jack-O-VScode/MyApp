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
    els.date.textContent = today.toLocaleDateString(undefined, {
      weekday: 'long', day: 'numeric', month: 'long'
    });
  }

  function eventRow(item) {
    var row = document.createElement('li');
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'event-item';
    button.dataset.event = item.id;
    button.dataset.date = item.date;

    var time = document.createElement('span');
    time.className = 'event-time';
    time.textContent = formatTime(item.time);

    var body = document.createElement('span');
    body.className = 'event-body';
    var title = document.createElement('span');
    title.className = 'event-title';
    title.textContent = item.title;
    body.appendChild(title);
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
    var fragment = document.createDocumentFragment();
    events.forEach(function (item) { fragment.appendChild(eventRow(item)); });
    els.events.appendChild(fragment);
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
      events: document.getElementById('today-events'),
      tasks: document.getElementById('today-tasks'),
      tasksHead: document.querySelector('#view-today .today-card:nth-of-type(2) h2'),
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
