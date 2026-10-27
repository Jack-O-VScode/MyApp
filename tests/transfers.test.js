'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./harness');

const { TransfersView } = load(['js/transfers.js']);
const HOUR = 3600000;

test('keys from before expiry was choosable keep their 24 hours', () => {
  const parsed = plain(TransfersView._parseKey('1700000000000-abcde__photo.jpg'));
  assert.deepEqual(parsed, { name: 'photo.jpg', stamp: 1700000000000, expiresAt: 1700000000000 + 24 * HOUR, files: 0 });
});

test('keys carry an expiry, or say never', () => {
  const timed = TransfersView._parseKey('1700000000000-abcde-e1700000060000__a__b.txt');
  assert.equal(timed.expiresAt, 1700000060000);
  assert.equal(timed.name, 'a__b.txt');
  assert.equal(TransfersView._parseKey('1700000000000-abcde-enever__a.txt').expiresAt, null);
});

test('typed lifetimes in minutes, hours and days', () => {
  assert.equal(TransfersView._lifetime('15', 'minute').ms, 15 * 60000);
  assert.equal(TransfersView._lifetime(' 2 ', 'hour').ms, 2 * HOUR);
  assert.equal(TransfersView._lifetime('7', 'day').ms, 7 * 24 * HOUR);
});

test('nonsense lifetimes are refused with a reason', () => {
  ['', '0', '-3', '1.5', 'abc'].forEach((text) => {
    assert.ok(TransfersView._lifetime(text, 'hour').error, JSON.stringify(text));
  });
  assert.ok(TransfersView._lifetime('3651', 'day').error);
  assert.ok(TransfersView._lifetime('5', 'week').error);
});

test('time left reads in the unit that suits it', () => {
  const now = 1700000000000;
  assert.equal(TransfersView._expiresIn(null, now), 'never expires');
  assert.equal(TransfersView._expiresIn(now - 1, now), 'expiring');
  assert.equal(TransfersView._expiresIn(now + 5 * 60000, now), 'expires in 5 min');
  assert.equal(TransfersView._expiresIn(now + HOUR, now), 'expires in 1 hour');
  assert.equal(TransfersView._expiresIn(now + 30 * HOUR, now), 'expires in 30 hours');
  assert.equal(TransfersView._expiresIn(now + 72 * HOUR, now), 'expires in 3 days');
});

test('a zipped folder says how many files it holds', () => {
  const parsed = TransfersView._parseKey('1700000000000-abcde-enever-f12__Photos.zip');
  assert.equal(parsed.files, 12);
  assert.equal(parsed.expiresAt, null);
  assert.equal(parsed.name, 'Photos.zip');
  assert.equal(TransfersView._parseKey('1700000000000-abcde-e5__a.txt').files, 0);
});

test('a picked folder keeps every file under its own name', () => {
  const picked = [
    { name: 'a.txt', webkitRelativePath: 'Trip/a.txt', lastModified: 1 },
    { name: 'b.jpg', webkitRelativePath: 'Trip/pics/b.jpg', lastModified: 2 }
  ];
  const folder = plain(TransfersView._folderFromPicked(picked));
  assert.equal(folder.name, 'Trip');
  assert.deepEqual(folder.entries.map((entry) => entry.path), ['Trip/a.txt', 'Trip/pics/b.jpg']);
  assert.equal(TransfersView._folderFromPicked([]), null);
});
