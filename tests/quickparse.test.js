'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./harness');

const { QuickParse } = load(['js/quickparse.js']);
// Tuesday 13 October 2026, mid-morning.
const NOW = new Date(2026, 9, 13, 10, 0);

function parse(text, extra) {
  const result = QuickParse.parse(text, Object.assign({ now: NOW, monthFirst: false }, extra));
  return {
    title: result.title, date: result.date, time: result.time, endTime: result.endTime,
    repeat: result.repeat, repeatUntil: result.repeatUntil, priority: result.priority
  };
}

function expect(text, wanted, extra) {
  const base = { title: '', date: '', time: '', endTime: '', repeat: '', repeatUntil: '', priority: 0 };
  assert.deepEqual(parse(text, extra), Object.assign(base, wanted), text);
}

test('a weekday and a time', () => {
  expect('Lunch with Sam fri 1pm', { title: 'Lunch with Sam', date: '2026-10-16', time: '13:00' });
});

test('relative days', () => {
  expect('Dentist tomorrow at 3', { title: 'Dentist', date: '2026-10-14', time: '15:00' });
  expect('call mum tonight', { title: 'call mum', date: '2026-10-13', time: '20:00' });
  expect('report in 2 weeks', { title: 'report', date: '2026-10-27' });
  expect('plan the day after tomorrow', { title: 'plan', date: '2026-10-15' });
});

test('"next" means after today, never today', () => {
  expect('sync next tue', { title: 'sync', date: '2026-10-20' });
  expect('sync tue 9am', { title: 'sync', date: '2026-10-13', time: '09:00' });
});

test('month names, both ways round, rolling into next year when passed', () => {
  expect('trip oct 20', { title: 'trip', date: '2026-10-20' });
  expect('party 3rd of january', { title: 'party', date: '2027-01-03' });
  expect('exam sep 1', { title: 'exam', date: '2027-09-01' });
});

test('numeric dates follow the device, and need an "on" or a year', () => {
  expect('dinner on 20/10 at 7pm', { title: 'dinner', date: '2026-10-20', time: '19:00' });
  expect('dinner on 10/20 at 7pm', { title: 'dinner', date: '2026-10-20', time: '19:00' }, { monthFirst: true });
  expect('1/2 cup flour', { title: '1/2 cup flour' });
});

test('time ranges give an end time', () => {
  expect('review 11-1pm thu', { title: 'review', date: '2026-10-15', time: '11:00', endTime: '13:00' });
  expect('Team sync 09:00-10:30', { title: 'Team sync', time: '09:00', endTime: '10:30' });
});

test('repeats', () => {
  expect('pay rent every month on the 1st !high',
    { title: 'pay rent', date: '2026-11-01', repeat: 'monthly', priority: 3 });
  expect('gym every mon 7am until dec 20',
    { title: 'gym', date: '2026-10-19', time: '07:00', repeat: 'weekly', repeatUntil: '2026-12-20' });
  expect('stretch daily', { title: 'stretch', date: '2026-10-13', repeat: 'daily' });
});

test('priority marks', () => {
  expect('taxes !!', { title: 'taxes', priority: 2 });
  expect('taxes !low', { title: 'taxes', priority: 1 });
  expect('Wow!', { title: 'Wow!' });
});

test('ordinary words are left alone', () => {
  expect('Buy sun cream', { title: 'Buy sun cream' });
  expect('sun cream on friday', { title: 'sun cream', date: '2026-10-16' });
  expect("today's agenda", { title: "today's agenda" });
});

test('nothing but a date keeps the text as the title', () => {
  expect('tomorrow', { title: 'tomorrow', date: '2026-10-14' });
});
