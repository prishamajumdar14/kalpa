// The game state machine behind the Engine API. Everything browser-specific goes through Host,
// so the whole flow also runs headless in Node (see rules.test.mjs).
import type {
  ChoiceTag,
  Engine,
  EngineEvents,
  FinalDecision,
  GameState,
  SceneId,
  Settings,
} from './api';
import {
  SAVE_KEY,
  SETTINGS_KEY,
  applyEffect,
  canEnter,
  computeDominant,
  evalCondition,
  expandTokens,
  isRoom,
  monitorLines,
  newState,
  parseSave,
  recordEntry,
  resolveHotspots,
  stateForEnding,
  variantId,
  visibleChoices,
  visibleLines,
} from './rules';
import type { Effect, Story, StoryChoice, StoryLine, StoryNode } from './types';

export interface HotspotItem {
  id: string;
  label: string;
  visible: boolean;
  seen: boolean;
}

export interface Host {
  /** Load and show a scene. onProgress reports loaded and total asset counts. */
  loadScene(
    sceneId: SceneId,
    hotspotIds: string[],
    onProgress: (loaded: number, total: number) => void,
  ): Promise<void>;
  /** Runs the prologue video, or its timed placeholder, until it ends or is skipped. */
  playPrologue(canSkip: boolean, onCue: (text: string | null) => void): Promise<void>;
  skipPrologue(): void;
  /** True when no prologue video is shipped, so the short timed placeholder plays instead. */
  prologueIsPlaceholder(): boolean;
  blackout(): Promise<void>;
  finalShot(): Promise<void>;
  fadeOut(): Promise<void>;
  fadeIn(): Promise<void>;
  music(cueId: string | null): void;
  cue(cueId: string): void;
  stopLoops(): void;
  /** Light hub doors and symbols from the state. */
  syncState(state: GameState): void;
  setHotspots(sceneId: SceneId, items: HotspotItem[]): void;
  applySettings(settings: Settings): void;
  setPaused(paused: boolean): void;
  setFast(fast: boolean): void;
  preload(sceneId: SceneId, state: GameState): void;
  read(key: string): string | null;
  write(key: string, value: string): void;
}

type Listeners = { [K in keyof EngineEvents]?: Set<(p: EngineEvents[K]) => void> };

interface Run {
  nodeId: string;
  node: StoryNode;
  lines: StoryLine[];
  index: number;
  choices: StoryChoice[] | null;
}

interface Chain {
  entry?: boolean;
  hotspot?: string;
}

const COMPLETE_FLAG = '_run.complete';
const enteredFlag = (scene: SceneId) => `_entered.${scene}`;

export class Game implements Engine {
  private state: GameState;
  private settings: Settings;
  private listeners: Listeners = {};
  private active: SceneId | null = null;
  private run: Run | null = null;
  private chain: Chain | null = null;
  private pendingGoto: SceneId | null = null;
  private token = 0;
  private busy = true;
  private paused = false;
  private fast = false;
  private endingEmitted = false;
  private endingDone = false;

  readonly story: Story;
  private host: Host;

  constructor(story: Story, host: Host, defaults: Settings) {
    this.story = story;
    this.host = host;
    const saved = parseSave(this.host.read(SAVE_KEY));
    this.state = newState(saved?.prologueSeen ?? false);
    this.settings = { ...defaults, ...this.readSettings() };
    this.host.applySettings(this.settings);
    this.host.music('mus_title');
  }

  // --- Public API ---

  on<K extends keyof EngineEvents>(e: K, fn: (p: EngineEvents[K]) => void): () => void {
    const L = this.listeners as Record<string, Set<unknown> | undefined>;
    const set = (L[e] ??= new Set()) as Set<(p: EngineEvents[K]) => void>;
    set.add(fn);
    return () => set.delete(fn);
  }

  newGame(): void {
    const saved = parseSave(this.host.read(SAVE_KEY));
    this.state = newState(this.state.prologueSeen || !!saved?.prologueSeen);
    this.endingEmitted = false;
    this.endingDone = false;
    this.commit();
    void this.enter('prologue');
  }

