import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// localStorage shim must exist before the module loads
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const S = await import('../js/state.js');

let now = new Date('2026-07-13T10:00:00');
S.__setClock(() => now);
const advanceDays = (d) => { now = new Date(now.getTime() + d * 86400000); };
const advanceHours = (h) => { now = new Date(now.getTime() + h * 3600000); };

beforeEach(() => {
  now = new Date('2026-07-13T10:00:00');
  S.resetAll();
});

test('xp per tier, wrong answers get consolation xp', () => {
  assert.equal(S.xpForQuestion(1, true), 10);
  assert.equal(S.xpForQuestion(2, true), 15);
  assert.equal(S.xpForQuestion(3, true), 20);
  assert.equal(S.xpForQuestion(3, false), 2);
});

test('levels: 100 xp to level 2, 300 to level 3', () => {
  assert.equal(S.levelInfo().level, 1);
  for (let i = 0; i < 10; i++) S.recordAnswer(`q${i}`, 1, true); // 100 xp
  assert.equal(S.levelInfo().level, 2);
  for (let i = 0; i < 20; i++) S.recordAnswer(`p${i}`, 1, true); // +200 xp
  assert.equal(S.levelInfo().level, 3);
});

test('streak: extends on consecutive days, breaks after a gap', () => {
  assert.equal(S.currentStreak(), 0);
  assert.equal(S.completeLesson(0).streak, 1);
  assert.equal(S.currentStreak(), 1);

  advanceDays(1);
  const r = S.completeLesson(0);
  assert.equal(r.streak, 2);
  assert.ok(r.streakExtended);

  advanceDays(1); // day 3, no lesson yet: streak still shows
  assert.equal(S.currentStreak(), 2);

  advanceDays(1); // day 4: yesterday was missed → broken
  assert.equal(S.currentStreak(), 0);
  assert.equal(S.completeLesson(0).streak, 1); // restarts
});

test('streak: second lesson same day does not double-count', () => {
  S.completeLesson(0);
  const r = S.completeLesson(0);
  assert.equal(r.streakExtended, false);
  assert.equal(r.streak, 1);
});

test('bestStreak survives a broken streak', () => {
  S.completeLesson(0);
  advanceDays(1);
  S.completeLesson(0);
  advanceDays(3);
  S.completeLesson(0);
  assert.equal(S.getState().bestStreak, 2);
  assert.equal(S.getState().streak, 1);
});

test('srs: wrong answer drops to box 0 and is due in ~10 min', () => {
  S.recordAnswer('q', 2, true);
  S.recordAnswer('q', 2, true);
  assert.equal(S.boxOf('q'), 2);
  S.recordAnswer('q', 2, false);
  assert.equal(S.boxOf('q'), 0);
  assert.ok(!S.isDue('q'));
  advanceHours(0.2); // 12 min
  assert.ok(S.isDue('q'));
});

test('srs: box climbs and intervals stretch', () => {
  S.recordAnswer('q', 1, true); // box 1: due in 8 h
  advanceHours(4);
  assert.ok(!S.isDue('q'));
  advanceHours(5);
  assert.ok(S.isDue('q'));
  S.recordAnswer('q', 1, true); // box 2: due in 1 day
  advanceHours(12);
  assert.ok(!S.isDue('q'));
  advanceHours(13);
  assert.ok(S.isDue('q'));
});

test('srs: box caps at MAX_BOX', () => {
  for (let i = 0; i < 10; i++) S.recordAnswer('q', 1, true);
  assert.equal(S.boxOf('q'), S.MAX_BOX);
});

test('pickLesson: due questions beat unseen beat mastered', () => {
  S.recordAnswer('due1', 1, false); // box 0
  advanceHours(1); // now due
  S.recordAnswer('strong', 1, true); // box 1, not due
  const pool = [{ id: 'due1' }, { id: 'strong' }, { id: 'new1' }, { id: 'new2' }];
  const lesson = S.pickLesson(pool, 3);
  const ids = lesson.map((q) => q.id);
  assert.equal(lesson.length, 3);
  assert.ok(ids.includes('due1'), 'due question must be included');
  assert.ok(ids.includes('new1') && ids.includes('new2'), 'unseen beat already-mastered');
  assert.ok(!ids.includes('strong'));
});

test('topicMastery: unseen 0, all-max 1', () => {
  assert.equal(S.topicMastery(['a', 'b']), 0);
  for (let i = 0; i < 6; i++) { S.recordAnswer('a', 1, true); S.recordAnswer('b', 1, true); }
  assert.equal(S.topicMastery(['a', 'b']), 1);
  assert.equal(S.topicMastery([]), 0);
});

test('state persists through storage round-trip', () => {
  S.recordAnswer('q', 2, true);
  const raw = store.get('ohmwork-state-v1');
  assert.ok(raw.includes('"xp":15'));
  assert.ok(JSON.parse(raw).srs.q.box === 1);
});
