// Pure game rules: conditions, effects, tokens, scoring, gating. No DOM, no three.js, no story
// text. Only type imports, so plain Node can run this file directly (see rules.test.mjs).
import type { FinalDecision, GameState, RoomId, SceneId } from './api';
import type {
  Condition,
  Effect,
  Manifest,
  Readout,
  Story,
  StoryChoice,
  StoryHotspot,
  StoryLine,
  StoryNode,
  Subtitle,
  VideoFiles,
} from './types';

export const SAVE_KEY = 'kalpa.save.v1';
export const SETTINGS_KEY = 'kalpa.settings.v1';

export const ROOM_IDS: RoomId[] = ['room1', 'room2', 'room3', 'room4'];
export const SCENE_IDS: SceneId[] = [
  'prologue',
  'hub',
  'room1',
  'room2',
  'room3',
  'room4',
  'room5',
  'sub_chamber',
  'moonpool',
  'ending',
];

export const FRAGMENT_OF_ROOM: Record<RoomId, number> = { room1: 1, room2: 2, room3: 3, room4: 4 };

export function isRoom(id: string): id is RoomId {
  return (ROOM_IDS as string[]).includes(id);
}

export function newState(prologueSeen = false): GameState {
  return {
    version: 1,
    scene: 'prologue',
    visitedOrder: [],
    entryCounts: {},
    fragments: [],
    choices: {},
    weights: { room1: 0, room2: 0, room3: 0, room4: 0 },
    finalDecision: null,
    flags: {},
    seenHotspots: [],
    prologueSeen,
  };
}

/** Parses a stored save. Anything unusable returns null, never throws. */
export function parseSave(raw: string | null): GameState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<GameState>;
    if (!v || v.version !== 1 || !SCENE_IDS.includes(v.scene as SceneId)) return null;
    return { ...newState(), ...v } as GameState;
  } catch {
    return null;
  }
}

// --- Scoring ---------------------------------------------------------------------------------

/**
 * Highest weight wins. Ties go to the most recently visited of the tied rooms.
 * With no control choice at all the result is `hopeful`.
 */
export function computeDominant(state: GameState): RoomId | 'hopeful' {
  const max = Math.max(...ROOM_IDS.map((r) => state.weights[r] ?? 0));
  if (max <= 0) return 'hopeful';
  const tied = ROOM_IDS.filter((r) => (state.weights[r] ?? 0) === max);
  return tied.reduce((best, r) =>
    state.visitedOrder.indexOf(r) > state.visitedOrder.indexOf(best) ? r : best,
  );
}

export function controlCount(state: GameState): number {
  return ROOM_IDS.reduce((n, r) => n + (state.weights[r] ?? 0), 0);
}

export function variantId(state: GameState): string {
  return `${computeDominant(state)}_${state.finalDecision ?? 'none'}`;
}

export interface ReadoutResult {
  dominant: RoomId | 'hopeful';
  label: string;
  from: number;
  to: number;
  /** One entry per displayed readout. The hopeful variant has all four, falling. */
  rows: { room: RoomId; label: string; from: number; to: number }[];
}

function risingTo(readout: Readout, count: number): number {
  const table = readout.toByControlCount;
  const to = table[Math.min(count, table.length - 1)];
  return typeof to === 'number' ? to : readout.from;
}

export function computeReadout(story: Story, state: GameState): ReadoutResult {
  const dominant = computeDominant(state);
  const { readouts, hopefulFalling } = story.ending;
  if (dominant === 'hopeful') {
    const rows = ROOM_IDS.map((room) => ({
      room,
      label: readouts[room].label,
      from: hopefulFalling[room][0],
      to: hopefulFalling[room][1],
    }));
    const last = state.visitedOrder[state.visitedOrder.length - 1] ?? 'room1';
    const lastRow = rows.find((r) => r.room === last) ?? rows[0];
    return { dominant, label: lastRow.label, from: lastRow.from, to: lastRow.to, rows };
  }
  const readout = readouts[dominant];
  const to = risingTo(readout, controlCount(state));
  return {
    dominant,
    label: readout.label,
    from: readout.from,
    to,
    rows: [{ room: dominant, label: readout.label, from: readout.from, to }],
  };
}

// --- Conditions ------------------------------------------------------------------------------

