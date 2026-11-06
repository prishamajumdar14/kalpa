// Minimal developer UI behind ?ui=none, or when src/ui/ isn't there yet. No styling effort: it only
// has to make the game playable with no dependency on A6.
import type { Engine, EngineEvents } from './api';

export function mountTestUI(engine: Engine): void {
  const root = document.createElement('div');
  root.id = 'kalpa-test-ui';
  root.style.cssText = 'position:fixed;inset:0;z-index:10;pointer-events:none;color:#fff;font:15px sans-serif';
  document.body.appendChild(root);

  const panel = (css: string) => {
    const div = document.createElement('div');
    div.style.cssText = `position:absolute;pointer-events:auto;${css}`;
    root.appendChild(div);
    return div;
  };
  const makeButton = (parent: HTMLElement, label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'min-height:44px;min-width:44px;margin:4px;padding:6px 10px;background:#000c;color:#fff;border:1px solid #fff8;cursor:pointer';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
    });
    parent.appendChild(b);
    return b;
  };

  const title = panel('left:50%;top:40%;transform:translateX(-50%);text-align:center');
  makeButton(title, 'New game', () => {
    title.hidden = true;
    engine.newGame();
  });
  if (engine.hasSave()) {
    makeButton(title, 'Continue', () => {
      title.hidden = true;
      engine.continueGame();
    });
  }

  const sceneName = panel('left:12px;top:12px;opacity:.8');
  const loading = panel('left:12px;top:36px;opacity:.7');
  const subtitle = panel('left:10%;right:10%;bottom:12%;text-align:center;background:#0009;padding:6px');
  subtitle.hidden = true;
  const skip = panel('right:12px;bottom:12px');
  const dialogue = panel('left:0;right:0;bottom:0;background:#000d;padding:14px 20px;min-height:90px;cursor:pointer');
  dialogue.hidden = true;
  dialogue.addEventListener('click', () => engine.advance());
  const line = document.createElement('div');
  dialogue.appendChild(line);
  const choices = document.createElement('div');
  dialogue.appendChild(choices);
  const monitor = panel('left:50%;top:10%;transform:translateX(-50%);background:#000e;font-family:monospace;padding:12px;white-space:pre-wrap');
  monitor.hidden = true;
  const credits = panel('inset:0;background:#000;text-align:center;padding-top:10%;overflow:auto');
  credits.hidden = true;
  const hotspots = new Map<string, HTMLButtonElement>();

  engine.on('scene:enter', ({ sceneId, title: t }) => {
    title.hidden = true;
    credits.hidden = true;
    monitor.hidden = true;
    sceneName.textContent = `${sceneId}: ${t}`;
  });
  engine.on('loading:progress', ({ loaded, total }) => {
    loading.textContent = loaded >= total ? '' : `loading ${Math.round((loaded / total) * 100)}%`;
  });
  engine.on('video:start', ({ canSkip }) => {
    skip.replaceChildren();
    if (canSkip) makeButton(skip, 'Skip', () => engine.skipVideo());
  });
  engine.on('video:cue', ({ text }) => {
    subtitle.hidden = !text;
    subtitle.textContent = text ?? '';
  });
  engine.on('video:end', () => {
    skip.replaceChildren();
    subtitle.hidden = true;
  });
  engine.on('dialogue:line', (l: EngineEvents['dialogue:line']) => {
    dialogue.hidden = false;
    choices.replaceChildren();
    line.innerHTML = '';
    const who = document.createElement('b');
    who.style.color = l.color;
    who.textContent = l.speakerName ? `${l.speakerName}: ` : '';
    line.append(who, document.createTextNode(l.text));
  });
  engine.on('choice:show', ({ choices: list }) => {
    dialogue.hidden = false;
    choices.replaceChildren();
    for (const c of list) makeButton(choices, `${c.index + 1}. ${c.text}`, () => engine.choose(c.id));
  });
  engine.on('choice:made', () => choices.replaceChildren());
  engine.on('dialogue:end', () => {
    dialogue.hidden = true;
  });
  engine.on('monitor:show', ({ lines }) => {
    monitor.hidden = false;
    monitor.textContent = lines.join('\n');
  });
  engine.on('hotspots:update', ({ items }) => {
    const live = new Set(items.map((i) => i.id));
    for (const [id, b] of hotspots) {
      if (!live.has(id)) {
        b.remove();
        hotspots.delete(id);
      }
    }
    for (const item of items) {
      let b = hotspots.get(item.id);
      if (!b) {
        b = makeButton(root, item.label, () => engine.clickHotspot(item.id));
        b.dataset.hotspot = item.id;
        b.style.position = 'fixed';
        b.style.pointerEvents = 'auto';
        b.style.transform = 'translate(-50%,-50%)';
        hotspots.set(item.id, b);
      }
      b.textContent = item.label;
      b.hidden = !item.visible;
      b.style.left = `${item.x}px`;
      b.style.top = `${item.y}px`;
      b.style.opacity = item.seen ? '0.55' : '1';
    }
  });
  engine.on('credits:show', () => {
    credits.hidden = false;
    monitor.hidden = true;
    credits.replaceChildren();
    makeButton(credits, 'New game', () => engine.newGame());
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') engine.advance();
    const n = Number(e.key);
    if (n >= 1 && n <= 9) {
      const b = choices.querySelectorAll('button')[n - 1] as HTMLButtonElement | undefined;
      b?.click();
    }
  });
}
