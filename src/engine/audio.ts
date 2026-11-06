// Audio through a single unlock path. Nothing is created or played before the first user gesture,
// and a cue that isn't in the manifest does nothing and makes no network request.
import { Howl, Howler } from 'howler';
import type { Manifest } from './types';

const LOOPING = new Set(['amb_cockpit_fail', 'sfx_heartbeat']);
const CROSSFADE_MS = 1500;
const DEDUPE_MS = 200;

export class Audio {
  private unlocked = false;
  private wantedMusic: string | null = null;
  private current: { id: string; howl: Howl } | null = null;
  private sfxCache = new Map<string, Howl>();
  private lastPlayed = new Map<string, number>();
  private loops = new Set<Howl>();
  private musicVolume = 0.7;
  private sfxVolume = 0.8;
  private duck = 1;

  constructor(
    private manifest: Manifest,
    private onUnlock: () => void,
  ) {
    const events = ['pointerdown', 'keydown', 'touchend'] as const;
    const unlock = () => {
      for (const e of events) window.removeEventListener(e, unlock, true);
      this.unlock();
    };
    for (const e of events) window.addEventListener(e, unlock, true);
  }

  private unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    this.onUnlock();
    if (this.wantedMusic) this.startMusic(this.wantedMusic);
  }

  private make(id: string, opts: { loop: boolean; html5: boolean; volume: number }): Howl | null {
    const files = this.manifest.audio?.[id];
    if (!files?.length) return null;
    return new Howl({
      src: files.map((f) => `${import.meta.env.BASE_URL}${f}`),
      loop: opts.loop,
      html5: opts.html5,
      volume: opts.volume,
      onloaderror: (_i, err) => console.warn(`[kalpa] audio ${id} failed to load`, err),
      onplayerror: (_i, err) => console.warn(`[kalpa] audio ${id} failed to play`, err),
    });
  }

  private musicLevel(): number {
    return this.musicVolume * this.duck;
  }

  music(id: string | null): void {
    if (id === this.wantedMusic) return;
    this.wantedMusic = id;
    if (this.unlocked) this.startMusic(id);
  }

  private startMusic(id: string | null): void {
    const old = this.current;
    if (old && old.id === id) return;
    this.current = null;
    if (old) {
      old.howl.fade(old.howl.volume(), 0, CROSSFADE_MS);
      window.setTimeout(() => old.howl.unload(), CROSSFADE_MS + 100);
    }
    if (!id) return;
    const howl = this.make(id, { loop: true, html5: true, volume: 0 });
    if (!howl) return;
    this.current = { id, howl };
    howl.play();
    howl.fade(0, this.musicLevel(), CROSSFADE_MS);
  }

  cue(id: string, opts: { volume?: number; rate?: number } = {}): void {
    if (!this.unlocked) return;
    const now = performance.now();
    if (now - (this.lastPlayed.get(id) ?? -Infinity) < DEDUPE_MS) return;
    this.lastPlayed.set(id, now);
    let howl = this.sfxCache.get(id);
    if (!howl) {
      const made = this.make(id, { loop: LOOPING.has(id), html5: false, volume: this.sfxVolume });
      if (!made) return;
      howl = made;
      this.sfxCache.set(id, howl);
    }
    const instance = howl.play();
    howl.volume(this.sfxVolume * (opts.volume ?? 1), instance);
    if (opts.rate) howl.rate(opts.rate, instance);
    if (LOOPING.has(id)) this.loops.add(howl);
  }

  stopCue(id: string): void {
    const howl = this.sfxCache.get(id);
    if (!howl) return;
    howl.stop();
    this.loops.delete(howl);
  }

  stopLoops(): void {
    for (const howl of this.loops) howl.stop();
    this.loops.clear();
  }

  setVolumes(music: number, sfx: number): void {
    this.musicVolume = music;
    this.sfxVolume = sfx;
    this.current?.howl.volume(this.musicLevel());
    for (const howl of this.sfxCache.values()) howl.volume(sfx);
  }

  /** Quieter while the pause menu is open. Silent while the tab is hidden. */
  setDucked(ducked: boolean): void {
    this.duck = ducked ? 0.4 : 1;
    this.current?.howl.volume(this.musicLevel());
  }

  setHidden(hidden: boolean): void {
    if (this.unlocked) Howler.mute(hidden);
  }
}
