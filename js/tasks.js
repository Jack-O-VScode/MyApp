/* Task list, the task editor, and the row renderer the Today and Calendar
   screens reuse so a task looks and behaves the same everywhere. */
window.TasksView = (function () {
  'use strict';

  var els = {};
  var editingId = null;
  var lastFocused = null;
  var filter = 'open';
  var query = '';
  // The editor works on a copy, so Cancel really does leave the steps alone.
  var draftSubtasks = [];
  var draftPriority = 0;

  var PRIORITY_NAMES = ['', 'Low', 'Medium', 'High'];

  /* ------------------------------------------------------------- helpers -- */

  function dueLabel(task) {
    if (!task.due) return '';
    var today = Store.todayKey();
    if (task.due === today) return 'Today';
    if (task.due === Store.shiftKey(today, 1)) return 'Tomorrow';
    if (task.due === Store.shiftKey(today, -1)) return 'Yesterday';

    var date = Store.fromKey(task.due);
    var sameYear = date.getFullYear() === new Date().getFullYear();
    return date.toLocaleDateString(undefined, sameYear
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function dueState(task) {
    if (!task.due || task.done) return '';
    var today = Store.todayKey();
    if (task.due < today) return 'overdue';
    if (task.due === today) return 'today';
    return '';
  }

  // The due badge and the repeat marker share one line under the title.
  function badgeRow(parent) {
    var row = parent.querySelector('.task-badges');
    if (!row) {
      row = document.createElement('span');
      row.className = 'task-badges';
      parent.appendChild(row);
    }
    return row;
  }

  // Shared by the Tasks list, the Today screen and the calendar day panel.
  // `options.hideDueFor` drops the date badge when the list is already grouped
  // under that date — but keeps it for an overdue task listed under today.
  function buildRow(task, options) {
    var row = document.createElement('li');
    row.className = 'task-item' + (task.done ? ' is-done' : '');

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'task-check';
    toggle.dataset.toggle = task.id;
    toggle.setAttribute('role', 'checkbox');
    toggle.setAttribute('aria-checked', task.done ? 'true' : 'false');
    toggle.setAttribute('aria-label', (task.done ? 'Mark unfinished: ' : 'Mark done: ') + task.title);
    toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';

    var open = document.createElement('button');
    open.type = 'button';
    open.className = 'task-open';
    open.dataset.open = task.id;

    var title = document.createElement('span');
    title.className = 'task-title';
    title.textContent = task.title || 'Untitled task';
    open.appendChild(title);

    var state = dueState(task);
    var redundant = options && options.hideDueFor && task.due === options.hideDueFor;
    if (task.due && !redundant) {
      var badge = document.createElement('span');
      badge.className = 'task-due' + (state ? ' is-' + state : '');
      badge.textContent = state === 'overdue' ? 'Overdue · ' + dueLabel(task) : dueLabel(task);
      badgeRow(open).appendChild(badge);
    }
    if (task.priority) {
      var flag = document.createElement('span');
      flag.className = 'prio-mark is-p' + task.priority;
      flag.textContent = PRIORITY_NAMES[task.priority];
      badgeRow(open).appendChild(flag);
    }
    if (task.repeat) {
      var repeat = document.createElement('span');
      repeat.className = 'repeat-mark';
      repeat.textContent = 'repeats';
      badgeRow(open).appendChild(repeat);
    }
    var steps = Store.subtaskProgress(task);
    if (steps) {
      var count = document.createElement('span');
      count.className = 'repeat-mark' + (steps.done === steps.total ? ' is-complete' : '');
      count.textContent = steps.done + '/' + steps.total + ' steps';
      badgeRow(open).appendChild(count);
    }
    if (task.remindTime && !task.done) {
      var bell = document.createElement('span');
      bell.className = 'repeat-mark';
      bell.textContent = '⏰ ' + Fmt.time(task.remindTime);
      badgeRow(open).appendChild(bell);
    }
    if (task.details) {
      var details = document.createElement('span');
      details.className = 'task-details';
      details.textContent = task.details;
      open.appendChild(details);
    }

    row.appendChild(toggle);
    row.appendChild(open);
    return row;
  }

  function fillList(node, tasks, emptyText, options) {
    node.innerHTML = '';
    if (!tasks.length) {
      var empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = emptyText;
      node.appendChild(empty);
      return;
    }
    var fragment = document.createDocumentFragment();
    tasks.forEach(function (task) { fragment.appendChild(buildRow(task, options)); });
    node.appendChild(fragment);
  }

  // One handler covers a whole list: tick a box, or open the editor.
  function wireList(node) {
    node.addEventListener('click', function (clickEvent) {
      var toggle = clickEvent.target.closest('[data-toggle]');
      if (toggle) {
        var result = Store.toggleTask(toggle.dataset.toggle);
        if (result && result.advancedTo && window.App && App.toast) {
          App.toast('Done — next on ' + Store.fromKey(result.advancedTo)
            .toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }));
        }
        return;
      }
      var open = clickEvent.target.closest('[data-open]');
      if (open) openEditor(open.dataset.open);
    });
  }

  /* -------------------------------------------------------------- editor -- */

  function openEditor(id, dueDate) {
    editingId = id || null;
    lastFocused = document.activeElement;
    var task = id ? Store.getTask(id) : null;

    els.modalTitle.textContent = task ? 'Edit task' : 'New task';
    els.title.value = task ? task.title : '';
    els.due.value = task ? task.due : (dueDate || '');
    els.details.value = task ? task.details : '';
    els.repeat.value = task ? (task.repeat || '') : '';
    els.remind.value = task ? (task.remindTime || '') : '';
    draftPriority = task ? task.priority : 0;
    draftSubtasks = task ? task.subtasks.map(function (sub) {
      return { id: sub.id, title: sub.title, done: sub.done };
    }) : [];
    els.subtaskNew.value = '';
    renderPriority();
    renderSubtasks();
    els.delete.hidden = !task;
    els.error.hidden = true;
    syncRepeatField();

    els.modal.hidden = false;
    els.title.focus();
  }

  function closeEditor() {
    els.modal.hidden = true;
    editingId = null;
    if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
    lastFocused = null;
  }

  function submit(formEvent) {
    formEvent.preventDefault();
    var title = els.title.value.trim();
    if (!title) {
      els.error.textContent = 'Give the task a name.';
      els.error.hidden = false;
      return;
    }
    // A step typed but not yet added is still a step.
    addSubtask();
    readSubtaskTitles();
    Store.saveTask({
      id: editingId,
      title: title,
      due: els.due.value,
      details: els.details.value.trim(),
      repeat: els.repeat.value,
      priority: draftPriority,
      subtasks: draftSubtasks,
      remindTime: els.remind.value
    });
    closeEditor();
  }

  /* ----------------------------------------------------- priority, steps -- */

  function renderPriority() {
    Array.prototype.forEach.call(els.priority.querySelectorAll('[data-priority]'), function (button) {
      var on = Number(button.dataset.priority) === draftPriority;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  // Titles are edited in place, so read them back before anything redraws.
  function readSubtaskTitles() {
    Array.prototype.forEach.call(els.subtasks.querySelectorAll('[data-sub-title]'), function (input) {
      var sub = draftSubtasks.filter(function (item) { return item.id === input.dataset.subTitle; })[0];
      if (sub) sub.title = input.value;
    });
  }

  function renderSubtasks() {
    els.subtasks.innerHTML = '';
    draftSubtasks.forEach(function (sub) {
      var row = document.createElement('li');
      row.className = 'subtask' + (sub.done ? ' is-done' : '');

      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = sub.done;
      box.dataset.subToggle = sub.id;
      box.setAttribute('aria-label', 'Done: ' + sub.title);

      var text = document.createElement('input');
      text.type = 'text';
      text.value = sub.title;
      text.maxLength = 200;
      text.dataset.subTitle = sub.id;
      text.setAttribute('aria-label', 'Step');

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-button small';
      remove.dataset.subRemove = sub.id;
      remove.setAttribute('aria-label', 'Remove step');
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';

      row.appendChild(box);
      row.appendChild(text);
      row.appendChild(remove);
      els.subtasks.appendChild(row);
    });
  }

  function addSubtask() {
    var title = els.subtaskNew.value.trim();
    if (!title) return false;
    readSubtaskTitles();
    draftSubtasks.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: title,
      done: false
    });
    els.subtaskNew.value = '';
    renderSubtasks();
    return true;
  }

  function removeTask() {
    if (!editingId) return;
    if (!window.confirm('Delete this task?')) return;
    Store.deleteTask(editingId);
    closeEditor();
  }

  // Repeating from nothing is meaningless, so the rule follows the due date.
  function syncRepeatField() {
    var hasDate = Store.isKey(els.due.value);
    els.repeat.disabled = !hasDate;
    if (!hasDate) els.repeat.value = '';
    els.repeatField.classList.toggle('is-muted', !hasDate);
    // Same for the reminder: "at nine" needs a day to be nine on.
    els.remind.disabled = !hasDate;
    if (!hasDate) els.remind.value = '';
    els.remindField.classList.toggle('is-muted', !hasDate);
  }

  /* ------------------------------------------------------------ quick add -- */

  function quickHint() {
    var text = els.quickTitle.value.trim();
    var parsed = text ? QuickParse.parse(text) : null;
    var bits = parsed ? QuickParse.describe(parsed, 'task') : [];
    els.quickHint.hidden = !bits.length;
    if (bits.length) els.quickHint.textContent = '“' + parsed.title + '” · ' + bits.join(' · ');
  }

  /* ------------------------------------------------------------- the view -- */

  function render() {
    var sort = Store.getSettings().taskSort;
    var tasks = Store.allTasks({ query: query, openOnly: filter === 'open', sort: sort });
    var emptyText = query
      ? 'No tasks match “' + query + '”.'
      : (filter === 'open' ? 'Nothing to do. Enjoy it.' : 'No tasks yet.');
    fillList(els.list, tasks, emptyText);

    var doneCount = Store.allTasks({}).filter(function (task) { return task.done; }).length;
    els.clearDone.hidden = doneCount === 0;
    els.clearDone.textContent = 'Clear ' + doneCount + ' finished';

    Array.prototype.forEach.call(els.filters.querySelectorAll('[data-filter]'), function (chip) {
      chip.classList.toggle('is-on', chip.dataset.filter === filter);
    });
    Array.prototype.forEach.call(els.sort.querySelectorAll('[data-sort]'), function (chip) {
      chip.classList.toggle('is-on', chip.dataset.sort === sort);
    });
  }

  function init() {
    els = {
      list: document.getElementById('task-list'),
      filters: document.querySelector('#view-tasks .task-filters'),
      clearDone: document.getElementById('clear-done'),
      search: document.getElementById('task-search'),
      quickForm: document.getElementById('quick-task'),
      quickTitle: document.getElementById('quick-task-title'),
      modal: document.getElementById('task-modal'),
      modalTitle: document.getElementById('task-modal-title'),
      title: document.getElementById('task-title'),
      due: document.getElementById('task-due'),
      details: document.getElementById('task-details'),
      repeat: document.getElementById('task-repeat'),
      repeatField: document.getElementById('task-repeat-field'),
      remind: document.getElementById('task-remind'),
      remindField: document.getElementById('task-remind-field'),
      priority: document.getElementById('task-priority'),
      subtasks: document.getElementById('task-subtasks'),
      subtaskNew: document.getElementById('task-subtask-new'),
      sort: document.getElementById('task-sort'),
      quickHint: document.getElementById('quick-task-hint'),
      delete: document.getElementById('task-delete'),
      error: document.getElementById('task-error')
    };

    wireList(els.list);

    els.search.addEventListener('input', function () {
      query = els.search.value.trim();
      render();
    });

    els.quickForm.addEventListener('submit', function (formEvent) {
      formEvent.preventDefault();
      var text = els.quickTitle.value.trim();
      if (!text) return;
      // "Pay rent every month on the 1st !high" is a title, a date, a repeat
      // and a priority; a time becomes the reminder on the due date.
      var parsed = QuickParse.parse(text);
      Store.saveTask({
        title: parsed.title,
        due: parsed.date,
        details: '',
        repeat: parsed.repeat,
        priority: parsed.priority,
        remindTime: parsed.time
      });
      els.quickTitle.value = '';
      quickHint();
      els.quickTitle.focus();
    });
    els.quickTitle.addEventListener('input', quickHint);

    els.sort.addEventListener('click', function (clickEvent) {
      var chip = clickEvent.target.closest('[data-sort]');
      if (!chip) return;
      Store.saveSettings({ taskSort: chip.dataset.sort });
      render();
    });

    els.priority.addEventListener('click', function (clickEvent) {
      var button = clickEvent.target.closest('[data-priority]');
      if (!button) return;
      draftPriority = Number(button.dataset.priority);
      renderPriority();
    });

    els.subtasks.addEventListener('change', function (changeEvent) {
      var id = changeEvent.target.dataset.subToggle;
      if (!id) return;
      var sub = draftSubtasks.filter(function (item) { return item.id === id; })[0];
      if (sub) sub.done = changeEvent.target.checked;
      changeEvent.target.closest('.subtask').classList.toggle('is-done', changeEvent.target.checked);
    });
    els.subtasks.addEventListener('click', function (clickEvent) {
      var remove = clickEvent.target.closest('[data-sub-remove]');
      if (!remove) return;
      readSubtaskTitles();
      draftSubtasks = draftSubtasks.filter(function (item) { return item.id !== remove.dataset.subRemove; });
      renderSubtasks();
    });
    // Enter in a step box adds the step rather than saving the whole task.
    els.subtaskNew.addEventListener('keydown', function (keyEvent) {
      if (keyEvent.key !== 'Enter') return;
      keyEvent.preventDefault();
      addSubtask();
    });
    els.subtasks.addEventListener('keydown', function (keyEvent) {
      if (keyEvent.key === 'Enter' && keyEvent.target.dataset.subTitle) {
        keyEvent.preventDefault();
        els.subtaskNew.focus();
      }
    });
    document.getElementById('task-subtask-add').addEventListener('click', function () {
      addSubtask();
      els.subtaskNew.focus();
    });

    els.filters.addEventListener('click', function (clickEvent) {
      var chip = clickEvent.target.closest('[data-filter]');
      if (!chip) return;
      filter = chip.dataset.filter;
      render();
    });

    els.clearDone.addEventListener('click', function () {
      var count = Store.allTasks({}).filter(function (task) { return task.done; }).length;
      if (!count) return;
      if (!window.confirm('Remove ' + count + ' finished task' + (count === 1 ? '' : 's') + '?')) return;
      Store.clearDoneTasks();
    });

    document.getElementById('task-form').addEventListener('submit', submit);
    document.getElementById('task-cancel').addEventListener('click', closeEditor);
    els.delete.addEventListener('click', removeTask);
    els.modal.addEventListener('mousedown', function (clickEvent) {
      if (clickEvent.target === els.modal) closeEditor();
    });

    // The chips under the due date are the fast path most tasks need.
    els.modal.querySelector('.quick-dates').addEventListener('click', function (clickEvent) {
      var chip = clickEvent.target.closest('[data-due]');
      if (!chip) return;
      var offset = chip.dataset.due;
      els.due.value = offset === '' ? '' : Store.shiftKey(Store.todayKey(), Number(offset));
      syncRepeatField();
    });
    els.due.addEventListener('change', syncRepeatField);

    render();
  }

  return {
    init: init,
    render: render,
    buildRow: buildRow,
    fillList: fillList,
    wireList: wireList,
    newTask: function (dueDate) { openEditor(null, dueDate); },
    openTask: openEditor,
    isModalOpen: function () { return !els.modal.hidden; },
    closeModal: closeEditor
  };
})();
