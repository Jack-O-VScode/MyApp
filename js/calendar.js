/* Month grid + the day panel + the event editor. */
window.CalendarView = (function () {
  'use strict';

  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MAX_CHIPS = 3;

  var els = {};
  var viewMonth;      // Date pinned to the 1st of the month on screen
  var selectedDate;   // 'YYYY-MM-DD'
  var editingId = null;
  var lastFocused = null;

  /* ---------------------------------------------------------- date bits -- */

  // Local-time key, deliberately not toISOString() — that shifts the day for
  // anyone east or west of UTC.
  function toKey(date) {
    var month = String(date.getMonth() + 1).padStart(2, '0');
    var day = String(date.getDate()).padStart(2, '0');
    return date.getFullYear() + '-' + month + '-' + day;
  }

  function fromKey(key) {
    var parts = key.split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function todayKey() {
    return toKey(new Date());
  }

  function formatMonth(date) {
    return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  var narrow = window.matchMedia('(max-width: 560px)');

  function formatDayLabel(key) {
    var date = fromKey(key);
    // Long names wrap on a phone, so abbreviate there.
    var label = date.toLocaleDateString(undefined, narrow.matches
      ? { weekday: 'short', day: 'numeric', month: 'short' }
      : { weekday: 'long', day: 'numeric', month: 'long' });
    if (key === todayKey()) return 'Today · ' + label;
    return label;
  }

  function formatTime(time) {
    if (!time) return 'All day';
    var parts = time.split(':');
    var date = new Date(2000, 0, 1, Number(parts[0]), Number(parts[1]));
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  /* ------------------------------------------------------------ rendering -- */

  function renderWeekdays() {
    els.weekdays.innerHTML = '';
    WEEKDAYS.forEach(function (name) {
      var cell = document.createElement('div');
      cell.textContent = name;
      els.weekdays.appendChild(cell);
    });
  }

  function renderGrid() {
    var year = viewMonth.getFullYear();
    var month = viewMonth.getMonth();
    var start = new Date(year, month, 1);
    var leading = start.getDay();
    start.setDate(1 - leading);                      // back up to the Sunday
    var today = todayKey();

    // Five or six weeks, whichever the month actually needs.
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var cells = Math.ceil((leading + daysInMonth) / 7) * 7;

    var first = toKey(start);
    var last = toKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + cells - 1));
    var byDate = {};
    Store.eventsInRange(first, last).forEach(function (item) {
      (byDate[item.date] = byDate[item.date] || []).push(item);
    });

    els.grid.innerHTML = '';
    var fragment = document.createDocumentFragment();

    for (var i = 0; i < cells; i++) {
      var date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var key = toKey(date);
      var events = byDate[key] || [];

      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'day';
      cell.dataset.date = key;
      cell.setAttribute('role', 'gridcell');
      if (date.getMonth() !== month) cell.classList.add('is-outside');
      if (key === today) cell.classList.add('is-today');
      if (key === selectedDate) {
        cell.classList.add('is-selected');
        cell.setAttribute('aria-current', 'date');
      }

      var label = date.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
      cell.setAttribute('aria-label', events.length
        ? label + ', ' + events.length + (events.length === 1 ? ' event' : ' events')
        : label);

      var number = document.createElement('span');
      number.className = 'day-number';
      number.textContent = date.getDate();
      cell.appendChild(number);

      events.slice(0, MAX_CHIPS).forEach(function (item) {
        var chip = document.createElement('span');
        chip.className = 'day-chip';
        chip.textContent = item.time ? formatTime(item.time) + ' ' + item.title : item.title;
        cell.appendChild(chip);
      });
      if (events.length > MAX_CHIPS) {
        var more = document.createElement('span');
        more.className = 'day-more';
        more.textContent = '+' + (events.length - MAX_CHIPS) + ' more';
        cell.appendChild(more);
      }

      // Narrow screens show dots instead of chips (see the stylesheet).
      if (events.length) {
        var dots = document.createElement('span');
        dots.className = 'day-dots';
        for (var d = 0; d < Math.min(events.length, 3); d++) {
          var dot = document.createElement('span');
          dot.className = 'day-dot';
          dots.appendChild(dot);
        }
        cell.appendChild(dots);
      }

      fragment.appendChild(cell);
    }

    els.grid.appendChild(fragment);
    els.monthLabel.textContent = formatMonth(viewMonth);
  }

  function renderDayPanel() {
    els.dayLabel.textContent = formatDayLabel(selectedDate);
    els.dayEvents.innerHTML = '';

    var events = Store.eventsOn(selectedDate);
    if (!events.length) {
      var empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'Nothing planned yet.';
      els.dayEvents.appendChild(empty);
      return;
    }

    events.forEach(function (item) {
      var row = document.createElement('li');
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'event-item';
      button.dataset.id = item.id;

      var time = document.createElement('span');
      time.className = 'event-time';
      time.textContent = formatTime(item.time);

      var body = document.createElement('span');
      body.className = 'event-body';
      var title = document.createElement('span');
      title.className = 'event-title';
      title.textContent = item.title;
      body.appendChild(title);
      if (item.details) {
        var details = document.createElement('p');
        details.className = 'event-details';
        details.textContent = item.details;
        body.appendChild(details);
      }

      button.appendChild(time);
      button.appendChild(body);
      row.appendChild(button);
      els.dayEvents.appendChild(row);
    });
  }

  function render() {
    renderGrid();
    renderDayPanel();
  }

  /* --------------------------------------------------------- event modal -- */

  function openModal(eventId, dateKey) {
    editingId = eventId || null;
    lastFocused = document.activeElement;
    var existing = eventId ? Store.getEvent(eventId) : null;

    els.modalTitle.textContent = existing ? 'Edit event' : 'New event';
    els.eventTitle.value = existing ? existing.title : '';
    els.eventDate.value = existing ? existing.date : (dateKey || selectedDate);
    els.eventTime.value = existing ? (existing.time || '') : '';
    els.eventDetails.value = existing ? (existing.details || '') : '';
    els.eventDelete.hidden = !existing;
    els.eventError.hidden = true;

    els.modal.hidden = false;
    els.eventTitle.focus();
  }

  function closeModal() {
    els.modal.hidden = true;
    editingId = null;
    if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
    lastFocused = null;
  }

  function isModalOpen() {
    return !els.modal.hidden;
  }

  function submit(submitEvent) {
    submitEvent.preventDefault();
    var title = els.eventTitle.value.trim();
    var date = els.eventDate.value;

    if (!title) return showError('Give the event a title.');
    // Safari on older iOS has no date picker widget, so validate the text.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return showError('Pick a valid date.');

    Store.saveEvent({
      id: editingId,
      title: title,
      date: date,
      time: els.eventTime.value || '',
      details: els.eventDetails.value.trim()
    });

    selectedDate = date;
    viewMonth = new Date(fromKey(date).getFullYear(), fromKey(date).getMonth(), 1);
    closeModal();
    render();
  }

  function showError(message) {
    els.eventError.textContent = message;
    els.eventError.hidden = false;
  }

  function removeEvent() {
    if (!editingId) return;
    if (!window.confirm('Delete this event?')) return;
    Store.deleteEvent(editingId);
    closeModal();
    render();
  }

  /* ----------------------------------------------------------------- api -- */

  function init() {
    els = {
      grid: document.getElementById('day-grid'),
      weekdays: document.getElementById('weekday-row'),
      monthLabel: document.getElementById('month-label'),
      dayLabel: document.getElementById('day-label'),
      dayEvents: document.getElementById('day-events'),
      modal: document.getElementById('event-modal'),
      modalTitle: document.getElementById('event-modal-title'),
      eventTitle: document.getElementById('event-title'),
      eventDate: document.getElementById('event-date'),
      eventTime: document.getElementById('event-time'),
      eventDetails: document.getElementById('event-details'),
      eventDelete: document.getElementById('event-delete'),
      eventError: document.getElementById('event-error')
    };

    selectedDate = todayKey();
    viewMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    renderWeekdays();

    // Rotating a phone switches between the long and short day label.
    if (narrow.addEventListener) narrow.addEventListener('change', renderDayPanel);
    else if (narrow.addListener) narrow.addListener(renderDayPanel);

    document.getElementById('prev-month').addEventListener('click', function () {
      viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1);
      render();
    });
    document.getElementById('next-month').addEventListener('click', function () {
      viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1);
      render();
    });
    document.getElementById('add-event').addEventListener('click', function () {
      openModal(null, selectedDate);
    });

    els.grid.addEventListener('click', function (clickEvent) {
      var cell = clickEvent.target.closest('.day');
      if (!cell) return;
      selectedDate = cell.dataset.date;
      var date = fromKey(selectedDate);
      if (date.getMonth() !== viewMonth.getMonth() || date.getFullYear() !== viewMonth.getFullYear()) {
        viewMonth = new Date(date.getFullYear(), date.getMonth(), 1);
      }
      render();
    });

    els.grid.addEventListener('dblclick', function (clickEvent) {
      var cell = clickEvent.target.closest('.day');
      if (cell) openModal(null, cell.dataset.date);
    });

    els.dayEvents.addEventListener('click', function (clickEvent) {
      var item = clickEvent.target.closest('.event-item');
      if (item) openModal(item.dataset.id);
    });

    document.getElementById('event-form').addEventListener('submit', submit);
    document.getElementById('event-cancel').addEventListener('click', closeModal);
    els.eventDelete.addEventListener('click', removeEvent);
    els.modal.addEventListener('mousedown', function (clickEvent) {
      if (clickEvent.target === els.modal) closeModal();
    });

    render();
  }

  return {
    init: init,
    render: render,
    isModalOpen: isModalOpen,
    closeModal: closeModal,
    goToday: function () {
      var now = new Date();
      selectedDate = toKey(now);
      viewMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      render();
    },
    newEvent: function () { openModal(null, selectedDate); }
  };
})();