  continueGame(): boolean {
    const saved = parseSave(this.host.read(SAVE_KEY));
    if (!saved || saved.flags[COMPLETE_FLAG]) return false;
    this.state = saved;
    this.endingEmitted = false;
    this.endingDone = false;
    void this.enter(saved.scene, { resume: true });
    return true;
  }

  hasSave(): boolean {
    const saved = parseSave(this.host.read(SAVE_KEY));
    return !!saved && !saved.flags[COMPLETE_FLAG];
  }

  advance(): void {
    const run = this.run;
    if (this.paused || !run || run.choices) return;
    if (run.index + 1 < run.lines.length) {
      run.index += 1;
      this.showLine();
    } else {
      this.finishLines();
    }
  }

  choose(id: string): void {
    const run = this.run;
    if (this.paused || !run?.choices) return;
    const choice = run.choices.find((c) => c.id === id);
    if (!choice) {
      console.warn(`[kalpa] no visible choice "${id}" in ${run.nodeId}`);
      return;
    }
    const tag: ChoiceTag | undefined = choice.tag;
    this.emit('choice:made', { nodeId: run.nodeId, id, tag });
    const effects = [...(choice.effects ?? [])];
    // A tagged choice in a room scores even if the story left out the explicit effect.
    const room = run.nodeId.split('.')[0];
    if (tag && isRoom(room) && !effects.some((e) => 'choose' in e)) {
      effects.unshift({ choose: { room, tag, id } });
    }
    this.applyEffects(effects);
    this.endNode(run.nodeId, choice.next !== undefined ? choice.next : run.node.next);
  }

  clickHotspot(id: string): void {
    if (this.paused || this.busy || this.run || !this.active) return;
    const scene = this.active;
    const hit = resolveHotspots(this.story, scene, this.state).find((h) => h.id === id);
    if (!hit?.entry) return;
    const key = `${scene}.${id}`;
    if (!this.state.seenHotspots.includes(key)) {
      this.state = { ...this.state, seenHotspots: [...this.state.seenHotspots, key] };
      this.commit();
    }
    this.chain = { hotspot: id };
    if (hit.entry.node) this.startNode(hit.entry.node);
    else this.chainEnd();
  }

  skipVideo(): void {
    this.host.skipPrologue();
  }

  setSetting<K extends keyof Settings>(k: K, v: Settings[K]): void {
    this.settings = { ...this.settings, [k]: v };
    this.host.write(SETTINGS_KEY, JSON.stringify(this.settings));
    this.host.applySettings(this.settings);
  }

  getSettings(): Settings {
    return this.fast ? { ...this.settings, textSpeed: 1000 } : { ...this.settings };
  }

  getState(): Readonly<GameState> {
    return this.state;
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.host.setPaused(true);
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.host.setPaused(false);
  }

  // --- Debug, used only by debug.ts ---

  debugGoto(sceneId: SceneId): void {
    void this.enter(sceneId);
  }

  debugSetState(partial: Partial<GameState>): void {
    this.state = { ...this.state, ...partial };
    this.commit();
  }

  debugTriggerEnding(dominant: string, final: string): void {
    this.state = stateForEnding(this.state, dominant, final as FinalDecision);
    this.endingEmitted = false;
    this.endingDone = false;
    this.commit();
    void this.enter('ending');
  }

  debugFastText(on: boolean): void {
    this.fast = on;
    this.host.setFast(on);
  }

  debugVariantId(): string {
    return variantId(this.state);
  }

