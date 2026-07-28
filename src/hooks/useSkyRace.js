import { useCallback, useRef, useState } from 'react';
import { generateProblem } from '../data/battleData';

// Sky Race Deliveries — client-only prototype.
//
// The kid rides their companion dragon delivering berries to floating
// villages. The route forks TOTAL_FORKS times; each fork is a math problem
// with three answer-labeled cloud paths. Correct picks keep the dragon
// soaring (and earn berries); wrong picks just cost a little altitude —
// there is no failure state, every delivery run finishes.
//
// Berries and best times live in localStorage for now; nothing is persisted
// server-side yet.

export const TOTAL_FORKS = 10;

// Wind routes = difficulty presets. Shapes match battleData configs
// ({ ops, range }) so generateProblem can be reused as-is.
export const ROUTES = [
  {
    id: 'gentle',
    name: 'Gentle Breeze',
    icon: '🍃',
    blurb: 'addition · light winds',
    ops: ['add'],
    range: [1, 10],
  },
  {
    id: 'breezy',
    name: 'Butterfly Winds',
    icon: '🦋',
    blurb: 'add & subtract · steady winds',
    ops: ['add', 'sub'],
    range: [1, 12],
  },
  {
    id: 'swift',
    name: 'Swift Skies',
    icon: '🌈',
    blurb: 'add · subtract · multiply',
    ops: ['add', 'sub', 'mul'],
    range: [2, 10],
  },
];

const WRONG_ALTITUDE_COST = 18;
const CORRECT_ALTITUDE_LIFT = 6;
const MIN_ALTITUDE = 12; // the dragon never crashes — just skims the treetops
const GLIDE_MS = 700;    // swoosh pause between forks
const HIGH_FLYER_ALTITUDE = 80;
const HIGH_FLYER_BONUS = 3;

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Three shuffled path choices: the answer plus two near-miss distractors.
function buildChoices(answer) {
  const values = new Set([answer]);
  while (values.size < 3) {
    const delta = randInt(1, 3) * (Math.random() < 0.5 ? -1 : 1);
    const candidate = answer + delta;
    if (candidate >= 0) values.add(candidate);
  }
  const arr = [...values];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function bestTimeKey(username, routeId) {
  return `skyrace-best:${username || 'guest'}:${routeId}`;
}

export function loadBestMs(username, routeId) {
  const raw = localStorage.getItem(bestTimeKey(username, routeId));
  const ms = Number(raw);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

export function formatRaceTime(ms) {
  const totalSeconds = Math.round(ms / 100) / 10;
  const m = Math.floor(totalSeconds / 60);
  const s = (totalSeconds - m * 60).toFixed(1);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function useSkyRace(username) {
  const [status, setStatus] = useState('ready'); // ready | flying | done
  const [route, setRoute] = useState(null);
  const [forkIndex, setForkIndex] = useState(0);
  const [problem, setProblem] = useState(null);
  const [choices, setChoices] = useState([]);
  const [wrongPicks, setWrongPicks] = useState([]); // indices clouded out this fork
  const [gliding, setGliding] = useState(false);
  const [altitude, setAltitude] = useState(100);
  const [berries, setBerries] = useState(0);
  const [streak, setStreak] = useState(0);
  const [result, setResult] = useState(null); // { ms, berries, highFlyer, newBest, bestMs }
  const startedAtRef = useRef(0);
  const glideTimerRef = useRef(null);

  const dealFork = useCallback((cfg) => {
    const p = generateProblem(cfg);
    setProblem(p);
    setChoices(buildChoices(p.answer));
    setWrongPicks([]);
  }, []);

  const startRun = useCallback((routeId) => {
    const r = ROUTES.find(x => x.id === routeId) || ROUTES[0];
    setRoute(r);
    setForkIndex(0);
    setAltitude(100);
    setBerries(0);
    setStreak(0);
    setResult(null);
    setGliding(false);
    dealFork(r);
    startedAtRef.current = Date.now();
    setStatus('flying');
  }, [dealFork]);

  const finishRun = useCallback((finalBerries, finalAltitude, r) => {
    const ms = Date.now() - startedAtRef.current;
    const highFlyer = finalAltitude >= HIGH_FLYER_ALTITUDE;
    const totalBerries = finalBerries + (highFlyer ? HIGH_FLYER_BONUS : 0);
    const prevBest = loadBestMs(username, r.id);
    const newBest = prevBest === null || ms < prevBest;
    if (newBest) {
      localStorage.setItem(bestTimeKey(username, r.id), String(ms));
    }
    setResult({ ms, berries: totalBerries, highFlyer, newBest, bestMs: newBest ? ms : prevBest });
    setStatus('done');
  }, [username]);

  const pickPath = useCallback((choiceIndex) => {
    if (status !== 'flying' || gliding || !problem) return false;
    if (wrongPicks.includes(choiceIndex)) return false;

    const correct = choices[choiceIndex] === problem.answer;
    if (!correct) {
      setStreak(0);
      setAltitude(a => Math.max(MIN_ALTITUDE, a - WRONG_ALTITUDE_COST));
      setWrongPicks(w => [...w, choiceIndex]);
      return false;
    }

    const newStreak = streak + 1;
    const earned = 1 + (newStreak >= 3 ? 1 : 0); // hot streaks pick double berries
    const newBerries = berries + earned;
    const newAltitude = Math.min(100, altitude + CORRECT_ALTITUDE_LIFT);
    setStreak(newStreak);
    setBerries(newBerries);
    setAltitude(newAltitude);

    const nextFork = forkIndex + 1;
    if (nextFork >= TOTAL_FORKS) {
      finishRun(newBerries, newAltitude, route);
      return true;
    }

    // Brief glide between forks so the swoosh can play out.
    setGliding(true);
    clearTimeout(glideTimerRef.current);
    glideTimerRef.current = setTimeout(() => {
      setForkIndex(nextFork);
      dealFork(route);
      setGliding(false);
    }, GLIDE_MS);
    return true;
  }, [status, gliding, problem, wrongPicks, choices, streak, berries, altitude, forkIndex, route, dealFork, finishRun]);

  const backToRoutes = useCallback(() => {
    clearTimeout(glideTimerRef.current);
    setStatus('ready');
    setRoute(null);
    setProblem(null);
  }, []);

  return {
    status,
    route,
    forkIndex,
    totalForks: TOTAL_FORKS,
    problem,
    choices,
    wrongPicks,
    gliding,
    altitude,
    berries,
    streak,
    result,
    startRun,
    pickPath,
    backToRoutes,
  };
}
