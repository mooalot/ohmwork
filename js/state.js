// Persistent state: profile (XP, streak), per-question spaced repetition, settings.
// Everything lives in localStorage under one key.

const KEY = 'ohmwork-state-v1';

// Leitner-style boxes: interval (ms) until a question is due again after a
// correct answer at that box. Wrong answers drop the question to box 0.
const BOX_INTERVALS = [
  10 * 60 * 1000,            // box 0: 10 min (just missed it)
  8 * 60 * 60 * 1000,        // box 1: 8 h
  24 * 60 * 60 * 1000,       // box 2: 1 day
  3 * 24 * 60 * 60 * 1000,   // box 3: 3 days
  7 * 24 * 60 * 60 * 1000,   // box 4: 1 week
  21 * 24 * 60 * 60 * 1000,  // box 5: 3 weeks
];
export const MAX_BOX = BOX_INTERVALS.length - 1;

function blank() {
  return {
    xp: 0,
    streak: 0,
    bestStreak: 0,
    lastActiveDay: null, // 'YYYY-MM-DD' of last completed lesson
    totalAnswered: 0,
    totalCorrect: 0,
    lessonsCompleted: 0,
    srs: {}, // qid -> { box, due, seen, correct }
  };
}

// injectable clock so tests can simulate days passing
let _now = () => new Date();
export function __setClock(fn) {
  _now = fn;
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return Object.assign(blank(), JSON.parse(raw));
  } catch (e) { /* corrupted state: start fresh */ }
  return blank();
}

function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function getState() {
  return state;
}

function today() {
  const d = _now();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(dayA, dayB) {
  return Math.round((new Date(dayB) - new Date(dayA)) / 86400000);
}

// Streak shown in the header: 0 if the streak is broken (last activity
// before yesterday), otherwise the stored count.
export function currentStreak() {
  if (!state.lastActiveDay) return 0;
  const gap = daysBetween(state.lastActiveDay, today());
  return gap > 1 ? 0 : state.streak;
}

export function streakSavedToday() {
  return state.lastActiveDay === today();
}

// XP → level: level n requires 100·n XP beyond level n−1 (so 100, 300, 600 …)
export function levelInfo() {
  let lvl = 1;
  let need = 100;
  let rem = state.xp;
  while (rem >= need) {
    rem -= need;
    lvl += 1;
    need = 100 * lvl;
  }
  return { level: lvl, into: rem, need };
}

export function xpForQuestion(tier, correct) {
  if (!correct) return 2;
  return { 1: 10, 2: 15, 3: 20 }[tier] || 10;
}

// Record one answered question. Returns XP earned.
export function recordAnswer(qid, tier, correct) {
  const xp = xpForQuestion(tier, correct);
  state.xp += xp;
  state.totalAnswered += 1;
  if (correct) state.totalCorrect += 1;

  const rec = state.srs[qid] || { box: 0, due: 0, seen: 0, correct: 0 };
  rec.seen += 1;
  if (correct) {
    rec.correct += 1;
    rec.box = Math.min(MAX_BOX, rec.box + 1);
  } else {
    rec.box = 0;
  }
  rec.due = _now().getTime() + BOX_INTERVALS[rec.box];
  state.srs[qid] = rec;
  save();
  return xp;
}

// Called when a lesson finishes; maintains the daily streak. Returns
// { streakExtended, streak } for the results screen.
export function completeLesson(bonusXp) {
  state.lessonsCompleted += 1;
  state.xp += bonusXp;
  const t = today();
  let extended = false;
  if (state.lastActiveDay !== t) {
    const gap = state.lastActiveDay ? daysBetween(state.lastActiveDay, t) : Infinity;
    state.streak = gap === 1 ? state.streak + 1 : 1;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    state.lastActiveDay = t;
    extended = true;
  }
  save();
  return { streakExtended: extended, streak: state.streak };
}

// --- selection helpers -----------------------------------------------------

export function isDue(qid) {
  const rec = state.srs[qid];
  return !!rec && rec.due <= _now().getTime();
}

export function isSeen(qid) {
  return !!state.srs[qid];
}

export function boxOf(qid) {
  return state.srs[qid]?.box ?? -1; // -1 = never seen
}

// Mastery of a topic: mean(box/MAX_BOX) over its questions (unseen count as 0).
export function topicMastery(questionIds) {
  if (!questionIds.length) return 0;
  let sum = 0;
  for (const id of questionIds) {
    const b = boxOf(id);
    if (b > 0) sum += b / MAX_BOX;
  }
  return sum / questionIds.length;
}

export function dueCount(questionIds) {
  return questionIds.filter((id) => isDue(id)).length;
}

// Build a lesson: due reviews first, then unseen, then weakest-box, shuffled
// within each priority class.
export function pickLesson(questions, n = 10) {
  const due = [];
  const unseen = [];
  const rest = [];
  for (const q of questions) {
    if (isDue(q.id)) due.push(q);
    else if (!isSeen(q.id)) unseen.push(q);
    else rest.push(q);
  }
  shuffle(due);
  shuffle(unseen);
  rest.sort((a, b) => boxOf(a.id) - boxOf(b.id));
  const picked = [...due, ...unseen, ...rest].slice(0, n);
  shuffle(picked);
  return picked;
}

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function resetAll() {
  state = blank();
  save();
}
