/* The arithmetic behind the Day view's timeline: where a block sits, how tall
   it is, and how events that overlap share the width. Kept apart from the DOM
   so it can be tested on its own. */
window.Timeline = (function () {
  'use strict';

  var DEFAULT_LENGTH = 60;     // minutes, for an event with no end time
  var MIN_LENGTH = 15;
  var LAST_MINUTE = 23 * 60 + 59;

  function minutesOf(time) {
    var match = /^(\d{1,2}):(\d{2})$/.exec(String(time || ''));
    return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
  }

  function clockOf(minutes) {
    var whole = Math.max(0, Math.min(LAST_MINUTE, Math.round(minutes)));
    return String(Math.floor(whole / 60)).padStart(2, '0') + ':' + String(whole % 60).padStart(2, '0');
  }

  function span(item) {
    var start = minutesOf(item.time);
    var end = minutesOf(item.endTime);
    if (end <= start) end = Math.min(start + DEFAULT_LENGTH, LAST_MINUTE + 1);
    return { start: start, end: Math.max(end, start + MIN_LENGTH) };
  }

  // Timed events as blocks: start and end in minutes, plus the column each
  // takes and how many columns its cluster of overlapping events needs.
  function layout(items) {
    var blocks = items.filter(function (item) { return minutesOf(item.time) >= 0; })
      .map(function (item) {
        var range = span(item);
        return { item: item, start: range.start, end: range.end, column: 0, columns: 1 };
      })
      .sort(function (a, b) { return a.start - b.start || b.end - a.end; });

    var cluster = [];
    var clusterEnd = -1;
    var columnEnds = [];

    function close() {
      cluster.forEach(function (block) { block.columns = columnEnds.length; });
      cluster = [];
      columnEnds = [];
    }

    blocks.forEach(function (block) {
      if (block.start >= clusterEnd) close();
      // The first column free by the time this block starts.
      var column = 0;
      while (column < columnEnds.length && columnEnds[column] > block.start) column++;
      columnEnds[column] = block.end;
      block.column = column;
      cluster.push(block);
      clusterEnd = Math.max(clusterEnd, block.end);
    });
    close();
    return blocks;
  }

  // Where a dragged block lands: `delta` minutes on, kept within the day.
  function moved(start, end, delta, resizing) {
    if (resizing) {
      return { start: start, end: Math.max(start + MIN_LENGTH, Math.min(LAST_MINUTE, end + delta)) };
    }
    var length = end - start;
    var nextStart = Math.max(0, Math.min(LAST_MINUTE - MIN_LENGTH, start + delta));
    return { start: nextStart, end: Math.min(LAST_MINUTE, nextStart + length) };
  }

  return {
    DEFAULT_LENGTH: DEFAULT_LENGTH,
    minutesOf: minutesOf,
    clockOf: clockOf,
    span: span,
    layout: layout,
    moved: moved
  };
})();