export function evalCondition(cond: Condition | null | undefined, state: GameState): boolean {
  if (!cond) return true;
  const keys = Object.keys(cond);
  if (keys.length === 0) return true;
  const c = cond as Record<string, unknown>;
  const key = keys[0];
  const val = c[key];
  switch (key) {
    case 'visited':
      return state.visitedOrder.includes(val as RoomId);
    case 'returning':
      return (state.entryCounts?.[val as RoomId] ?? 0) > 1;
    case 'firstRoom':
      return state.visitedOrder[0] === val;
    case 'lastRoom':
      return state.visitedOrder.length === 4 && state.visitedOrder[3] === val;
    case 'fragments':
      return state.fragments.length >= (val as number);
    case 'hasFragment':
      return state.fragments.includes(val as number);
    case 'flag':
      return !!state.flags[val as string];
    case 'choice': {
      const v = val as { room: RoomId; tag: string };
      return state.choices[v.room]?.tag === v.tag;
    }
    case 'final':
      return state.finalDecision === val;
    case 'dominant':
      return computeDominant(state) === val;
    case 'all':
      return (val as Condition[]).every((x) => evalCondition(x, state));
    case 'any':
      return (val as Condition[]).some((x) => evalCondition(x, state));
    case 'not':
      return !evalCondition(val as Condition, state);
    default:
      console.warn(`[kalpa] unknown condition "${key}"`);
      return false;
  }
}

export function visibleLines(node: StoryNode, state: GameState): StoryLine[] {
  return (node.lines ?? []).filter((l) => evalCondition(l.if, state));
}

export function visibleChoices(node: StoryNode, state: GameState): StoryChoice[] {
  return (node.choices ?? []).filter((c) => evalCondition(c.if, state));
}

// --- Effects ---------------------------------------------------------------------------------

/**
 * Applies only the part of an effect that changes GameState, and returns a new state.
 * goto, cue, music and monitor return the state unchanged: the engine runs those.
 * A room's choice is set once. Repeating it can't add weight or change the tag.
 */
export function applyEffect(state: GameState, effect: Effect): GameState {
  if ('flag' in effect) return { ...state, flags: { ...state.flags, [effect.flag]: true } };
  if ('fragment' in effect) {
    if (state.fragments.includes(effect.fragment)) return state;
    return { ...state, fragments: [...state.fragments, effect.fragment].sort((a, b) => a - b) };
  }
  if ('choose' in effect) {
    const { room, tag, id } = effect.choose;
    if (state.choices[room]) return state;
    return {
      ...state,
      choices: { ...state.choices, [room]: { tag, id } },
      weights: { ...state.weights, [room]: tag === 'control' ? 1 : 0 },
    };
  }
  if ('final' in effect) return { ...state, finalDecision: effect.final };
  return state;
}

// --- Gating ----------------------------------------------------------------------------------

export function roomComplete(state: GameState, room: RoomId): boolean {
  return state.fragments.includes(FRAGMENT_OF_ROOM[room]) && !!state.choices[room];
}

/** Rooms 1–4 can be re-entered until room5; room5 needs all four fragments. */
export function canEnter(state: GameState, target: SceneId): boolean {
  if (target === 'room5') return state.fragments.length >= 4;
  return true;
}

/** True once a room has been entered more than once (a re-entry). */
export function isReturning(state: GameState, room: RoomId): boolean {
  return (state.entryCounts?.[room] ?? 0) > 1;
}

/** Records a room as visited the moment it is entered, and keeps the first-entry order. */
export function recordEntry(state: GameState, scene: SceneId): GameState {
  const visitedOrder =
    isRoom(scene) && !state.visitedOrder.includes(scene)
      ? [...state.visitedOrder, scene]
      : state.visitedOrder;
  const entryCounts = isRoom(scene)
    ? { ...state.entryCounts, [scene]: (state.entryCounts?.[scene] ?? 0) + 1 }
    : state.entryCounts;
  return { ...state, scene, visitedOrder, entryCounts };
}

/**
 * One result per hotspot id. Repeated ids are alternatives: the first whose `if` passes is used,
 * e.g. post-choice variants.
 * On the first visit a room's exit stays hidden until its fragment and choice are done; on re-entry it is available at once.
 */
export function resolveHotspots(
  story: Story,
  sceneId: SceneId,
  state: GameState,
): { id: string; entry: StoryHotspot | null; visible: boolean }[] {
  const entries = story.scenes[sceneId]?.hotspots ?? [];
  const ids = [...new Set(entries.map((h) => h.id))];
  return ids.map((id) => {
    let entry = entries.find((h) => h.id === id && evalCondition(h.if, state)) ?? null;
    if (entry && id === 'exit' && isRoom(sceneId) && !roomComplete(state, sceneId) && !isReturning(state, sceneId)) entry = null;
    return { id, entry, visible: !!entry };
  });
}

