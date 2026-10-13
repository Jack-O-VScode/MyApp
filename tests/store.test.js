'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./harness');

function fresh(storage) {
  return load(['js/store.js'], { storage }).Store;
}

function dates(list) {
  return plain(list).map((item) => item.date);
}

test('a monthly event on the 31st skips the months without one', () => {
  const Store = fresh();
  Store.saveEvent({ title: 'Rent', date: '2026-01-31', repeat: 'monthly' });
  assert.deepEqual(dates(Store.eventsInRange('2026-01-01', '2026-05-31')),
    ['2026-01-31', '2026-03-31', '2026-05-31']);
});

test('a yearly event on 29 February only lands in leap years', () => {
  const Store = fresh();
  Store.saveEvent({ title: 'Leap day', date: '2024-02-29', repeat: 'yearly' });
  assert.deepEqual(dates(Store.eventsInRange('2024-01-01', '2028-12-31')),
    ['2024-02-29', '2028-02-29']);
});

test('weekly repeats stop at their end date and honour skipped days', () => {
  const Store = fresh();
  const event = Store.saveEvent({
    title: 'Standup', date: '2026-10-05', repeat: 'weekly', repeatUntil: '2026-10-26'
  });
  Store.deleteEvent(event.id, 'occurrence', '2026-10-12');
  assert.deepEqual(dates(Store.eventsInRange('2026-10-01', '2026-11-30')),
    ['2026-10-05', '2026-10-19', '2026-10-26']);
});

test('nextDate keeps a monthly rule on its original day after a short month', () => {
  const Store = fresh();
  assert.equal(Store.nextDate('2026-01-31', 'monthly', 31), '2026-02-28');
  assert.equal(Store.nextDate('2026-02-28', 'monthly', 31), '2026-03-31');
});

test('an end time is kept only when it comes after the start', () => {
  const Store = fresh();
  const good = Store.saveEvent({ title: 'A', date: '2026-10-13', time: '09:00', endTime: '10:30' });
  const backwards = Store.saveEvent({ title: 'B', date: '2026-10-13', time: '09:00', endTime: '08:00' });
  const untimed = Store.saveEvent({ title: 'C', date: '2026-10-13', time: '', endTime: '10:00' });
  assert.equal(good.endTime, '10:30');
  assert.equal(backwards.endTime, '');
  assert.equal(untimed.endTime, '');
});

test('moving a plain event changes its day and time', () => {
  const Store = fresh();
  const event = Store.saveEvent({ title: 'Dentist', date: '2026-10-13', time: '09:00', endTime: '10:00' });
  Store.moveEvent(event.id, '2026-10-13', { date: '2026-10-15' });
  Store.moveEvent(event.id, '2026-10-15', { time: '14:00', endTime: '15:30' });
  const moved = Store.getEvent(event.id);
  assert.equal(moved.date, '2026-10-15');
  assert.equal(moved.time, '14:00');
  assert.equal(moved.endTime, '15:30');
});

test('moving one day of a series moves only that day', () => {
  const Store = fresh();
  const series = Store.saveEvent({ title: 'Standup', date: '2026-10-05', time: '09:00', repeat: 'daily' });
  const detached = Store.moveEvent(series.id, '2026-10-07', { date: '2026-10-08', time: '11:00' });
  assert.notEqual(detached.id, series.id);
  const days = plain(Store.eventsInRange('2026-10-05', '2026-10-08'));
  assert.deepEqual(days.map((item) => item.date + ' ' + item.time), [
    '2026-10-05 09:00', '2026-10-06 09:00', '2026-10-08 09:00', '2026-10-08 11:00'
  ]);
});

test('a repeating task rolls forward when ticked, and its steps start again', () => {
  const Store = fresh();
  const task = Store.saveTask({
    title: 'Water plants', due: '2099-01-10', repeat: 'weekly',
    subtasks: [{ title: 'Kitchen', done: true }, { title: 'Balcony', done: false }]
  });
  const result = Store.toggleTask(task.id);
  assert.equal(result.advancedTo, '2099-01-17');
  const after = Store.getTask(task.id);
  assert.equal(after.done, false);
  assert.deepEqual(plain(after.subtasks).map((sub) => sub.done), [false, false]);
});

