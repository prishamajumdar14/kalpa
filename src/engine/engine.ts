// Wires the game core to the browser: stage, audio, prologue, fades and storage.
import type { Engine, EngineEvents, GameState, SceneId, Settings } from './api';
import { Audio } from './audio';
import { Game } from './core';
import type { Host, HotspotItem } from './core';
import { isRoom, ROOM_IDS } from './rules';
import { Stage, modelFor } from './stage';
import type { Manifest, Story, Subtitle } from './types';
import { ProloguePlayer } from './video';

const FADE_MS = 450;
const BLACKOUT_MS = 5000;
const FINAL_HOLD_MS = 3000;
const FAST_MS = 30;

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function defaultSettings(): Settings {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const lowEnd = coarse || !!nav.connection?.saveData || (nav.deviceMemory ?? 8) < 4;
  return {
    musicVolume: 0.7,
    sfxVolume: 0.8,
    textSpeed: 1,
    reducedMotion: reduced,
    subtitles: true,
    quality: lowEnd ? 'low' : 'high',
  };
}

export interface BuiltEngine {
  engine: Engine;
  game: Game;
  stage: Stage;
}

export function createEngine(
  container: HTMLElement,
  story: Story,
  manifest: Manifest,
  subs: Subtitle[],
): BuiltEngine {
  // Scene-level overlay for fades and the blackout. The prologue's video and the placeholder sit
  // under it, inside the stage, so portrait keeps them in the 16:9 strip.
  const fade = document.createElement('div');
  fade.style.cssText = 'position:absolute;inset:0;background:var(--kalpa-fade,#000);opacity:1;pointer-events:none;z-index:2';
  container.appendChild(fade);

  let fast = false;
  let paused = false;
  let settings: Settings = defaultSettings();
  let prologue: ProloguePlayer | null = null;
  let game: Game | null = null;
  const memory = new Map<string, string>();

  const audio = new Audio(manifest, () => game?.emit('audio:unlocked', {}));
  const stage = new Stage(container, manifest, story, (items) => {
    game?.emit('hotspots:update', { items });
  });

  document.addEventListener('visibilitychange', () => audio.setHidden(document.hidden));

  const fadeMs = () => (fast || settings.reducedMotion ? 0 : FADE_MS);

  const setFade = (opacity: number): Promise<void> =>
    new Promise((resolve) => {
      const ms = fadeMs();
      fade.style.transition = ms ? `opacity ${ms}ms ease` : 'none';
      fade.style.opacity = String(opacity);
      if (ms) window.setTimeout(resolve, ms);
      else resolve();
    });

  /** Waits a duration of unpaused, visible time. */
  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      let left = fast ? Math.min(ms, FAST_MS) : ms;
      let last = performance.now();
      const id = window.setInterval(() => {
        const now = performance.now();
        if (!paused && !document.hidden) left -= now - last;
        last = now;
        if (left <= 0) {
          window.clearInterval(id);
          resolve();
        }
      }, 25);
    });

  const idle = (fn: () => void) => {
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
    if (ric) ric(fn);
    else window.setTimeout(fn, 200);
  };

  /** The next scenes the player is likely to reach. */
  const likelyNext = (sceneId: SceneId, state: GameState): string[] => {
    switch (sceneId) {
      case 'prologue':
        return ['cockpit', 'hub', 'char_arjun'];
      case 'hub': {
        const open = ROOM_IDS.filter((r) => !state.visitedOrder.includes(r));
        return open.length ? open.slice(0, 2) : ['room5', 'whale', 'char_sato'];
      }
      case 'room5':
        return ['sub_chamber', 'moonpool'];
      case 'sub_chamber':
        return ['moonpool', 'ending', 'whale'];
      case 'moonpool':
        return ['ending', 'whale'];
      default:
        return isRoom(sceneId) ? ['hub'] : [];
    }
  };

  // Skip pressed in the short window before the ProloguePlayer is created (B8).
  let prologueStarting = false;
  let prologueCanSkip = false;
  let skipRequested = false;

  const host: Host = {
    loadScene: (sceneId, ids, onProgress) => stage.load(sceneId, ids, onProgress),

    async playPrologue(canSkip, onCue) {
      stage.setVideoActive(true);
      prologueStarting = true;
      prologueCanSkip = canSkip;
      skipRequested = false;
      await setFade(0);
      prologueStarting = false;
      if (skipRequested) {
        // Skip was pressed before the player existed: honour it, never start the video.
        skipRequested = false;
        fade.style.transition = 'none';
        fade.style.opacity = '1';
        stage.setVideoActive(false);
        return;
      }
      prologue = new ProloguePlayer({
        container,
        manifest,
        subs,
        canSkip,
        note: story.strings.prologueNote,
        onCue,
        volume: () => settings.musicVolume,
        isFast: () => fast,
        startMix: () => audio.cue('prologue_mix', { volume: settings.musicVolume / (settings.sfxVolume || 1) }),
        stopMix: () => audio.stopCue('prologue_mix'),
      });
      await prologue.play();
      prologue = null;
      fade.style.transition = 'none';
      fade.style.opacity = '1';
      stage.setVideoActive(false);
    },

    skipPrologue: () => {
      if (prologue) prologue.skip();
      else if (prologueStarting && prologueCanSkip) skipRequested = true;
    },
    prologueIsPlaceholder: () => !manifest.video?.prologue?.['1080'] && !manifest.video?.prologue?.['720'],

    async blackout() {
      fade.style.transition = 'none';
      fade.style.opacity = '1';
      audio.cue('sfx_heartbeat');
      audio.cue('whale_motif', { volume: 0.35, rate: 0.85 });
      await wait(BLACKOUT_MS);
      audio.stopLoops();
    },

    async finalShot() {
      const openMs = stage.startFinalShot();
      audio.cue('whale_final');
      await wait(openMs + FINAL_HOLD_MS);
      await setFade(1);
    },

    fadeOut: () => setFade(1),
    fadeIn: () => setFade(0),
    music: (id) => audio.music(id),
    cue: (id) => audio.cue(id),
    stopLoops: () => audio.stopLoops(),
    syncState: (state) => stage.sync(state),

    setHotspots(_sceneId, items: HotspotItem[]) {
      stage.setHotspots(items);
    },

    applySettings(next) {
      settings = next;
      audio.setVolumes(next.musicVolume, next.sfxVolume);
      prologue?.setVolume(next.musicVolume);
      stage.applySettings(next);
    },

    setPaused(value) {
      paused = value;
      stage.setPaused(value);
      audio.setDucked(value);
      prologue?.setPaused(value);
    },

    setFast(value) {
      fast = value;
    },

    preload(sceneId, state) {
      if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
      for (const key of likelyNext(sceneId, state)) {
        if (modelFor(manifest, key)) idle(() => stage.prefetch(key));
      }
    },

    read(key) {
      try {
        const value = browserStorage()?.getItem(key);
        if (value !== null && value !== undefined) return value;
      } catch {
        // Storage blocked: the in-memory copy below still works for this session.
      }
      return memory.get(key) ?? null;
    },

    write(key, value) {
      memory.set(key, value);
      try {
        browserStorage()?.setItem(key, value);
      } catch {
        // Storage blocked or full. The game carries on without saving to disk.
      }
    },
  };

  game = new Game(story, host, settings);
  game.on('monitor:show', () => stage.lightMonitor());
  return { engine: game, game, stage };
}

export type { EngineEvents };
