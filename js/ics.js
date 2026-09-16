/* Reading .ics calendar files.

   A .ics is what Google Calendar, Outlook and Apple Calendar all export, and
   what an airline or a hotel emails you. This turns one into events this app
   can store.

   The format is older and stranger than it looks, and three details account for
   most of the mess:

   - lines are "folded": a long value is broken across lines, and every
     continuation starts with a space or tab. Unfold before anything else or
     long titles come out cut in half.
   - a value is escaped — \\n for a newline, \\, for a comma — and a property can
     carry parameters after a semicolon: DTSTART;TZID=Asia/Singapore:2026...
   - a time is one of three things: a date with no time at all, an instant in
     UTC, or a wall-clock reading in a named zone. Each needs different handling
     to land on the right local day.

   Repeat rules are where honesty matters. iCalendar can express "the third
   Thursday of every month" and this app stores four rules; anything that does
   not fit is imported as the single event it starts from, and counted so the
   screen can say so rather than quietly losing it.
*/
window.ICS = (function () {
  'use strict';

  var REPEATS = ['daily', 'weekly', 'monthly', 'yearly'];

  /* ------------------------------------------------------------- unfolding -- */

  function unfold(text) {
    // CRLF, bare CR and LF all appear in the wild.
    var lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    lines.forEach(function (line) {
      if (out.length && /^[ \t]/.test(line)) out[out.length - 1] += line.slice(1);
      else out.push(line);
    });
    return out;
  }

  // "DTSTART;TZID=Europe/London:20260915T093000" ->
  //   { name: 'DTSTART', params: { TZID: 'Europe/London' }, value: '2026...' }
  function parseLine(line) {
    var colon = -1;
    var quoted = false;
    for (var i = 0; i < line.length; i++) {
      if (line.charAt(i) === '"') quoted = !quoted;
      else if (line.charAt(i) === ':' && !quoted) { colon = i; break; }
    }
    if (colon === -1) return null;

    var head = line.slice(0, colon).split(';');
    var params = {};
    head.slice(1).forEach(function (pair) {
      var eq = pair.indexOf('=');
      if (eq === -1) return;
      params[pair.slice(0, eq).toUpperCase()] = pair.slice(eq + 1).replace(/^"|"$/g, '');
    });

    return {
      name: head[0].toUpperCase(),
      params: params,
      value: line.slice(colon + 1)
    };
  }

  function unescape(value) {
    return String(value)
      .replace(/\\n/gi, '\n')
      .replace(/\\,/g, ',')
      .replace(/\;/g, ';')
      .replace(/\\\\/g, '\\');
  }

  /* ------------------------------------------------------------------ time -- */

  function pad(value) {
    return (value < 10 ? '0' : '') + value;
  }

  function keyOf(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function timeOf(date) {
    return pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  // What a given instant reads as on a clock in `zone`, as a UTC-based number.
  function wallClockIn(instant, zone) {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(instant).reduce(function (all, part) {
      all[part.type] = part.value;
      return all;
    }, {});
    return Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
  }

  // The inverse: a wall-clock reading in `zone` back to the instant it names.
  // Guess, read the guess back, and correct by how far it drifted from the
  // reading we wanted. Measured against the target every pass, not against the
  // last guess — otherwise the second pass undoes the first. Two passes settle
  // it for every zone, daylight saving included.
  function fromZone(fields, zone) {
    var target = Date.UTC(fields.year, fields.month - 1, fields.day,
      fields.hour, fields.minute, fields.second);
    var guess = target;
    for (var pass = 0; pass < 2; pass++) {
      guess -= wallClockIn(new Date(guess), zone) - target;
    }
    return new Date(guess);
  }

  function parseStamp(property) {
    var raw = String(property.value).trim();
    var match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(raw);
    if (!match) return null;

    var fields = {
      year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
      hour: Number(match[4] || 0), minute: Number(match[5] || 0),
      second: Number(match[6] || 0)
    };
    var dateOnly = !match[4] || property.params.VALUE === 'DATE';

    if (dateOnly) {
      // An all-day event has no time to convert; the date is the date wherever
      // you are, and shifting it by a zone is how imports land a day out.
      return { at: new Date(fields.year, fields.month - 1, fields.day), allDay: true };
    }
    if (match[7]) {
      return { at: new Date(Date.UTC(fields.year, fields.month - 1, fields.day,
        fields.hour, fields.minute, fields.second)), allDay: false };
    }
    if (property.params.TZID) {
      try {
        return { at: fromZone(fields, property.params.TZID), allDay: false };
      } catch (err) {
        // An unknown zone name: fall through and read it as local.
      }
    }
    return { at: new Date(fields.year, fields.month - 1, fields.day,
      fields.hour, fields.minute, fields.second), allDay: false };
  }

  /* ------------------------------------------------------------- recurrence -- */

  var FREQ = {
    DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly'
  };

  // What of an RRULE this app can actually store. Anything else comes back null
  // and the event is imported as a single day.
  function parseRule(value, startsOn) {
    var rule = {};
    String(value).split(';').forEach(function (pair) {
      var eq = pair.indexOf('=');
      if (eq !== -1) rule[pair.slice(0, eq).toUpperCase()] = pair.slice(eq + 1);
    });

    var repeat = FREQ[String(rule.FREQ || '').toUpperCase()];
    if (!repeat) return null;

    // An interval other than 1 — "every other week" — has nowhere to live here.
    if (rule.INTERVAL && Number(rule.INTERVAL) !== 1) return null;

    // A weekly rule on exactly the day it already starts is the same thing this
    // app means by "weekly"; on any other set of days it is not.
    if (rule.BYDAY) {
      var days = rule.BYDAY.split(',');
      var DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
      if (repeat !== 'weekly' || days.length !== 1) return null;
      if (/\d/.test(days[0])) return null;            // "3TH" — third Thursday
      if (days[0] !== DAY_CODES[startsOn.getDay()]) return null;
    }
    // Positional and set-based rules have no equivalent either.
    if (rule.BYMONTHDAY || rule.BYSETPOS || rule.BYWEEKNO || rule.BYYEARDAY) return null;
    if (rule.BYMONTH && repeat !== 'yearly') return null;

    var until = '';
    if (rule.UNTIL) {
      var stop = parseStamp({ value: rule.UNTIL, params: {} });
      if (stop) until = keyOf(stop.at);
    }
    // COUNT is a limit this app cannot express; the series would run forever.
    if (rule.COUNT) return null;

    return { repeat: repeat, repeatUntil: until };
  }

  /* ----------------------------------------------------------------- events -- */

  function parse(text) {
    var events = [];
    var report = { total: 0, flattened: 0, skipped: 0, spanning: 0, cancelled: 0 };
    var current = null;

    unfold(text).forEach(function (line) {
      var upper = line.trim().toUpperCase();
      if (upper === 'BEGIN:VEVENT') { current = {}; return; }

      if (upper === 'END:VEVENT') {
        if (current) {
          report.total++;
          var outcome = build(current, report);
          if (outcome.event) events.push(outcome.event);
          // A cancelled event is already accounted for; it is not also unreadable.
          else if (outcome.reason !== 'cancelled') report.skipped++;
        }
        current = null;
        return;
      }
      if (!current) return;

      var property = parseLine(line);
      if (property) current[property.name] = property;
    });

    return { events: events, report: report };
  }

  function build(raw, report) {
    if (raw.STATUS && String(raw.STATUS.value).toUpperCase() === 'CANCELLED') {
      report.cancelled++;
      return { reason: 'cancelled' };
    }
    if (!raw.DTSTART) return { reason: 'unreadable' };

    var start = parseStamp(raw.DTSTART);
    if (!start) return { reason: 'unreadable' };

    var event = {
      title: raw.SUMMARY ? unescape(raw.SUMMARY.value).trim() : '',
      date: keyOf(start.at),
      time: start.allDay ? '' : timeOf(start.at),
      details: '',
      repeat: '',
      repeatUntil: ''
    };
    if (!event.title) event.title = '(untitled)';

    var details = [];
    if (raw.LOCATION) {
      var place = unescape(raw.LOCATION.value).trim();
      if (place) details.push(place);
    }
    if (raw.DESCRIPTION) {
      var body = unescape(raw.DESCRIPTION.value).trim();
      if (body) details.push(body);
    }

    // An event running across days is stored on the day it starts — this app
    // has no multi-day event — so the span is written down rather than lost.
    if (raw.DTEND) {
      var end = parseStamp(raw.DTEND);
      if (end) {
        var endKey = keyOf(start.allDay ? new Date(end.at.getTime() - 86400000) : end.at);
        if (endKey > event.date) {
          report.spanning++;
          details.unshift('Runs until ' + endKey + '.');
        }
      }
    }
    event.details = details.join('\n\n');

    if (raw.RRULE) {
      var rule = parseRule(raw.RRULE.value, start.at);
      if (rule) {
        event.repeat = rule.repeat;
        event.repeatUntil = rule.repeatUntil;
      } else {
        report.flattened++;
      }
    }
    // Individual exceptions to a series cannot be stored either.
    if (raw.EXDATE && event.repeat) report.flattened++;

    // The file's own id, so importing the same calendar twice updates rather
    // than duplicates. Namespaced, so it cannot collide with a local event.
    event.uid = raw.UID ? 'ics:' + unescape(raw.UID.value).trim() : '';
    return { event: event };
  }

  return {
    parse: parse,
    REPEATS: REPEATS,
    // Exposed so the tests can reach the fiddly parts directly.
    _unfold: unfold,
    _parseLine: parseLine,
    _parseStamp: parseStamp,
    _parseRule: parseRule
  };
})();