test('saving a task without priority or steps keeps the ones it had', () => {
  const Store = fresh();
  const task = Store.saveTask({ title: 'Report', due: '', priority: 3, subtasks: [{ title: 'Draft' }] });
  Store.saveTask({ id: task.id, title: 'Report v2', due: '', details: '' });
  const after = Store.getTask(task.id);
  assert.equal(after.title, 'Report v2');
  assert.equal(after.priority, 3);
  assert.equal(after.subtasks.length, 1);
});

test('a task reminder needs a due date', () => {
  const Store = fresh();
  const dated = Store.saveTask({ title: 'A', due: '2099-01-01', remindTime: '09:00' });
  const undated = Store.saveTask({ title: 'B', due: '', remindTime: '09:00' });
  assert.equal(dated.remindTime, '09:00');
  assert.equal(undated.remindTime, '');
});

test('toggling a step and counting progress', () => {
  const Store = fresh();
  const task = Store.saveTask({ title: 'Move', due: '', subtasks: [{ title: 'Pack' }, { title: 'Lift' }] });
  Store.toggleSubtask(task.id, task.subtasks[0].id);
  assert.deepEqual(plain(Store.subtaskProgress(Store.getTask(task.id))), { done: 1, total: 2 });
});

test('tasks sort by due date, priority, or newest', () => {
  const Store = fresh();
  Store.saveTask({ title: 'later-low', due: '2099-02-01', priority: 1 });
  Store.saveTask({ title: 'soon-none', due: '2099-01-01', priority: 0 });
  Store.saveTask({ title: 'undated-high', due: '', priority: 3 });
  const titles = (sort) => plain(Store.allTasks({ sort })).map((task) => task.title);
  assert.deepEqual(titles('due'), ['soon-none', 'later-low', 'undated-high']);
  assert.deepEqual(titles('priority'), ['undated-high', 'later-low', 'soon-none']);
  assert.deepEqual(titles('created'), ['undated-high', 'soon-none', 'later-low']);
});

test('search finds a task by one of its steps', () => {
  const Store = fresh();
  Store.saveTask({ title: 'Trip', due: '', subtasks: [{ title: 'Book the ferry' }] });
  assert.equal(Store.allTasks({ query: 'ferry' }).length, 1);
});

test('notes linked to an event are found per day of a series', () => {
  const Store = fresh();
  const series = Store.saveEvent({ title: 'Standup', date: '2026-10-05', repeat: 'daily' });
  Store.createNote({ title: 'Mon', eventId: series.id, eventDate: '2026-10-05' });
  Store.createNote({ title: 'Tue', eventId: series.id, eventDate: '2026-10-06' });
  assert.deepEqual(plain(Store.notesForEvent(series.id, '2026-10-06')).map((note) => note.title), ['Tue']);
  assert.equal(Store.notesForEvent('nope', '2026-10-06').length, 0);
});

test('new fields survive a round trip through sync', () => {
  const sender = fresh();
  const event = sender.saveEvent({ title: 'Review', date: '2026-10-13', time: '11:00', endTime: '12:00' });
  sender.saveTask({ title: 'Ship', due: '2099-01-01', priority: 2, remindTime: '08:30', subtasks: [{ title: 'Test' }] });
  sender.createNote({ title: 'Minutes', eventId: event.id, eventDate: '2026-10-13' });

  const records = plain(sender.pendingRecords());
  const receiver = fresh();
  receiver.applyRemote(records);

  const task = plain(receiver.allTasks({}))[0];
  assert.equal(task.priority, 2);
  assert.equal(task.remindTime, '08:30');
  assert.deepEqual(task.subtasks.map((sub) => sub.title), ['Test']);
  assert.equal(receiver.getEvent(event.id).endTime, '12:00');
  assert.equal(receiver.notesForEvent(event.id, '2026-10-13').length, 1);
});

test('importing the same backup twice changes nothing', () => {
  const Store = fresh();
  Store.saveTask({ title: 'Keep', due: '' });
  const backup = plain(Store.exportData());
  const other = fresh();
  assert.equal(other.importData(backup).added, 1);
  assert.deepEqual(plain(other.importData(backup)), { added: 0, updated: 0 });
});

test('checklist progress counts ticked lines', () => {
  const Store = fresh();
  assert.deepEqual(plain(Store.checklistProgress('- [x] a\n- [ ] b\nplain')), { done: 1, total: 2 });
  assert.equal(Store.checklistProgress('nothing here'), null);
});
