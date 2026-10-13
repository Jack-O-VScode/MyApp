'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./harness');

const { Timeline, Drag } = load(['js/timeline.js', 'js/drag.js']);

function columns(items) {
  return plain(Timeline.layout(items)).map((block) => [block.item.title, block.column, block.columns]);
}

test('events that do not overlap each get the full width', () => {
  assert.deepEqual(columns([
    { title: 'a', time: '09:00', endTime: '10:00' },
    { title: 'b', time: '10:00', endTime: '11:00' }
  ]), [['a', 0, 1], ['b', 0, 1]]);
});

test('overlapping events share the width, and a free column is reused', () => {
  assert.deepEqual(columns([
    { title: 'long', time: '09:00', endTime: '12:00' },
    { title: 'early', time: '09:30', endTime: '10:00' },
    { title: 'late', time: '10:30', endTime: '11:00' }
  ]), [['long', 0, 2], ['early', 1, 2], ['late', 1, 2]]);
});

test('untimed events are left out, and no end means an hour', () => {
  const blocks = plain(Timeline.layout([{ title: 'all day', time: '' }, { title: 'x', time: '08:15' }]));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].start, 8 * 60 + 15);
  assert.equal(blocks[0].end, 9 * 60 + 15);
});

test('a moved block keeps its length and stays inside the day', () => {
  assert.deepEqual(plain(Timeline.moved(540, 600, 90, false)), { start: 630, end: 690 });
  assert.deepEqual(plain(Timeline.moved(540, 600, -9999, false)), { start: 0, end: 60 });
  assert.equal(Timeline.moved(1380, 1440, 120, false).end, 1439);
});

test('resizing never makes a block shorter than a quarter of an hour', () => {
  assert.deepEqual(plain(Timeline.moved(540, 600, -120, true)), { start: 540, end: 555 });
  assert.deepEqual(plain(Timeline.moved(540, 600, 30, true)), { start: 540, end: 630 });
});

test('drag distance snaps to 15 minutes', () => {
  assert.equal(Drag.snapMinutes(48, 48, 15), 60);
  assert.equal(Drag.snapMinutes(10, 48, 15), 15);
  assert.equal(Drag.snapMinutes(5, 48, 15), 0);
  assert.equal(Drag.snapMinutes(-36, 48, 15), -45);
});

test('clock strings', () => {
  assert.equal(Timeline.clockOf(0), '00:00');
  assert.equal(Timeline.clockOf(13 * 60 + 5), '13:05');
  assert.equal(Timeline.clockOf(2000), '23:59');
  assert.equal(Timeline.minutesOf('7:30'), 450);
  assert.equal(Timeline.minutesOf(''), -1);
});
