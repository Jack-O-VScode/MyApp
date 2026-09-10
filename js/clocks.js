/* The Timezones screen: what time it is elsewhere.

   Everything comes from Intl, so daylight saving is always right and there is
   no offset table to go stale. Pins live in the synced settings, which means
   the cities you care about are already at the top on every device.
*/
window.ClocksView = (function () {
  'use strict';

  var els = {};
  var query = '';
  var ticker = null;
  var lastMinute = -1;

  // Many cities share one IANA zone, and they are listed separately on
  // purpose — so a pin, and every element the ticker updates, is keyed by the
  // city rather than the zone. Keying by zone would pin Seattle and Las Vegas
  // the moment you starred Los Angeles.
  function keyOf(entry) {
    return entry[0] + '|' + entry[2];
  }

  /* --------------------------------------------------------------- clock -- */

  // Minutes a zone is ahead of UTC, worked out by formatting one instant in
  // that zone and reading it back.
  function offsetMinutes(zone, at) {
    var parts = formatterFor(zone, 'offset', {
      locale: 'en-US',
      opts: {
        timeZone: zone, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      }
    }).formatToParts(at).reduce(function (all, part) {
      all[part.type] = part.value;
      return all;
    }, {});

    var asUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
    );
    return Math.round((asUtc - at.getTime()) / 60000);
  }

  // Building an Intl formatter is the costly part, and there are 250 rows —
  // so each zone's formatters are made once and kept.
  var formatters = {};

  function formatterFor(zone, kind, options) {
    var key = zone + '|' + kind;
    if (!formatters[key]) {
      formatters[key] = new Intl.DateTimeFormat(options.locale, options.opts);
    }
    return formatters[key];
  }

  function timeIn(zone, at) {
    return Fmt.clockIn(zone, at);
  }

  function dayIn(zone, at) {
    return formatterFor(zone, 'day', {
      locale: 'en-CA',
      opts: { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }
    }).format(at);
  }

  function weekdayIn(zone, at) {
    return formatterFor(zone, 'weekday', {
      locale: undefined,
      opts: { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short' }
    }).format(at);
  }

  // "+8h", "−7h 30m", or a plain note when it matches where you are.
  function describeDifference(zone, at) {
    var delta = offsetMinutes(zone, at) + at.getTimezoneOffset();
    if (delta === 0) return { text: 'Same time as here', state: 'same' };

    var sign = delta > 0 ? '+' : '−';
    var total = Math.abs(delta);
    var hours = Math.floor(total / 60);
    var minutes = total % 60;
    var amount = hours + 'h' + (minutes ? ' ' + minutes + 'm' : '');
    return { text: sign + amount, state: delta > 0 ? 'ahead' : 'behind' };
  }

  function dayNote(zone, at) {
    var here = dayIn(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', at);
    var there = dayIn(zone, at);
    if (there === here) return '';
    return there > here ? 'Tomorrow' : 'Yesterday';
  }

  /* ------------------------------------------------------------ the list -- */

  function pinned() {
    return Store.getSettings().pinnedCities;
  }

  function matches(entry, needle) {
    return (entry[0] + ' ' + entry[1] + ' ' + entry[2]).toLowerCase().indexOf(needle) !== -1;
  }

  function visibleEntries() {
    var pins = pinned();
    var needle = query.toLowerCase();
    var found = query ? window.ZONES.filter(function (entry) { return matches(entry, needle); })
                      : window.ZONES.slice();

    // Pinned cities sit at the top in the order they were pinned; a search
    // still narrows them, so pinning does not trap a city on screen.
    var isPinned = function (entry) { return pins.indexOf(keyOf(entry)) !== -1; };
    var top = [];
    pins.forEach(function (key) {
      found.forEach(function (entry) {
        if (keyOf(entry) === key) top.push(entry);
      });
    });
    var rest = found.filter(function (entry) { return !isPinned(entry); });
    return { pinned: top, rest: rest };
  }

  function row(entry, at, isPinned) {
    var difference = describeDifference(entry[2], at);
    var note = dayNote(entry[2], at);

    var item = document.createElement('li');
    item.className = 'zone-row' + (isPinned ? ' is-pinned' : '');
    item.dataset.zone = entry[2];
    item.dataset.key = keyOf(entry);

    var star = document.createElement('button');
    star.type = 'button';
    star.className = 'zone-star' + (isPinned ? ' is-on' : '');
    star.dataset.pin = keyOf(entry);
    star.setAttribute('aria-pressed', isPinned ? 'true' : 'false');
    star.setAttribute('aria-label', (isPinned ? 'Unpin ' : 'Pin ') + entry[0]);
    star.textContent = isPinned ? '★' : '☆';

    var body = document.createElement('div');
    body.className = 'zone-body';
    var city = document.createElement('span');
    city.className = 'zone-city';
    city.textContent = entry[0];
    var area = document.createElement('span');
    area.className = 'zone-area';
    area.textContent = entry[1];
    body.appendChild(city);
    body.appendChild(area);

    var right = document.createElement('div');
    right.className = 'zone-right';
    var time = document.createElement('span');
    time.className = 'zone-time';
    time.dataset.tz = entry[2];
    time.textContent = timeIn(entry[2], at);
    var meta = document.createElement('span');
    meta.className = 'zone-meta is-' + difference.state;
    meta.dataset.tz = entry[2];
    meta.textContent = note ? note + ' · ' + difference.text : difference.text;
    right.appendChild(time);
    right.appendChild(meta);

    item.appendChild(star);
    item.appendChild(body);
    item.appendChild(right);
    return item;
  }

  function section(title, entries, at, isPinned) {
    if (!entries.length) return null;
    var wrap = document.createElement('section');
    wrap.className = 'zone-group';
    if (title) {
      var heading = document.createElement('h2');
      heading.className = 'zone-heading';
      heading.textContent = title;
      wrap.appendChild(heading);
    }
    var list = document.createElement('ul');
    list.className = 'zone-list';
    entries.forEach(function (entry) { list.appendChild(row(entry, at, isPinned)); });
    wrap.appendChild(list);
    return wrap;
  }

  function render() {
    var at = new Date();
    lastMinute = Math.floor(at.getTime() / 60000);
    var groups = visibleEntries();

    els.here.textContent = 'Your time · ' +
      timeIn(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', at) + ' · ' +
      weekdayIn(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', at);

    els.list.innerHTML = '';
    var pinnedBlock = section(groups.pinned.length ? 'Pinned' : '', groups.pinned, at, true);
    if (pinnedBlock) els.list.appendChild(pinnedBlock);

    var restBlock = section(groups.pinned.length ? 'All cities' : '', groups.rest, at, false);
    if (restBlock) els.list.appendChild(restBlock);

    if (!groups.pinned.length && !groups.rest.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No city matches “' + query + '”.';
      els.list.appendChild(empty);
    }

    els.count.textContent = query
      ? (groups.pinned.length + groups.rest.length) + ' of ' + window.ZONES.length
      : window.ZONES.length + ' cities';
  }

  // Only the clock faces change second to second — rebuilding 250 rows for
  // that would be silly. Each element carries its own zone, so cities sharing
  // one all get updated rather than just the first.
  function tick() {
    var at = new Date();
    var cache = {};

    Array.prototype.forEach.call(els.list.querySelectorAll('.zone-time[data-tz]'), function (node) {
      var zone = node.dataset.tz;
      if (!cache[zone]) cache[zone] = { time: timeIn(zone, at), note: dayNote(zone, at), diff: describeDifference(zone, at) };
      node.textContent = cache[zone].time;
    });

    Array.prototype.forEach.call(els.list.querySelectorAll('.zone-meta[data-tz]'), function (node) {
      var zone = node.dataset.tz;
      if (!cache[zone]) cache[zone] = { time: timeIn(zone, at), note: dayNote(zone, at), diff: describeDifference(zone, at) };
      var entry = cache[zone];
      node.textContent = entry.note ? entry.note + ' · ' + entry.diff.text : entry.diff.text;
      node.className = 'zone-meta is-' + entry.diff.state;
    });
  }

  function startTicking() {
    if (ticker) return;
    // Checked every second so the change lands promptly, but the rows are only
    // rewritten when the displayed minute actually turns over.
    ticker = setInterval(function () {
      if (els.view.hidden || document.visibilityState !== 'visible') return;
      var minute = Math.floor(Date.now() / 60000);
      if (minute === lastMinute) return;
      lastMinute = minute;
      tick();
    }, 1000);
  }

  /* ----------------------------------------------------------------- api -- */

  function togglePin(key) {
    var pins = pinned();
    var at = pins.indexOf(key);
    if (at === -1) pins.push(key);
    else pins.splice(at, 1);
    Store.saveSettings({ pinnedCities: pins });
    render();
  }

  function init() {
    els = {
      view: document.getElementById('view-clocks'),
      search: document.getElementById('zone-search'),
      list: document.getElementById('zone-list'),
      here: document.getElementById('zone-here'),
      count: document.getElementById('zone-count')
    };

    els.search.addEventListener('input', function () {
      query = els.search.value.trim();
      render();
    });

    els.list.addEventListener('click', function (clickEvent) {
      var star = clickEvent.target.closest('[data-pin]');
      if (star) togglePin(star.dataset.pin);
    });

    render();
    startTicking();
  }

  return { init: init, render: render };
})();