// --- Tokens ----------------------------------------------------------------------------------

export function roomOrderText(story: Story, state: GameState): string {
  return state.visitedOrder
    .map((r) => story.strings.roomNames[r] ?? r)
    .join(story.strings.roomListJoiner);
}

export function expandTokens(text: string, story: Story, state: GameState): string {
  if (!text.includes('{{')) return text;
  return text.replace(/\{\{([^}]+)\}\}/g, (whole, raw: string) => {
    const token = raw.trim();
    if (token === 'roomOrder') return roomOrderText(story, state);
    if (token.startsWith('choiceLog:')) {
      const room = token.slice('choiceLog:'.length) as RoomId;
      const tag = state.choices[room]?.tag;
      return tag ? (story.strings.choiceLog[`${room}.${tag}`] ?? '') : '';
    }
    if (token === 'readoutLabel') return computeReadout(story, state).label;
    if (token === 'readoutFrom') return String(computeReadout(story, state).from);
    if (token === 'readoutTo') return String(computeReadout(story, state).to);
    console.warn(`[kalpa] unknown token ${whole}`);
    return '';
  });
}

/** Lines for a monitor effect: explicit lines, then strings.monitors, then the computed ending text. */
export function monitorLines(
  story: Story,
  state: GameState,
  kind: string,
  explicit?: string[],
): string[] {
  const authored = explicit ?? story.strings.monitors?.[kind];
  if (authored) return authored.map((t) => expandTokens(t, story, state));
  switch (kind) {
    case 'countdown':
      return [story.ending.countdown];
    case 'variable':
      return [story.ending.variable];
    case 'readout':
      return computeReadout(story, state).rows.map((r) => `${r.label}: ${r.from}% → ${r.to}%`);
    case 'journey':
      return [
        roomOrderText(story, state),
        ...state.visitedOrder.map((r) => expandTokens(`{{choiceLog:${r}}}`, story, state)),
      ].filter(Boolean);
    default:
      return [];
  }
}

// --- Prologue --------------------------------------------------------------------------------

export function subtitleAt(subs: Subtitle[], t: number): string | null {
  for (const s of subs) if (t >= s.start && t < s.end) return s.text;
  return null;
}

export interface VideoEnv {
  width: number;
  height: number;
  dpr: number;
  saveData?: boolean;
  effectiveType?: string;
  downlink?: number;
  canPlay: (mime: string) => string;
}

/** Picks a video file by viewport, connection and format support. Null if none is usable. */
export function pickVideo(manifest: Manifest, env: VideoEnv): string | null {
  const entry = manifest.video?.prologue;
  if (!entry) return null;
  const slow =
    !!env.saveData ||
    (!!env.effectiveType && env.effectiveType !== '4g') ||
    (env.downlink !== undefined && env.downlink > 0 && env.downlink < 5);
  const small = Math.max(env.width, env.height) * Math.min(env.dpr || 1, 2) < 1200;
  const order: ('1080' | '720')[] = slow || small ? ['720', '1080'] : ['1080', '720'];
  const webm = env.canPlay('video/webm; codecs="vp9"') === 'probably';
  const mp4 = env.canPlay('video/mp4; codecs="avc1.640028"') !== '';
  for (const res of order) {
    const files: VideoFiles | undefined = entry[res];
    if (!files) continue;
    if (webm && files.webm) return files.webm;
    if (mp4 && files.mp4) return files.mp4;
    if (files.webm && env.canPlay('video/webm') !== '') return files.webm;
  }
  return null;
}

// --- Debug -----------------------------------------------------------------------------------

/** State that scores to the given ending. Room order is kept when complete, otherwise 1 to 4. */
export function stateForEnding(base: GameState, dominant: string, final: FinalDecision): GameState {
  const visitedOrder = base.visitedOrder.length === 4 ? base.visitedOrder : [...ROOM_IDS];
  const choices: GameState['choices'] = {};
  const weights = { room1: 0, room2: 0, room3: 0, room4: 0 };
  for (const room of ROOM_IDS) {
    const control = room === dominant;
    choices[room] = { tag: control ? 'control' : 'trust', id: 'debug' };
    weights[room] = control ? 1 : 0;
  }
  return {
    ...base,
    visitedOrder,
    fragments: [1, 2, 3, 4],
    choices,
    weights,
    finalDecision: final,
  };
}
