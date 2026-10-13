'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./harness');

test('the schedule has event reminders, task reminders and a digest', () => {
  const app = load(['js/store.js', 'js/reminders.js']);
  const { Store, Reminders } = app;
  const from = new Date(2099, 0, 10, 7, 0);

  Store.saveSettings({ digestTime: '08:00', digestOn: true });
  Store.saveEvent({ title: 'Dentist', date: '2099-01-11', time: '09:00', remind: 30 });
  Store.saveTask({
    title: 'Call bank', due: '2099-01-12', remindTime: '14:15',
    subtasks: [{ title: 'Find number' }, { title: 'Ask', done: true }]
  });
  Store.saveTask({ title: 'Too far', due: '2099-03-01', remindTime: '09:00' });

  const rows = plain(Reminders.computeSchedule(from));
  const ids = rows.map((row) => row.id.split(':')[0]);
  assert.ok(ids.includes('ev'));
  assert.ok(ids.includes('dg'));

  const task = rows.filter((row) => row.id.indexOf('tk:') === 0);
  assert.equal(task.length, 1, 'only the task inside the horizon');
  assert.equal(task[0].title, 'Call bank');
  assert.equal(task[0].body, '1 of 2 steps left');
  assert.equal(new Date(task[0].fire_at).getTime(), new Date(2099, 0, 12, 14, 15).getTime());
});

test('a finished task is not reminded about', () => {
  const { Store, Reminders } = load(['js/store.js', 'js/reminders.js']);
  const task = Store.saveTask({ title: 'Done already', due: '2099-01-12', remindTime: '10:00' });
  Store.toggleTask(task.id);
  const rows = plain(Reminders.computeSchedule(new Date(2099, 0, 10)));
  assert.equal(rows.filter((row) => row.id.indexOf('tk:') === 0).length, 0);
});
