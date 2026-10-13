'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./harness');

const { ICS } = load(['js/ics.js']);

function calendar(lines) {
  return ['BEGIN:VCALENDAR'].concat(lines, ['END:VCALENDAR']).join('\r\n');
}

test('folded lines are put back together', () => {
  assert.deepEqual(plain(ICS._unfold('SUMMARY:A long\r\n  title\r\nUID:1')), ['SUMMARY:A long title', 'UID:1']);
});

test('a same-day timed event keeps its end time', () => {
  const result = ICS.parse(calendar([
    'BEGIN:VEVENT', 'UID:abc', 'SUMMARY:Review',
    'DTSTART:20261013T090000', 'DTEND:20261013T103000', 'END:VEVENT'
  ]));
  const event = plain(result.events)[0];
  assert.equal(event.date, '2026-10-13');
  assert.equal(event.time, '09:00');
  assert.equal(event.endTime, '10:30');
  assert.equal(event.uid, 'ics:abc');
});

test('an all-day event has no time', () => {
  const event = plain(ICS.parse(calendar([
    'BEGIN:VEVENT', 'SUMMARY:Holiday', 'DTSTART;VALUE=DATE:20261224',
    'DTEND;VALUE=DATE:20261225', 'END:VEVENT'
  ])).events)[0];
  assert.equal(event.date, '2026-12-24');
  assert.equal(event.time, '');
  assert.equal(event.endTime, undefined);
});

test('a weekly rule is kept, and a cancelled event is dropped', () => {
  const result = ICS.parse(calendar([
    'BEGIN:VEVENT', 'SUMMARY:Gym', 'DTSTART;VALUE=DATE:20261012', 'RRULE:FREQ=WEEKLY', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Off', 'DTSTART;VALUE=DATE:20261012', 'STATUS:CANCELLED', 'END:VEVENT'
  ]));
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].repeat, 'weekly');
  assert.equal(result.report.cancelled, 1);
});

test('escaped text is unescaped', () => {
  const event = plain(ICS.parse(calendar([
    'BEGIN:VEVENT', 'SUMMARY:Tea\\, cake', 'DTSTART;VALUE=DATE:20261012', 'END:VEVENT'
  ])).events)[0];
  assert.equal(event.title, 'Tea, cake');
});
