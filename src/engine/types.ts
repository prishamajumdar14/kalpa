// Data shapes for src/data/story.json and the synced asset manifest. See docs/CONTRACTS.md.
import type { ChoiceTag, FinalDecision, RoomId, SceneId } from './api';

export type Condition =
  | { visited: RoomId }
  | { returning: RoomId }
  | { firstRoom: RoomId }
  | { lastRoom: RoomId }
  | { fragments: number }
  | { hasFragment: number }
  | { flag: string }
  | { choice: { room: RoomId; tag: ChoiceTag } }
  | { final: FinalDecision }
  | { dominant: string }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | Record<string, never>;

export type Effect = { if?: Condition } & (
  | { flag: string }
  | { fragment: number }
  | { choose: { room: RoomId; tag: ChoiceTag; id: string } }
  | { final: FinalDecision }
  | { goto: SceneId }
  | { cue: string }
  | { music: string }
  | { monitor: string; lines?: string[] }
);

export interface StoryLine {
  speaker: string;
  text: string;
  if?: Condition;
  cue?: string;
  lineId?: string;
}

export interface StoryChoice {
  id: string;
  text: string;
  tag?: ChoiceTag;
  if?: Condition;
  effects?: Effect[];
  next?: string | null;
}

export interface StoryNode {
  lines?: StoryLine[];
  effects?: Effect[];
  choices?: StoryChoice[];
  next?: string | null;
}

export interface StoryHotspot {
  id: string;
  label: string;
  node?: string;
  if?: Condition;
}

export interface StoryScene {
  title?: string;
  music?: string;
  entryNode?: string;
  hotspots?: StoryHotspot[];
}

export interface Readout {
  label: string;
  from: number;
  toByControlCount: (number | null)[];
}

export interface Story {
  version: number;
  speakers: Record<string, { name: string; color: string }>;
  strings: {
    roomNames: Record<string, string>;
    roomListJoiner: string;
    /** Shown over the placeholder prologue while the cinematic is not yet shipped. */
    prologueNote?: string;
    choiceLog: Record<string, string>;
    /** Optional monitor text by kind, tokens allowed. */
    monitors?: Record<string, string[]>;
  };
  scenes: Partial<Record<SceneId, StoryScene>>;
  nodes: Record<string, StoryNode>;
  ending: {
    readouts: Record<RoomId, Readout>;
    hopefulFalling: Record<RoomId, [number, number]>;
    countdown: string;
    variable: string;
  };
  credits: { role: string; name: string }[];
}

export interface ModelEntry {
  file: string;
  status?: string;
  exposure?: number;
  fog?: { color: string; near: number; far: number } | null;
  /** Engine tuning (tools/scene_tuning.json): multiplier on converted light units, default 1. */
  lightScale?: number;
  /** Engine tuning: CAM_eye sideways nudge in metres. */
  eyeShift?: number;
  /** Engine tuning: bloom strength multiplier, default 1. */
  bloom?: number;
  /** Engine tuning: extra multiplier on sun lights only. */
  sunScale?: number;
  /** Engine tuning: flat fill standing in for Blender's world light. */
  ambient?: { sky: string; ground: string; intensity: number } | null;
  /** Engine tuning: uniform scale applied to the whale in this scene. */
  whaleScale?: number;
}

export interface VideoFiles {
  mp4?: string;
  webm?: string;
}

export interface VideoEntry {
  '1080'?: VideoFiles;
  '720'?: VideoFiles;
  vtt?: string;
  durationS?: number;
}

export interface Manifest {
  models: Record<string, ModelEntry>;
  video?: { prologue?: VideoEntry };
  /** Written by tools/sync_manifest.mjs from public/audio: cue id to its files. */
  audio?: Record<string, string[]>;
}

export interface Subtitle {
  start: number;
  end: number;
  speaker?: string;
  text: string;
}
