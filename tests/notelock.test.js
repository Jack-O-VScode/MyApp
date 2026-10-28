'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./harness');

function fresh() {
  const app = load(['js/store.js', 'js/notelock.js']);
  app.NoteLock.ITERATIONS = 1000;   // the real count is slow on purpose
  return app;
}

test('a sealed note opens with its password and not without', async () => {
  const { NoteLock } = fresh();
  const { locked, keyring } = await NoteLock.seal('PIN 4821\n- [ ] renew passport', 'correct horse', 'note-1', 'the horse');
  assert.equal(keyring.hint, 'the horse');
  assert.ok(!JSON.stringify(locked).includes('4821'), 'the text is not in the seal');

  const opened = await NoteLock.open(locked, 'correct horse', 'note-1');
  assert.equal(opened.text, 'PIN 4821\n- [ ] renew passport');
  await assert.rejects(NoteLock.open(locked, 'wrong', 'note-1'), /not right/);
});

test('a seal moved onto another note does not open there', async () => {
  const { NoteLock } = fresh();
  const { locked } = await NoteLock.seal('secret', 'pw12', 'note-1');
  await assert.rejects(NoteLock.open(locked, 'pw12', 'note-2'), /not right/);
});

test('saving edits reseals with a fresh IV under the same key', async () => {
  const { NoteLock } = fresh();
  const first = await NoteLock.seal('v1', 'pw12', 'n');
  const second = await NoteLock.reseal('v2 — édité', first.keyring, 'n');
  assert.equal(second.salt, first.locked.salt);
  assert.notEqual(second.iv, first.locked.iv);
  assert.equal((await NoteLock.open(second, 'pw12', 'n')).text, 'v2 — édité');
});

test('the store keeps only the seal: no plain text beside it, in sync or backups', async () => {
  const { Store, NoteLock } = fresh();
  const note = Store.createNote();
  Store.updateNote(note.id, { title: 'Bank', body: 'account 12345678' });
  const { locked } = await NoteLock.seal('account 12345678', 'pw12', note.id);
  Store.updateNote(note.id, { locked });

  assert.equal(Store.getNote(note.id).body, '');
  // A careless caller passing text to a locked note still cannot store it.
  Store.updateNote(note.id, { body: 'leaked?' });
  assert.equal(Store.getNote(note.id).body, '');

  const everywhere = JSON.stringify(plain(Store.pendingRecords())) + JSON.stringify(plain(Store.exportData()));
  assert.ok(!everywhere.includes('12345678'));
  assert.ok(!everywhere.includes('leaked?'));
  assert.ok(everywhere.includes('Bank'), 'the title stays readable');
  assert.equal(Store.allNotes('12345678').length, 0, 'search cannot see inside');
});

test('a locked note survives sync and opens on the other device', async () => {
  const one = fresh();
  const note = one.Store.createNote();
  const { locked } = await one.NoteLock.seal('shared secret', 'pw12', note.id);
  one.Store.updateNote(note.id, { title: 'T', locked });

  const two = fresh();
  two.Store.applyRemote(plain(one.Store.pendingRecords()));
  const copy = two.Store.getNote(note.id);
  assert.ok(copy.locked);
  assert.equal((await two.NoteLock.open(copy.locked, 'pw12', note.id)).text, 'shared secret');
});

test('removing the lock puts the text back in the open', () => {
  const { Store } = fresh();
  const note = Store.createNote();
  Store.updateNote(note.id, { locked: { v: 1, iter: 5, salt: 'c2FsdA==', iv: 'aXY=', data: 'ZGF0YQ==' } });
  Store.updateNote(note.id, { body: 'plain again', locked: null });
  const after = Store.getNote(note.id);
  assert.equal(after.locked, null);
  assert.equal(after.body, 'plain again');
});

test('a malformed seal is dropped rather than trusted', () => {
  const { Store } = fresh();
  const note = Store.createNote();
  Store.updateNote(note.id, { body: 'kept', locked: { v: 2, data: 'x' } });
  assert.equal(Store.getNote(note.id).locked, null);
  assert.equal(Store.getNote(note.id).body, 'kept');
});
