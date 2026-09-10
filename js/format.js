/* Shared time formatting.

   Four modules render clock times, and App settings lets you pin the app to
   12- or 24-hour rather than letting each device's locale decide — which is the
   whole point when the same account is open on a phone from one country and a
   PC from another. One place to ask, so they cannot disagree.
*/
window.Fmt = (function () {
  'use strict';

  var formatters = {};

  // undefined hands the decision back to the locale, which is what Intl wants
  // for "follow the device".
  function hour12() {
    var choice = Store.getSettings().clock;
    if (choice === '12') return true;
    if (choice === '24') return false;
    return undefined;
  }

  // Memoised: building an Intl.DateTimeFormat is expensive and a month grid
  // asks for dozens. The setting is part of the key, so changing it is picked
  // up without having to clear anything.
  function formatter(name, options, zone) {
    var wanted = hour12();
    var key = name + '|' + (zone || '') + '|' + wanted;
    if (!formatters[key]) {
      var opts = {};
      Object.keys(options).forEach(function (option) { opts[option] = options[option]; });
      if (wanted !== undefined) opts.hour12 = wanted;
      if (zone) opts.timeZone = zone;
      formatters[key] = new Intl.DateTimeFormat(undefined, opts);
    }
    return formatters[key];
  }

  var CLOCK = { hour: 'numeric', minute: '2-digit' };

  // A stored "HH:MM" as the wall clock. Untimed entries say so instead.
  function time(value) {
    if (!value) return 'All day';
    var parts = String(value).split(':');
    var at = new Date(2000, 0, 1, Number(parts[0]), Number(parts[1]));
    return formatter('clock', CLOCK).format(at);
  }

  // A Date — a note's timestamp, say — as a clock time.
  function clock(at) {
    return formatter('clock', CLOCK).format(at);
  }

  // The same clock somewhere else, for the Timezones screen.
  function clockIn(zone, at) {
    return formatter('clock', CLOCK, zone).format(at);
  }

  return { time: time, clock: clock, clockIn: clockIn, hour12: hour12 };
})();
