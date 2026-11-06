// KALPA UI. Talks to the game only through the Engine API (src/engine/api.ts).
import '@fontsource/newsreader/latin-400.css';
import '@fontsource/newsreader/latin-400-italic.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import './ui.css';
import symbolSvg from '../../assets/symbol/symbol.svg?raw';
import type { Engine, EngineEvents, SceneId, Settings } from '../engine/api';

const creditsData = import.meta.glob('../data/story.json', { eager: true, import: 'credits' }) as Record<
  string,
  { role: string; name: string }[] | undefined
>;

/** Scene accents from docs/ART_DIRECTION.md. They tint the UI lightly. */
const ACCENT: Record<SceneId, string> = {
  prologue: '#e8f3ff',
  hub: '#2fe6c8',
  room1: '#e0b46a',
  room2: '#9fe7e8',
  room3: '#ff8a1f',
  room4: '#3fa9ff',
  room5: '#6fb4f0',
  sub_chamber: '#d8a31f',
  moonpool: '#ffb347',
  ending: '#e8f3ff',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  parent?: HTMLElement,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** Speaker colours can be dark on a dark panel. Lift anything below a readable luminance. */
function lift(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex || '#ecebe6';
  const n = parseInt(m[1], 16);
  let [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lum < 0.5) {
    const t = Math.min(0.75, (0.5 - lum) * 1.6 + 0.2);
    r = Math.round(r + (255 - r) * t);
    g = Math.round(g + (255 - g) * t);
    b = Math.round(b + (255 - b) * t);
  }
  return `rgb(${r},${g},${b})`;
}

export function mountUI(engine: Engine): void {
  const host = document.getElementById('ui') ?? el('div', '', document.body);
  host.id = 'ui';
  host.replaceChildren();
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (mq.matches && !engine.getSettings().reducedMotion) engine.setSetting('reducedMotion', true);
  const reduced = () => engine.getSettings().reducedMotion || mq.matches;
  const applyMotion = () => host.classList.toggle('k-reduced', reduced());
  applyMotion();

  let started = false; // a run is on screen (title dismissed)
  let sceneId: SceneId | null = null;
  let paused = false;

  // ---- Live region (dialogue, fragments, scene changes) --------------------------------
  const live = el('div', 'k-sr', host);
  live.setAttribute('role', 'log');
  live.setAttribute('aria-live', 'polite');
  const announce = (t: string) => {
    const p = el('p', '', live, t);
    while (live.childNodes.length > 6) live.firstChild?.remove();
    void p;
  };

  // ---- Caption, top-right controls, tracker ----------------------------------------------
  const caption = el('div', 'k-caption', host);
  const top = el('div', 'k-top', host);
  top.hidden = true;
  const tracker = el('div', 'k-tracker', top);
  tracker.setAttribute('role', 'img');
  tracker.innerHTML = symbolSvg;
  tracker.querySelector('title')?.remove();
  const pauseBtn = el('button', 'k-pausebtn', top);
  pauseBtn.type = 'button';
  pauseBtn.setAttribute('aria-label', 'Pause and settings (Esc)');
  pauseBtn.innerHTML =
    '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 5h14M2 9h14M2 13h14"/></svg>';
  const toast = el('div', 'k-toast', host);
  toast.setAttribute('aria-hidden', 'true');

  const paintTracker = (held: number[], pulse?: number) => {
    for (let i = 1; i <= 4; i++) {
      const g = tracker.querySelector<SVGElement>(`#fragment${i}`);
      if (!g) continue;
      g.classList.toggle('k-got', held.includes(i));
      if (pulse === i) {
        g.classList.remove('k-pulse');
        void g.getBoundingClientRect();
        g.classList.add('k-pulse');
      }
    }
    tracker.setAttribute('aria-label', `Door symbol: ${held.length} of 4 fragments`);
  };
  paintTracker([]);

  // ---- Hotspots -----------------------------------------------------------------------------
  const hotspotMap = new Map<string, HTMLButtonElement>();
  const hotspotLayer = el('div', '', host);

  // ---- Dialogue -------------------------------------------------------------------------------
  const dlg = el('section', 'k-dialogue', host);
  dlg.hidden = true;
  dlg.setAttribute('aria-label', 'Dialogue');
  const who = el('div', 'k-who', dlg);
  who.setAttribute('aria-hidden', 'true');
  const text = el('p', 'k-text', dlg);
  text.setAttribute('aria-hidden', 'true');
  const more = el('span', 'k-more', dlg, '▾');
  more.setAttribute('aria-hidden', 'true');
  const choiceList = el('ul', 'k-choices', dlg);
  choiceList.hidden = true;

  let full = '';
  let shown = 0;
  let typing = false;
  let raf = 0;
  let lastT = 0;
  let acc = 0;
  let inDialogue = false;
  let choices: { id: string; text: string; index: number }[] = [];

  const stopTyping = () => {
    cancelAnimationFrame(raf);
    typing = false;
  };
  const finishTyping = () => {
    stopTyping();
    text.textContent = full;
    more.classList.toggle('k-on', choices.length === 0);
  };
  const tick = (t: number) => {
    const dt = Math.min(0.1, (t - lastT) / 1000);
    lastT = t;
    acc += dt * 38 * engine.getSettings().textSpeed;
    const n = Math.floor(acc);
    if (n > 0) {
      acc -= n;
      shown = Math.min(full.length, shown + n);
      text.textContent = full.slice(0, shown);
    }
    if (shown >= full.length) finishTyping();
    else raf = requestAnimationFrame(tick);
  };
  const typeLine = (s: string) => {
    stopTyping();
    full = s;
    shown = 0;
    acc = 0;
    more.classList.remove('k-on');
    if (engine.getSettings().textSpeed >= 100 || !s) {
      finishTyping();
      return;
    }
    typing = true;
    text.textContent = '';
    lastT = performance.now();
    raf = requestAnimationFrame(tick);
  };

  const showDialogue = () => {
    inDialogue = true;
    dlg.hidden = false;
  };
  const hideDialogue = () => {
    inDialogue = false;
    stopTyping();
    choices = [];
    choiceList.replaceChildren();
    choiceList.hidden = true;
    dlg.hidden = true;
  };
  const advance = () => {
    if (!inDialogue || choices.length) return;
    if (typing) finishTyping();
    else engine.advance();
  };
  const choose = (id: string) => {
    choices = [];
    choiceList.replaceChildren();
    choiceList.hidden = true;
    engine.choose(id);
  };
  dlg.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    advance();
  });

  // ---- Video overlay ----------------------------------------------------------------------
  const subs = el('div', 'k-subs', host);
  subs.hidden = true;
  subs.setAttribute('aria-hidden', 'true');
  const skip = el('button', 'k-btn k-skip', host, 'Skip');
  skip.type = 'button';
  skip.hidden = true;
  skip.addEventListener('click', () => engine.skipVideo());

  // ---- Monitor ---------------------------------------------------------------------------
  const monitor = el('div', 'k-monitor', host);
  monitor.hidden = true;
  monitor.setAttribute('role', 'status');
  const black = el('div', 'k-black', host);
  let monitorAt = 0;
  let monitorKind = '';
  const monitorTimers: number[] = [];
  const later = (fn: () => void, ms: number) => {
    monitorTimers.push(window.setTimeout(fn, reduced() ? Math.min(ms, 300) : ms));
  };
  const clearMonitor = () => {
    monitorTimers.splice(0).forEach(clearTimeout);
    monitor.hidden = true;
    monitor.classList.remove('k-blank');
    monitor.replaceChildren();
    monitorKind = '';
  };
  const animateNumber = (span: HTMLElement, bar: HTMLElement, from: number, to: number, ms: number) => {
    const t0 = performance.now();
    const step = (t: number) => {
      const k = ms <= 0 ? 1 : Math.min(1, (t - t0) / ms);
      const v = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      span.textContent = `${v}%`;
      bar.style.width = `${v}%`;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const showMonitor = (kind: string, lines: string[]) => {
    if (monitor.hidden) monitor.replaceChildren();
    monitor.hidden = false;
    monitor.classList.remove('k-blank');
    monitorAt = performance.now();
    monitorKind = kind;
    const block = el('div', '', monitor);
    announce(`Monitor: ${lines.join('. ')}`);
    if (kind === 'door') {
      const m = el('div', 'k-mark', block);
      m.innerHTML = symbolSvg;
      m.querySelector('title')?.remove();
    }
    let delay = 0;
    for (const line of lines) {
      const row = el('div', 'k-line', block);
      row.hidden = true;
      const match = /^(.*?):\s*(\d+)%\s*(?:→|->)\s*(\d+)%\s*$/.exec(line);
      const reveal = () => {
        row.hidden = false;
        monitor.scrollTop = monitor.scrollHeight;
      };
      if (match) {
        const [, label, a, b] = match;
        row.classList.add('k-label');
        el('span', '', row, `${label}  `);
        const num = el('span', 'k-num', row, `${a}%`);
        el('span', 'k-arrow', row, '  →  ');
        const end = el('span', 'k-num', row, `${b}%`);
        end.style.opacity = '0.45';
        const bar = el('span', 'k-bar', row);
        const fill = el('i', '', bar);
        fill.style.width = `${a}%`;
        later(() => {
          reveal();
          animateNumber(num, fill, Number(a), Number(b), reduced() ? 0 : 2600);
          end.style.opacity = '1';
        }, delay);
        delay += reduced() ? 0 : 3200;
      } else {
        later(reveal, delay);
        row.textContent = line;
        delay += reduced() ? 0 : Math.min(2400, 500 + line.length * 22);
      }
    }
    if (kind === 'variable') later(() => monitor.classList.add('k-blank'), delay + 3500);
    if (kind === 'door') later(() => black.classList.add('k-on'), delay + 5500);
  };

  // ---- Pause / settings -----------------------------------------------------------------------
  const pauseEl = el('div', 'k-pause', host);
  pauseEl.hidden = true;
  pauseEl.setAttribute('role', 'dialog');
  pauseEl.setAttribute('aria-modal', 'true');
  pauseEl.setAttribute('aria-label', 'Paused, settings');
  const form = el('form', '', pauseEl);
  form.addEventListener('submit', (e) => e.preventDefault());
  el('h2', '', form, 'Paused');
  const controls: Record<string, HTMLInputElement | HTMLSelectElement> = {};
  const field = (key: string, label: string, make: () => HTMLInputElement | HTMLSelectElement) => {
    const row = el('div', 'k-field', form);
    const l = el('label', '', row, label);
    const c = make();
    c.id = `k-set-${key}`;
    l.htmlFor = c.id;
    row.appendChild(c);
    controls[key] = c;
    return c;
  };
  const range = (min: number, max: number, step: number) => () => {
    const i = document.createElement('input');
    i.type = 'range';
    i.min = String(min);
    i.max = String(max);
    i.step = String(step);
    return i;
  };
  const check = () => {
    const i = document.createElement('input');
    i.type = 'checkbox';
    return i;
  };
  field('musicVolume', 'Music', range(0, 1, 0.05));
  field('sfxVolume', 'Sound effects', range(0, 1, 0.05));
  field('textSpeed', 'Text speed', range(0.5, 4, 0.25));
  field('reducedMotion', 'Reduce motion', check);
  field('subtitles', 'Subtitles', check);
  field('quality', 'Graphics quality', () => {
    const s = document.createElement('select');
    for (const [v, t] of [
      ['high', 'High'],
      ['low', 'Low (lighter on battery)'],
    ])
      s.appendChild(new Option(t, v));
    return s;
  });
  for (const key of Object.keys(controls)) {
    const c = controls[key];
    c.addEventListener('input', () => {
      const v: unknown =
        c instanceof HTMLSelectElement ? c.value : c.type === 'checkbox' ? c.checked : Number(c.value);
      engine.setSetting(key as keyof Settings, v as never);
      if (key === 'reducedMotion') applyMotion();
    });
  }
  const actions = el('div', 'k-actions', form);
  const resumeBtn = el('button', 'k-btn', actions, 'Resume');
  resumeBtn.type = 'button';
  const quitBtn = el('button', 'k-btn', actions, 'Quit to title');
  quitBtn.type = 'button';
  let returnFocus: HTMLElement | null = null;
  const syncControls = () => {
    const s = engine.getSettings();
    for (const [k, c] of Object.entries(controls)) {
      const v = s[k as keyof Settings];
      if (c instanceof HTMLInputElement && c.type === 'checkbox') c.checked = Boolean(v) || (k === 'reducedMotion' && mq.matches);
      else c.value = String(Math.min(Number(v) || 0, 4) || v);
    }
  };
  const openPause = () => {
    if (paused || !started) return;
    paused = true;
    returnFocus = document.activeElement as HTMLElement | null;
    engine.pause();
    syncControls();
    pauseEl.hidden = false;
    controls.musicVolume.focus();
  };
  const closePause = () => {
    if (!paused) return;
    paused = false;
    pauseEl.hidden = true;
    engine.resume();
    returnFocus?.focus?.();
  };
  pauseBtn.addEventListener('click', openPause);
  resumeBtn.addEventListener('click', closePause);
  quitBtn.addEventListener('click', () => window.location.reload());

  // ---- Title ---------------------------------------------------------------------------------
  const title = el('div', 'k-title', host);
  const titleMark = el('div', 'k-mark', title);
  titleMark.innerHTML = symbolSvg;
  titleMark.querySelector('title')?.remove();
  titleMark.setAttribute('aria-hidden', 'true');
  el('h1', '', title, 'KALPA');
  el('p', 'k-sub', title, 'An underwater story');
  const menu = el('div', 'k-menu', title);
  const newBtn = el('button', 'k-btn', menu, 'New game');
  newBtn.type = 'button';
  const contBtn = el('button', 'k-btn', menu, 'Continue');
  contBtn.type = 'button';
  contBtn.hidden = !engine.hasSave();
  const row = el('div', 'k-row', menu);
  const setBtn = el('button', 'k-btn', row, 'Settings');
  setBtn.type = 'button';
  const credBtn = el('button', 'k-btn', row, 'Credits');
  credBtn.type = 'button';

  const loadBar = el('div', 'k-loading', host);
  const loadFill = el('i', '', loadBar);
  const loadTxt = el('span', '', loadBar);
  loadBar.hidden = true;
  const setLoading = (loaded: number, total: number) => {
    if (total <= 0 || loaded >= total) {
      loadBar.hidden = true;
      return;
    }
    loadBar.hidden = false;
    const pct = Math.round((loaded / total) * 100);
    loadFill.style.width = `${pct}%`;
    loadTxt.textContent = `LOADING ${pct}%`;
  };
  const beginRun = (fn: () => unknown) => {
    menu.hidden = true;
    loadBar.hidden = false;
    loadFill.style.width = '4%';
    loadTxt.textContent = 'LOADING';
    started = true;
    fn();
  };
  newBtn.addEventListener('click', () => beginRun(() => engine.newGame()));
  contBtn.addEventListener('click', () => {
    beginRun(() => {
      if (!engine.continueGame()) {
        started = false;
        menu.hidden = false;
        loadBar.hidden = true;
        contBtn.hidden = true;
      }
    });
  });
  // Settings from the title: the pause panel without pausing the engine.
  setBtn.addEventListener('click', () => {
    started = true;
    openPause();
    started = false;
  });
  newBtn.focus();

  // ---- Credits --------------------------------------------------------------------------------
  const credits = el('div', 'k-credits', host);
  credits.hidden = true;
  credits.setAttribute('role', 'dialog');
  credits.setAttribute('aria-label', 'Credits');
  const roll = el('div', 'k-roll', credits);
  const rm = el('div', 'k-mark', roll);
  rm.innerHTML = symbolSvg;
  rm.querySelector('title')?.remove();
  el('h2', '', roll, 'KALPA');
  const dl = el('dl', '', roll);
  const entries = Object.values(creditsData)[0] ?? [];
  for (const c of entries) {
    el('dt', '', dl, c.role);
    el('dd', '', dl, c.name);
  }
  const credActions = el('div', 'k-actions', credits);
  const againBtn = el('button', 'k-btn', credActions, 'Play again');
  againBtn.type = 'button';
  const toTitleBtn = el('button', 'k-btn', credActions, 'Title');
  toTitleBtn.type = 'button';
  const closeCredBtn = el('button', 'k-btn', credActions, 'Close');
  closeCredBtn.type = 'button';
  let creditsFromTitle = false;
  const openCredits = (fromTitle: boolean) => {
    creditsFromTitle = fromTitle;
    againBtn.hidden = fromTitle;
    toTitleBtn.hidden = fromTitle;
    closeCredBtn.hidden = !fromTitle;
    credits.classList.toggle('k-static', reduced());
    credits.scrollTop = 0;
    credits.hidden = false;
    // restart the roll animation
    roll.style.animation = 'none';
    void roll.offsetWidth;
    roll.style.animation = '';
    (fromTitle ? closeCredBtn : againBtn).focus();
  };
  credBtn.addEventListener('click', () => openCredits(true));
  closeCredBtn.addEventListener('click', () => {
    credits.hidden = true;
    credBtn.focus();
  });
  againBtn.addEventListener('click', () => {
    credits.hidden = true;
    black.classList.remove('k-on');
    engine.newGame();
  });
  toTitleBtn.addEventListener('click', () => window.location.reload());

  // ---- Engine events --------------------------------------------------------------------------
  engine.on('scene:enter', ({ sceneId: id, title: t }) => {
    sceneId = id;
    started = true;
    title.classList.add('k-out');
    setTimeout(() => (title.hidden = true), 950);
    credits.hidden = true;
    black.classList.remove('k-on');
    clearMonitor();
    hideDialogue();
    host.style.setProperty('--accent', ACCENT[id] ?? '#2fe6c8');
    top.hidden = false;
    tracker.hidden = id === 'prologue' || id === 'ending';
    caption.textContent = t;
    caption.classList.remove('k-on');
    void caption.offsetWidth;
    caption.classList.add('k-on');
    setTimeout(() => caption.classList.remove('k-on'), 4200);
    announce(`Scene: ${t}`);
    paintTracker(engine.getState().fragments);
  });
  engine.on('scene:exit', () => {
    hideDialogue();
  });
  engine.on('scene:ready', () => {
    loadBar.hidden = true;
  });
  engine.on('loading:progress', ({ loaded, total }) => setLoading(loaded, total));
  engine.on('dialogue:start', () => showDialogue());
  engine.on('dialogue:line', (l: EngineEvents['dialogue:line']) => {
    showDialogue();
    choices = [];
    choiceList.replaceChildren();
    choiceList.hidden = true;
    const sys = l.speakerId === 'system' || l.speakerId === 'log';
    who.textContent = l.speakerName || '';
    who.style.color = lift(l.color);
    text.classList.toggle('k-mono', sys);
    text.style.color = '';
    announce(l.speakerName ? `${l.speakerName}: ${l.text}` : l.text);
    typeLine(l.text);
  });
  engine.on('choice:show', ({ choices: list }) => {
    showDialogue();
    choices = list;
    finishTyping();
    more.classList.remove('k-on');
    choiceList.replaceChildren();
    choiceList.hidden = false;
    announce(`Choices: ${list.map((c) => `${c.index + 1}. ${c.text}`).join('. ')}`);
    for (const c of list) {
      const li = el('li', '', choiceList);
      const b = el('button', '', li);
      b.type = 'button';
      el('kbd', '', b, String(c.index + 1));
      b.append(c.text);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        choose(c.id);
      });
    }
    (choiceList.querySelector('button') as HTMLElement | null)?.focus({ preventScroll: true });
  });
  engine.on('choice:made', () => {
    choices = [];
    choiceList.replaceChildren();
    choiceList.hidden = true;
  });
  engine.on('dialogue:end', () => hideDialogue());
  engine.on('fragment:collected', ({ index, total }) => {
    paintTracker(engine.getState().fragments, index);
    const msg = `Fragment ${index} found. ${total} of 4 held.`;
    announce(msg);
    toast.textContent = msg;
    toast.classList.add('k-on');
    setTimeout(() => toast.classList.remove('k-on'), 3200);
  });
  engine.on('state:changed', ({ state }) => paintTracker(state.fragments));
  engine.on('hotspots:update', ({ items }) => {
    const live = new Set(items.map((i) => i.id));
    for (const [id, b] of hotspotMap) {
      if (!live.has(id)) {
        b.remove();
        hotspotMap.delete(id);
      }
    }
    let anyVisible = false;
    for (const it of items) {
      let b = hotspotMap.get(it.id);
      if (!b) {
        b = el('button', 'k-hotspot', hotspotLayer);
        b.type = 'button';
        el('i', '', b);
        el('b', '', b);
        b.dataset.hotspot = it.id;
        const id = it.id;
        b.addEventListener('click', () => engine.clickHotspot(id));
        hotspotMap.set(it.id, b);
      }
      const lab = b.querySelector('b')!;
      if (lab.textContent !== it.label) lab.textContent = it.label;
      b.setAttribute('aria-label', it.label);
      b.hidden = !it.visible;
      b.style.left = `${it.x}px`;
      b.style.top = `${it.y}px`;
      b.classList.toggle('k-seen', it.seen);
      b.classList.toggle('k-unseen', !it.seen);
      if (it.visible) anyVisible = true;
    }
    // Exploring again: put away a monitor that is only there to be read.
    if (
      anyVisible &&
      !monitor.hidden &&
      monitorKind !== 'door' &&
      monitorKind !== 'variable' &&
      performance.now() - monitorAt > 1500
    )
      clearMonitor();
  });
  engine.on('monitor:show', ({ kind, lines }) => showMonitor(kind, lines));
  engine.on('video:start', ({ canSkip }) => {
    skip.hidden = !canSkip;
    tracker.hidden = true;
    loadBar.hidden = true;
  });
  engine.on('video:cue', ({ text: t }) => {
    const on = Boolean(t) && engine.getSettings().subtitles;
    subs.hidden = !on;
    subs.replaceChildren();
    if (on && t) el('span', '', subs, t);
    if (t) announce(t);
  });
  engine.on('video:end', () => {
    skip.hidden = true;
    subs.hidden = true;
    subs.replaceChildren();
  });
  engine.on('credits:show', () => {
    hideDialogue();
    clearMonitor();
    black.classList.add('k-on');
    openCredits(false);
  });

  // ---- Keyboard -------------------------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if (!skip.hidden && !paused && (e.key === 'Enter' || e.key === ' ' || e.key === 's' || e.key === 'S')) {
      engine.skipVideo();
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      if (!credits.hidden && creditsFromTitle) {
        credits.hidden = true;
        credBtn.focus();
      } else if (paused) {
        closePause();
        if (!started) menu.hidden = false;
      } else openPause();
      e.preventDefault();
      return;
    }
    if (paused || !credits.hidden || !title.hidden && !title.classList.contains('k-out')) {
      if (paused && e.key === 'Tab') {
        const f = [...pauseEl.querySelectorAll<HTMLElement>('input,select,button')];
        const i = f.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i === f.length - 1 ? 0 : i + 1;
        f[next]?.focus();
        e.preventDefault();
      }
      return;
    }
    if (/^[1-9]$/.test(e.key) && choices.length) {
      const c = choices.find((x) => x.index + 1 === Number(e.key));
      if (c) {
        choose(c.id);
        e.preventDefault();
      }
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      const t = e.target as HTMLElement;
      if (t.closest('button,input,select,a')) return;
      if (e.key === ' ') e.preventDefault();
      advance();
    }
  });
  // Pause the engine if the tab is hidden while a run is on.
  void sceneId;
}
