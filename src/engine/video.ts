// The prologue: a streamed <video>, or a timed placeholder that runs the same flow if the video
// is missing or fails. Subtitles reach the UI through onCue.
import { pickVideo, subtitleAt } from './rules';
import type { Manifest, Subtitle } from './types';

const TICK_MS = 100;
const STALL_LIMIT_MS = 20000;
/** The placeholder is a short holding card, not the real 70 s film. */
const PLACEHOLDER_S = 10;
const FAST_FACTOR = 40;

// Rough colours of each shot in docs/PROLOGUE_TIMING.md, for the placeholder.
const SHOT_COLORS: [number, string][] = [
  [0, '#c46a3a'],
  [11, '#1b5a7a'],
  [18, '#0a2233'],
  [24, '#1a2227'],
  [38, '#0c3a44'],
  [50, '#333a3e'],
  [51, '#1a2227'],
  [60, '#6a0e0a'],
  [72, '#120304'],
  [78, '#000000'],
];

export interface PrologueOptions {
  container: HTMLElement;
  manifest: Manifest;
  subs: Subtitle[];
  canSkip: boolean;
  /** Text for the holding card, from story.json strings. */
  note?: string;
  onCue: (text: string | null) => void;
  volume: () => number;
  isFast: () => boolean;
  /** Plays the separate soundtrack when the placeholder runs, since it has no muxed audio. */
  startMix: () => void;
  stopMix: () => void;
}

export class ProloguePlayer {
  private video: HTMLVideoElement | null = null;
  private overlay: HTMLDivElement | null = null;
  private timer = 0;
  private paused = false;
  private finished = false;
  private lastCue: string | null = null;
  private resolve: () => void = () => undefined;
  private clock = 0;
  private lastTick = 0;
  private lastProgressAt = 0;
  private lastVideoTime = -1;

  constructor(private o: PrologueOptions) {}

  play(): Promise<void> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      const conn = (navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string; downlink?: number };
      }).connection;
      const probe = document.createElement('video');
      const file = pickVideo(this.o.manifest, {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio,
        saveData: conn?.saveData,
        effectiveType: conn?.effectiveType,
        downlink: conn?.downlink,
        canPlay: (mime) => probe.canPlayType(mime),
      });
      if (file) this.startVideo(file);
      else this.startPlaceholder();
    });
  }

  private startVideo(file: string): void {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.playsInline = true;
    video.src = `${import.meta.env.BASE_URL}${file}`;
    video.volume = Math.min(1, Math.max(0, this.o.volume()));
    video.setAttribute('aria-hidden', 'true');
    this.o.container.appendChild(video);
    this.video = video;

    video.addEventListener('ended', () => this.finish());
    video.addEventListener('error', () => {
      console.warn('[kalpa] prologue video failed, using the timed placeholder');
      this.removeVideo();
      this.startPlaceholder();
    });

    this.lastProgressAt = performance.now();
    this.timer = window.setInterval(() => this.tickVideo(), TICK_MS);
    video.play().catch(() => {
      // Autoplay refused, for example no gesture: try again muted.
      video.muted = true;
      video.play().catch((err) => {
        console.warn('[kalpa] prologue video would not play', err);
        this.removeVideo();
        this.startPlaceholder();
      });
    });
  }

  private tickVideo(): void {
    const video = this.video;
    if (!video || this.paused || document.hidden) {
      this.lastProgressAt = performance.now();
      return;
    }
    if (this.o.isFast()) {
      this.finish();
      return;
    }
    const now = performance.now();
    if (video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = video.currentTime;
      this.lastProgressAt = now;
    } else if (now - this.lastProgressAt > STALL_LIMIT_MS) {
      console.warn('[kalpa] prologue video stalled, moving on');
      this.finish();
      return;
    }
    this.cueAt(video.currentTime);
  }

  private removeVideo(): void {
    window.clearInterval(this.timer);
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
      this.video.remove();
      this.video = null;
    }
  }

  private startPlaceholder(): void {
    if (this.finished) return;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;background:#000;transition:background 1.4s linear';
    if (this.o.note) {
      const note = document.createElement('div');
      note.textContent = this.o.note;
      note.style.cssText =
        'position:absolute;left:0;right:0;top:42%;text-align:center;color:#e8e4dc;font:italic 1.6rem/1.4 serif;letter-spacing:.04em;opacity:.85;pointer-events:none';
      overlay.appendChild(note);
    }
    this.o.container.appendChild(overlay);
    this.overlay = overlay;
    this.o.startMix();
    this.clock = 0;
    this.lastTick = performance.now();
    this.timer = window.setInterval(() => this.tickPlaceholder(), TICK_MS);
  }

  private tickPlaceholder(): void {
    const now = performance.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (this.paused || document.hidden) return;
    this.clock += dt * (this.o.isFast() ? FAST_FACTOR : 1);
    if (this.clock >= PLACEHOLDER_S) {
      this.finish();
      return;
    }
    let color = SHOT_COLORS[0][1];
    for (const [t, c] of SHOT_COLORS) if (this.clock * 7.8 >= t) color = c;
    if (this.overlay) this.overlay.style.background = color;
    // No film subtitles over the holding card.
  }

  private cueAt(t: number): void {
    const text = subtitleAt(this.o.subs, t);
    if (text !== this.lastCue) {
      this.lastCue = text;
      this.o.onCue(text);
    }
  }

  skip(): void {
    // The placeholder is always skippable, even on a first run.
    if (this.o.canSkip || this.overlay) this.finish();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!this.video) return;
    if (paused) this.video.pause();
    else this.video.play().catch(() => undefined);
  }

  setVolume(volume: number): void {
    if (this.video) this.video.volume = Math.min(1, Math.max(0, volume));
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    window.clearInterval(this.timer);
    this.removeVideo();
    this.o.stopMix();
    this.overlay?.remove();
    this.overlay = null;
    this.resolve();
  }
}
