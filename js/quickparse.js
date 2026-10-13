/* Natural-language quick add: "Lunch with Sam fri 1pm" becomes an event on
   Friday at one, and "pay rent every month on the 1st !high" a repeating task.

   It reads a phrase at a time and takes each one out of the text as it goes,
   so whatever is left over is the title. Everything is deliberately cautious:
   a word only counts as a date or a time when it could hardly be anything else.
   "Buy sun cream" stays a title; "sun 10am" is a Sunday. And the screen always
   shows what was understood before anything is saved, so a misreading is seen
   rather than discovered next week.

   Plain function, no DOM, so the tests can run it under Node.
*/
window.QuickParse = (function () {
  'use strict';

  var DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  var DAY_SHORT = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
  var DAY_WORD = '(sunday|monday|tuesday|wednesday|thursday|friday|saturday|' +
    'sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat)';
  var MONTH_WORD = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|' +
    'aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  var COUNTS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10 };
  var ORDINAL = '(?:st|nd|rd|th)';
  var MERIDIEM = '(am|pm|a\\.m\\.|p\\.m\\.)';

  /* --------------------------------------------------------------- dates -- */

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function keyOf(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function midnight(now) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function plusDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }

  // Same day of the month `months` later, kept inside the shorter month.
  function plusMonths(date, months) {
    var target = new Date(date.getFullYear(), date.getMonth() + months, 1);
    var last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    return new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), last));
  }

  function dayIndex(word) {
    var lower = word.toLowerCase();
    var full = DAY_NAMES.indexOf(lower);
    return full !== -1 ? full : DAY_SHORT[lower];
  }

  function monthIndex(word) {
    return MONTHS.indexOf(word.slice(0, 3).toLowerCase());
  }

  // The next `weekday` from today, today included unless `strict`.
  function upcoming(today, weekday, strict) {
    var ahead = (weekday - today.getDay() + 7) % 7;
    if (strict && ahead === 0) ahead = 7;
    return plusDays(today, ahead);
  }

  // A real calendar date or nothing: 31 February is not quietly 3 March.
  function makeDate(year, month, day) {
    var date = new Date(year, month, day);
    return date.getMonth() === month && date.getDate() === day ? date : null;
  }

  // A day and month with no year means the next time it comes round.
  function withYear(today, month, day, year) {
    if (year) return makeDate(year < 100 ? 2000 + year : year, month, day);
    var date = makeDate(today.getFullYear(), month, day);
    if (date && date < today) date = makeDate(today.getFullYear() + 1, month, day);
    return date;
  }

  // The next date carrying this day of the month, skipping months without it.
  function nextDayOfMonth(today, day) {
    if (day < 1 || day > 31) return null;
    for (var step = 0; step < 13; step++) {
      var first = new Date(today.getFullYear(), today.getMonth() + step, 1);
      var date = makeDate(first.getFullYear(), first.getMonth(), day);
      if (date && date >= today) return date;
    }
    return null;
  }

  // Short weekday names are ordinary words too ("sun cream", "SAT revision"),
  // so they only count as a day with something around them saying so.
  function shortDayAllowed(match, text) {
    if (match[1]) return true;                                 // on / next / this / by…
    var after = text.slice(match.index + match[0].length);
    return /^\s*($|[,.;!]|\d|at\b|@|with\b|for\b|to\b|and\b|from\b)/i.test(after);
  }

  // Each rule recognises one way of writing a date. `fn` gets the match and
  // the text it was found in and answers with a Date, or null to pass.
  var DATE_RULES = [
    {
      re: /\b(\d{4})-(\d{2})-(\d{2})\b/,
      fn: function (m) { return makeDate(Number(m[1]), Number(m[2]) - 1, Number(m[3])); }
    },
    {
      re: /\b(?:the\s+)?day\s+after\s+(?:tomorrow|tmrw?)\b/i,
      fn: function (m, text, today) { return plusDays(today, 2); }
    },
    {
      re: /\b(today|tonight)\b(?!['’])/i,
      fn: function (m, text, today) { return today; },
      tonight: true
    },
    {
      re: /\b(tomorrow|tomorow|tmrw|tmr|tmw)\b(?!['’])/i,
      fn: function (m, text, today) { return plusDays(today, 1); }
    },
    {
      re: /\bin\s+(a|an|one|two|three|four|five|six|seven|ten|\d{1,3})\s+(days?|weeks?|months?|years?)\b/i,
      fn: function (m, text, today) {
        var count = COUNTS[m[1].toLowerCase()] || Number(m[1]);
        var unit = m[2].toLowerCase().charAt(0);
        if (unit === 'd') return plusDays(today, count);
        if (unit === 'w') return plusDays(today, count * 7);
        if (unit === 'm') return plusMonths(today, count);
        return plusMonths(today, count * 12);
      }
    },
    {
      re: /\bnext\s+(week|month|year)\b/i,
      fn: function (m, text, today) {
        var unit = m[1].toLowerCase();
        if (unit === 'week') return plusDays(today, 7);
        return plusMonths(today, unit === 'month' ? 1 : 12);
      }
    },
    {
      re: /\b(?:(?:this|next)\s+)?weekend\b/i,
      fn: function (m, text, today) {
        // Already the weekend: today. Otherwise the Saturday coming.
        if (today.getDay() === 6 || today.getDay() === 0) {
          return /^next/i.test(m[0]) ? upcoming(today, 6, true) : today;
        }
        return upcoming(today, 6, false);
      }
    },
    {
      re: new RegExp('\\b(?:on\\s+)?' + MONTH_WORD + '\\.?\\s+(\\d{1,2})' + ORDINAL +
        '?(?:,?\\s+(\\d{4}))?\\b', 'i'),
      fn: function (m, text, today) {
        return withYear(today, monthIndex(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 0);
      }
    },
    {
      re: new RegExp('\\b(?:on\\s+)?(?:the\\s+)?(\\d{1,2})' + ORDINAL + '?\\s+(?:of\\s+)?' +
        MONTH_WORD + '\\.?(?:,?\\s+(\\d{4}))?\\b', 'i'),
      fn: function (m, text, today) {
        return withYear(today, monthIndex(m[2]), Number(m[1]), m[3] ? Number(m[3]) : 0);
      }
    },
    {
      // 20/10 or 10/20, whichever way round this device writes dates. Only
      // with a year or an "on" in front: "1/2 cup of flour" is not 1 February.
      re: /\b(?:(on|due|by)\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b/i,
      fn: function (m, text, today, options) {
        if (!m[1] && !m[4]) return null;
        var first = Number(m[2]);
        var second = Number(m[3]);
        var month = options.monthFirst ? first : second;
        var day = options.monthFirst ? second : first;
        return withYear(today, month - 1, day, m[4] ? Number(m[4]) : 0);
      }
    },
    {
      re: new RegExp('\\b(?:on\\s+)?the\\s+(\\d{1,2})' + ORDINAL + '\\b', 'i'),
      fn: function (m, text, today) { return nextDayOfMonth(today, Number(m[1])); }
    },
    {
      re: new RegExp('\\b(?:(on|next|this|by|due|until)\\s+)?' + DAY_WORD + '\\b', 'i'),
      fn: function (m, text, today) {
        var word = m[2].toLowerCase();
        if (DAY_NAMES.indexOf(word) === -1 && !shortDayAllowed(m, text)) return null;
        var strict = !!m[1] && m[1].toLowerCase() === 'next';
        return upcoming(today, dayIndex(word), strict);
      }
    }
  ];

  // The first rule that finds a date in `text`. With `anchored`, only a date
  // right at the start counts — which is how "until <date>" reads its date.
  function findDate(text, today, options, anchored) {
    for (var i = 0; i < DATE_RULES.length; i++) {
      var rule = DATE_RULES[i];
      // Every match, not just the first: "sun cream on friday" has to get past
      // the "sun" that is not a Sunday to reach the Friday that is.
      var re = anchored
        ? new RegExp('^\\s*(?:' + rule.re.source + ')', 'i')
        : new RegExp(rule.re.source, 'gi');
      var match;
      while ((match = re.exec(text))) {
        var date = rule.fn(match, text, today, options);
        if (date) return { date: date, match: match, rule: rule };
        if (anchored) break;
      }
    }
    return null;
  }

  /* --------------------------------------------------------------- times -- */

  function clock(hours, minutes) {
    return pad(hours) + ':' + pad(minutes || 0);
  }

  function to24(hours, meridiem) {
    if (!meridiem) return hours;
    var pm = meridiem.charAt(0).toLowerCase() === 'p';
    if (hours === 12) return pm ? 12 : 0;
    return pm ? hours + 12 : hours;
  }

  var TIME_RULES = [
    {
      // 1-2pm, 11am - 1pm, 9:30 to 11am
      re: new RegExp('\\b(?:from\\s+)?(\\d{1,2})(?::([0-5]\\d))?\\s*' + MERIDIEM + '?\\s*' +
        '(?:-|–|—|to|till|until)\\s*(\\d{1,2})(?::([0-5]\\d))?\\s*' + MERIDIEM + '(?=\\W|$)', 'i'),
      fn: function (m) {
        var endHours = Number(m[4]);
        var startHours = Number(m[1]);
        if (endHours < 1 || endHours > 12 || startHours < 1 || startHours > 12) return null;
        var end = to24(endHours, m[6]);
        // "11-1pm": the start borrows the end's half of the day unless that
        // would put it after the end, in which case it is the morning.
        var start = to24(startHours, m[3] || m[6]);
        if (!m[3] && start * 60 + Number(m[2] || 0) > end * 60 + Number(m[5] || 0)) {
          start = to24(startHours, 'am');
        }
        return { time: clock(start, Number(m[2] || 0)), endTime: clock(end, Number(m[5] || 0)) };
      }
    },
    {
      // 09:00-10:30
      re: /\b(?:from\s+)?([01]?\d|2[0-3]):([0-5]\d)\s*(?:-|–|—|to|till|until)\s*([01]?\d|2[0-3]):([0-5]\d)\b/i,
      fn: function (m) {
        return { time: clock(Number(m[1]), Number(m[2])), endTime: clock(Number(m[3]), Number(m[4])) };
      }
    },
    {
      re: new RegExp('(?:\\bat\\s+|@\\s*)?\\b(\\d{1,2})(?::([0-5]\\d))?\\s*' + MERIDIEM + '(?=\\W|$)', 'i'),
      fn: function (m) {
        var hours = Number(m[1]);
        if (hours < 1 || hours > 12) return null;
        return { time: clock(to24(hours, m[3]), Number(m[2] || 0)) };
      }
    },
    {
      re: /(?:\bat\s+|@\s*)?\b([01]?\d|2[0-3]):([0-5]\d)\b/i,
      fn: function (m) { return { time: clock(Number(m[1]), Number(m[2])) }; }
    },
    {
      re: /\b(?:at\s+)?(noon|midday|midnight)\b/i,
      fn: function (m) { return { time: m[1].toLowerCase() === 'midnight' ? '00:00' : '12:00' }; }
    },
    {
      // A bare "at 7". Nobody books "at 3" meaning three in the morning, so
      // one to six is the afternoon.
      re: /(?:\bat\s+|@\s*)(\d{1,2})\b(?![:/.\-]\d)/i,
      fn: function (m) {
        var hours = Number(m[1]);
        if (hours > 23) return null;
        return { time: clock(hours >= 1 && hours <= 6 ? hours + 12 : hours, 0) };
      }
    }
  ];

  /* -------------------------------------------------------------- repeats -- */

  var REPEAT_RULES = [
    {
      re: new RegExp('\\b(?:every|each)\\s+' + DAY_WORD + 's?\\b', 'i'),
      fn: function (m, today) {
        return { repeat: 'weekly', date: upcoming(today, dayIndex(m[1]), false) };
      }
    },
    {
      re: new RegExp('\\b(?:every|each)\\s+month\\s+on\\s+the\\s+(\\d{1,2})' + ORDINAL + '?\\b', 'i'),
      fn: monthlyOn
    },
    {
      re: new RegExp('\\b(?:on\\s+)?the\\s+(\\d{1,2})' + ORDINAL + '?\\s+of\\s+(?:every|each|the)\\s+month\\b', 'i'),
      fn: monthlyOn
    },
    {
      re: new RegExp('\\b(?:every|each)\\s+(\\d{1,2})' + ORDINAL + '\\b', 'i'),
      fn: monthlyOn
    },
    { re: /\b(?:every\s*day|each\s+day|daily)\b/i, fn: function () { return { repeat: 'daily' }; } },
    { re: /\b(?:every\s+week|each\s+week|weekly)\b/i, fn: function () { return { repeat: 'weekly' }; } },
    { re: /\b(?:every\s+month|each\s+month|monthly)\b/i, fn: function () { return { repeat: 'monthly' }; } },
    {
      re: /\b(?:every\s+year|each\s+year|yearly|annually)\b/i,
      fn: function () { return { repeat: 'yearly' }; }
    }
  ];

  function monthlyOn(m, today) {
    var date = nextDayOfMonth(today, Number(m[1]));
    return date ? { repeat: 'monthly', date: date } : null;
  }

  /* ------------------------------------------------------------- priority -- */

  var PRIORITY_WORDS = {
    '!!!': 3, '!high': 3, '!hi': 3, '!h': 3, '!3': 3,
    '!!': 2, '!medium': 2, '!med': 2, '!m': 2, '!2': 2,
    '!low': 1, '!lo': 1, '!l': 1, '!1': 1
  };

  /* ---------------------------------------------------------------- parse -- */

  // Which way round this device writes 10/11: month first in the US, day
  // first nearly everywhere else.
  function localeMonthFirst() {
    try {
      var parts = new Intl.DateTimeFormat(undefined).formatToParts(new Date(2000, 10, 22));
      var order = parts.filter(function (part) {
        return part.type === 'month' || part.type === 'day';
      }).map(function (part) { return part.type; });
      return order[0] === 'month';
    } catch (err) {
      return false;
    }
  }

  function parse(input, opts) {
    var options = opts || {};
    var now = options.now || new Date();
    var today = midnight(now);
    if (options.monthFirst === undefined) options.monthFirst = localeMonthFirst();

    var original = String(input || '').trim();
    var text = ' ' + original + ' ';
    var result = {
      title: '', date: '', time: '', endTime: '', repeat: '', repeatUntil: '', priority: 0,
      found: false
    };

    function cut(match) {
      text = text.slice(0, match.index) + ' ' + text.slice(match.index + match[0].length);
      result.found = true;
    }

    // Priority marks first: "!!" must not be left hanging off a title.
    var priority = /(^|\s)(!!!|!!|!(?:high|hi|h|medium|med|m|low|lo|l|[123]))(?=\s|$)/i.exec(text);
    if (priority) {
      result.priority = PRIORITY_WORDS[priority[2].toLowerCase()] || 0;
      cut(priority);
    }

    // "until <date>" ends a repeat, so it is read before any other date can
    // claim the date inside it.
    var until = /\buntil\s+/i.exec(text);
    if (until) {
      var after = text.slice(until.index + until[0].length);
      var end = findDate(after, today, options, true);
      if (end) {
        result.repeatUntil = keyOf(end.date);
        cut({ index: until.index, 0: until[0] + end.match[0] });
      }
    }

    var repeatDate = null;
    for (var r = 0; r < REPEAT_RULES.length; r++) {
      var repeatMatch = REPEAT_RULES[r].re.exec(text);
      if (!repeatMatch) continue;
      var rule = REPEAT_RULES[r].fn(repeatMatch, today);
      if (!rule) continue;
      result.repeat = rule.repeat;
      repeatDate = rule.date || null;
      cut(repeatMatch);
      break;
    }

    for (var t = 0; t < TIME_RULES.length; t++) {
      var timeMatch = TIME_RULES[t].re.exec(text);
      if (!timeMatch) continue;
      var times = TIME_RULES[t].fn(timeMatch);
      if (!times) continue;
      result.time = times.time;
      if (times.endTime && times.endTime > times.time) result.endTime = times.endTime;
      cut(timeMatch);
      break;
    }

    var found = findDate(text, today, options, false);
    if (found) {
      result.date = keyOf(found.date);
      if (found.rule.tonight && /tonight/i.test(found.match[0]) && !result.time) result.time = '20:00';
      cut(found.match);
    } else if (repeatDate) {
      result.date = keyOf(repeatDate);
    }
    // A repeat with nothing to start from starts today.
    if (result.repeat && !result.date) result.date = keyOf(today);
    if (result.repeatUntil && (!result.repeat || result.repeatUntil < result.date)) {
      result.repeatUntil = '';
    }

    // Tidy what is left into a title: drop the little words that only made
    // sense next to what was taken out ("lunch on", "call mum at").
    var title = text.replace(/\s+/g, ' ').trim();
    var dangling = /(^|\s)(on|at|by|due|from|for|every|each|in|@|,|-|–)$/i;
    var leading = /^(on|at|by|due|@|,|-|–)(\s|$)/i;
    for (var guard = 0; guard < 5; guard++) {
      var tidied = title.replace(dangling, '').replace(leading, '').trim();
      if (tidied === title) break;
      title = tidied;
    }
    result.title = title || original;
    return result;
  }

  // The bits a parse found, as short phrases for the hint under the box.
  function describe(result, kind) {
    var bits = [];
    if (result.date) {
      var date = new Date(Number(result.date.slice(0, 4)), Number(result.date.slice(5, 7)) - 1,
        Number(result.date.slice(8, 10)));
      bits.push(date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }));
    }
    if (result.time) {
      var format = window.Fmt ? Fmt.time : function (value) { return value; };
      var when = format(result.time) + (result.endTime ? ' – ' + format(result.endTime) : '');
      bits.push(kind === 'task' ? 'remind at ' + when : when);
    }
    if (result.repeat) {
      bits.push({ daily: 'every day', weekly: 'every week', monthly: 'every month', yearly: 'every year' }[result.repeat] +
        (result.repeatUntil ? ' until ' + result.repeatUntil : ''));
    }
    if (result.priority) bits.push(['', 'low', 'medium', 'high'][result.priority] + ' priority');
    return bits;
  }

  return { parse: parse, describe: describe };
})();