  emit<K extends keyof EngineEvents>(e: K, payload: EngineEvents[K]): void {
    const set = this.listeners[e] as Set<(p: EngineEvents[K]) => void> | undefined;
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[kalpa] listener for ${e} threw`, err);
      }
    }
  }

  // --- Scenes ---

  private async enter(sceneId: SceneId, opts: { resume?: boolean } = {}): Promise<void> {
    const token = ++this.token;
    const stale = () => token !== this.token;
    this.run = null;
    this.chain = null;
    this.pendingGoto = null;
    this.busy = true;
    this.pushHotspots();

    const prev = this.active;
    if (prev) {
      this.emit('scene:exit', { sceneId: prev });
      await this.host.fadeOut();
      if (stale()) return;
      this.host.stopLoops();
      if (prev === 'prologue' && sceneId === 'hub') {
        this.host.music(null);
        await this.host.blackout();
        if (stale()) return;
      }
    }

    this.active = sceneId;
    this.state = recordEntry(this.state, sceneId);
    this.commit();
    const scene = this.story.scenes[sceneId];
    this.emit('scene:enter', { sceneId, title: scene?.title ?? '' });

    if (sceneId === 'prologue') {
      this.host.music(null);
      this.host.preload(sceneId, this.state);
      const canSkip = this.state.prologueSeen || this.host.prologueIsPlaceholder();
      this.emit('video:start', { canSkip });
      await this.host.playPrologue(canSkip, (text) => {
        if (!stale()) this.emit('video:cue', { text });
      });
      if (stale()) return;
      this.emit('video:cue', { text: null });
      this.emit('video:end', {});
      this.state = { ...this.state, prologueSeen: true };
      this.commit();
    }

    this.host.music(scene?.music ?? null);
    const ids = [...new Set((scene?.hotspots ?? []).map((h) => h.id))];
    this.emit('loading:progress', { loaded: 0, total: 1 });
    await this.host.loadScene(sceneId, ids, (loaded, total) => {
      if (!stale()) this.emit('loading:progress', { loaded, total });
    });
    if (stale()) return;
    this.emit('scene:ready', { sceneId });
    this.host.syncState(this.state);
    this.host.preload(sceneId, this.state);
    this.busy = false;
    void this.host.fadeIn();

    if (sceneId === 'ending') this.emitEnding();

    const entry = scene?.entryNode;
    if (entry && !(opts.resume && this.state.flags[enteredFlag(sceneId)])) {
      this.chain = { entry: true };
      this.startNode(entry);
    } else {
      this.chain = { entry: true };
      this.chainEnd();
    }
  }

  private emitEnding(): void {
    if (this.endingEmitted) return;
    this.endingEmitted = true;
    this.emit('ending:computed', {
      dominant: computeDominant(this.state),
      final: this.state.finalDecision ?? 'none',
      variantId: variantId(this.state),
    });
  }

  private async finishEnding(): Promise<void> {
    if (this.endingDone) return;
    this.endingDone = true;
    const token = this.token;
    this.busy = true;
    await this.host.finalShot();
    if (token !== this.token) return;
    this.state = { ...this.state, flags: { ...this.state.flags, [COMPLETE_FLAG]: true } };
    this.commit();
    this.host.music('mus_credits');
    this.emit('credits:show', {});
  }

  // --- Dialogue ---

  private startNode(nodeId: string, depth = 0): void {
    const node = this.story.nodes[nodeId];
    if (!node) {
      console.warn(`[kalpa] missing node "${nodeId}"`);
      this.chainEnd();
      return;
    }
    const lines = visibleLines(node, this.state);
    if (lines.length === 0 && visibleChoices(node, this.state).length === 0) {
      // Nothing to show: run the effects silently and move on.
      this.applyEffects(node.effects ?? []);
      if (node.next && depth < 64) this.startNode(node.next, depth + 1);
      else this.chainEnd();
      return;
    }
    this.run = { nodeId, node, lines, index: 0, choices: null };
    this.pushHotspots();
    this.emit('dialogue:start', { nodeId });
    if (lines.length > 0) this.showLine();
    else this.finishLines();
  }

  private showLine(): void {
    const run = this.run!;
    const line = run.lines[run.index];
    const speaker = this.story.speakers[line.speaker];
    if (line.cue) this.host.cue(line.cue);
    this.emit('dialogue:line', {
      nodeId: run.nodeId,
      index: run.index,
      lineId: line.lineId,
      speakerId: line.speaker,
      speakerName: speaker?.name ?? '',
      color: speaker?.color ?? '#ffffff',
      text: expandTokens(line.text, this.story, this.state),
    });
  }

  private finishLines(): void {
    const run = this.run!;
    this.applyEffects(run.node.effects ?? []);
    const choices = visibleChoices(run.node, this.state);
    if (choices.length > 0) {
      run.choices = choices;
      this.emit('choice:show', {
        nodeId: run.nodeId,
        choices: choices.map((c, index) => ({
          id: c.id,
          text: expandTokens(c.text, this.story, this.state),
          index,
        })),
      });
      return;
    }
    this.endNode(run.nodeId, run.node.next);
  }

  private endNode(nodeId: string, next: string | null | undefined): void {
    this.run = null;
    this.emit('dialogue:end', { nodeId });
    if (next) this.startNode(next);
    else this.chainEnd();
  }

  /** The dialogue chain is over: travel if asked, otherwise back to free exploration. */
  private chainEnd(): void {
    const chain = this.chain;
    this.chain = null;
    this.run = null;
    const scene = this.active;
    if (!scene) return;

    if (chain?.entry && !this.state.flags[enteredFlag(scene)]) {
      this.state = { ...this.state, flags: { ...this.state.flags, [enteredFlag(scene)]: true } };
      this.commit();
    }

    const target = this.pendingGoto;
    this.pendingGoto = null;
    if (target) {
      if (canEnter(this.state, target)) {
        void this.enter(target);
        return;
      }
      console.warn(`[kalpa] travel to ${target} blocked`);
    }

    if (scene === 'ending') {
      void this.finishEnding();
    } else if (scene === 'prologue' && this.prologueBeatDone()) {
      void this.enter('hub');
      return;
    } else if (chain?.hotspot === 'exit' && isRoom(scene)) {
      // A completed room's exit always leads back to the hub.
      void this.enter('hub');
      return;
    }
    this.pushHotspots();
  }

  /** Both power attempts have failed, or the story defined no attempts at all. */
  private prologueBeatDone(): boolean {
    const hotspots = this.story.scenes.prologue?.hotspots ?? [];
    return hotspots.every((h) => this.state.seenHotspots.includes(`prologue.${h.id}`));
  }

  // --- Effects and state ---

  private applyEffects(effects: Effect[]): void {
    for (const e of effects) {
      if (e.if && !evalCondition(e.if, this.state)) continue;
      const before = this.state;
      this.state = applyEffect(before, e);
      if ('fragment' in e && this.state !== before) {
        this.host.cue('sfx_fragment');
        this.host.cue('whale_motif');
        this.emit('fragment:collected', { index: e.fragment, total: this.state.fragments.length });
      } else if ('goto' in e) {
        this.pendingGoto = e.goto;
      } else if ('cue' in e) {
        this.host.cue(e.cue);
      } else if ('music' in e) {
        this.host.music(e.music);
      } else if ('monitor' in e) {
        this.emit('monitor:show', {
          kind: e.monitor,
          lines: monitorLines(this.story, this.state, e.monitor, e.lines),
        });
      }
      this.commit();
    }
  }

  private commit(): void {
    this.host.write(SAVE_KEY, JSON.stringify(this.state));
    this.host.syncState(this.state);
    this.emit('state:changed', { state: this.state });
    this.pushHotspots();
  }

  private pushHotspots(): void {
    const scene = this.active;
    if (!scene) return;
    const idle = !this.busy && !this.run && !this.chain;
    const items = resolveHotspots(this.story, scene, this.state).map((h) => ({
      id: h.id,
      label: h.entry?.label ?? '',
      visible: idle && h.visible,
      seen: this.state.seenHotspots.includes(`${scene}.${h.id}`),
    }));
    this.host.setHotspots(scene, items);
  }

  private readSettings(): Partial<Settings> {
    const raw = this.host.read(SETTINGS_KEY);
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Partial<Settings>;
    } catch {
      return {};
    }
  }
}
