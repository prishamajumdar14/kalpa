// KALPA engine public API. docs/CONTRACTS.md Section 6 is the source of truth.
// The UI (src/ui/) uses only what is exported from this file.
//
// Semantics the contract leaves to the engine:
// - hotspots:update x, y are CSS pixels from the top-left of the viewport, ready for
//   position: fixed. `visible` is false during dialogue, loading and transitions, and when
//   the rules hide the hotspot, so the UI can render exactly the visible items.
// - fragment:collected: index is the fragment (1-4), total is how many are now held.
// - monitor:show: readout lines read "<LABEL>: 34% → 61%". The hopeful variant sends one
//   falling line per room. The UI may parse the two numbers to animate them.
// - Settings.textSpeed is a multiplier, 1 is normal. getSettings() returns 1000 while the
//   debug fastText mode is on: at 100 or more, show the text instantly.
// - Layout: the engine's canvas fills #stage. In portrait #stage is the top 56.25vw, and the
//   engine sets the CSS variable --kalpa-stage-h on <html>. The UI mounts over it.

export type SceneId =
  | 'prologue'
  | 'hub'
  | 'room1'
  | 'room2'
  | 'room3'
  | 'room4'
  | 'room5'
  | 'sub_chamber'
  | 'moonpool'
  | 'ending';

export type RoomId = 'room1' | 'room2' | 'room3' | 'room4';

export type ChoiceTag = 'control' | 'trust';

export type FinalDecision = 'intervene' | 'shutdown';

export interface GameState {
  version: 1;
  scene: SceneId;
  visitedOrder: RoomId[]; // room1–room4 only, first entries only
  entryCounts: Partial<Record<RoomId, number>>; // times each room has been entered
  fragments: number[]; // subset of 1..4
  choices: Partial<Record<RoomId, { tag: ChoiceTag; id: string }>>;
  weights: Record<RoomId, number>;
  finalDecision: FinalDecision | null;
  flags: Record<string, boolean>;
  seenHotspots: string[]; // "room1.kesav"
  prologueSeen: boolean; // kept across runs, enables Skip
}

export interface Settings {
  musicVolume: number;
  sfxVolume: number;
  textSpeed: number;
  reducedMotion: boolean;
  subtitles: boolean;
  quality: 'low' | 'high';
}

export type EngineEvents = {
  'scene:enter': { sceneId: SceneId; title: string };
  'scene:ready': { sceneId: SceneId };
  'scene:exit': { sceneId: SceneId };
  'loading:progress': { loaded: number; total: number };
  'dialogue:start': { nodeId: string };
  'dialogue:line': {
    nodeId: string;
    index: number;
    lineId?: string;
    speakerId: string;
    speakerName: string;
    color: string;
    text: string;
  };
  'dialogue:end': { nodeId: string };
  'choice:show': { nodeId: string; choices: { id: string; text: string; index: number }[] };
  'choice:made': { nodeId: string; id: string; tag?: ChoiceTag };
  'fragment:collected': { index: number; total: number };
  'hotspots:update': {
    items: { id: string; label: string; x: number; y: number; visible: boolean; seen: boolean }[];
  };
  'monitor:show': { kind: string; lines: string[] };
  'video:start': { canSkip: boolean };
  'video:cue': { text: string | null }; // subtitle text
  'video:end': {};
  'ending:computed': { dominant: string; final: string; variantId: string };
  'credits:show': {};
  'state:changed': { state: Readonly<GameState> };
  'audio:unlocked': {};
};

export interface Engine {
  on<K extends keyof EngineEvents>(e: K, fn: (p: EngineEvents[K]) => void): () => void;
  newGame(): void;
  continueGame(): boolean;
  hasSave(): boolean;
  advance(): void; // next line, or finish typing is the UI's job first
  choose(id: string): void;
  clickHotspot(id: string): void;
  skipVideo(): void;
  setSetting<K extends keyof Settings>(k: K, v: Settings[K]): void;
  getSettings(): Settings;
  getState(): Readonly<GameState>;
  pause(): void;
  resume(): void;
}

/** Shape of `window.__KALPA__`, present only with `?debug=1`. */
export interface KalpaDebug {
  engine: Engine;
  goto(sceneId: SceneId): void;
  setState(partial: Partial<GameState>): void;
  triggerEnding(dominant: string, final: string): void;
  fastText(on: boolean): void;
  story: unknown;
  lineLog: { nodeId: string; lineId?: string; speakerId: string; text: string }[];
  variantId(): string;
  fps(): number;
}
