/* Task list, the task editor, and the row renderer the Today and Calendar
   screens reuse so a task looks and behaves the same everywhere. */
window.TasksView = (function () {
  'use strict';

  var els = {};
  var editingId = null;
  var lastFocused = null;
  var filter = 'open';
  var query = '';

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
    if (task.repeat) {
      var repeat = document.createElement('span');
      repeat.className = 'repeat-mark';
      repeat.textContent = 'repeats';
      badgeRow(open).appendChild(repeat);
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
    Store.saveTask({
      id: editingId,
      title: title,
      due: els.due.value,
      details: els.details.value.trim(),
      repeat: els.repeat.value
    });
    closeEditor();
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
  }

  /* ------------------------------------------------------------- the view -- */

  function render() {
    var tasks = Store.allTasks({ query: query, openOnly: filter === 'open' });
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
      var title = els.quickTitle.value.trim();
      if (!title) return;
      Store.saveTask({ title: title, due: '', details: '' });
      els.quickTitle.value = '';
      els.quickTitle.focus();
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
