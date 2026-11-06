// window.__KALPA__ and a small visible debug menu. Mounted only with ?debug=1.
import type { KalpaDebug, SceneId } from './api';
import type { BuiltEngine } from './engine';
import { SCENE_IDS } from './rules';
import type { Story } from './types';

declare global {
  interface Window {
    __KALPA__?: KalpaDebug;
  }
}

export function mountDebug(built: BuiltEngine, story: Story): void {
  const { engine, game, stage } = built;
  const lineLog: KalpaDebug['lineLog'] = [];
  engine.on('dialogue:line', (l) => {
    lineLog.push({ nodeId: l.nodeId, lineId: l.lineId, speakerId: l.speakerId, text: l.text });
  });

  window.__KALPA__ = {
    engine,
    goto: (sceneId) => game.debugGoto(sceneId),
    setState: (partial) => game.debugSetState(partial),
    triggerEnding: (dominant, final) => game.debugTriggerEnding(dominant, final),
    fastText: (on) => game.debugFastText(on),
    story,
    lineLog,
    variantId: () => game.debugVariantId(),
    fps: () => stage.fps(),
  };

  (window as unknown as { __STAGE__?: unknown }).__STAGE__ = stage;
  const box = document.createElement('details');
  box.id = 'kalpa-debug';
  box.style.cssText =
    'position:fixed;top:6px;right:6px;z-index:9999;background:#000c;color:#cfe;font:12px monospace;padding:4px 8px;max-width:260px';
  const summary = document.createElement('summary');
  summary.textContent = 'debug';
  box.appendChild(summary);

  const section = (label: string) => {
    const div = document.createElement('div');
    div.style.margin = '6px 0';
    const title = document.createElement('div');
    title.textContent = label;
    title.style.opacity = '0.7';
    div.appendChild(title);
    box.appendChild(div);
    return div;
  };
  const button = (parent: HTMLElement, label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'font:11px monospace;margin:1px';
    b.addEventListener('click', fn);
    parent.appendChild(b);
  };

  const scenes = section('goto');
  for (const id of SCENE_IDS) button(scenes, id, () => game.debugGoto(id as SceneId));

  const endings = section('ending');
  for (const d of ['room1', 'room2', 'room3', 'room4', 'hopeful']) {
    for (const f of ['intervene', 'shutdown']) {
      button(endings, `${d}/${f.slice(0, 4)}`, () => game.debugTriggerEnding(d, f));
    }
  }

  const tools = section('tools');
  let fast = false;
  button(tools, 'fastText', () => {
    fast = !fast;
    game.debugFastText(fast);
  });
  button(tools, 'all fragments', () => game.debugSetState({ fragments: [1, 2, 3, 4] }));

  const info = section('state');
  const pre = document.createElement('pre');
  pre.style.cssText = 'margin:0;white-space:pre-wrap';
  info.appendChild(pre);
  const refresh = () => {
    const s = engine.getState();
    pre.textContent = `${s.scene}\norder: ${s.visitedOrder.join(' ')}\nfragments: ${s.fragments.join(' ')}\nvariant: ${game.debugVariantId()}\nfps: ${stage.fps()}`;
  };
  engine.on('state:changed', refresh);
  window.setInterval(refresh, 1000);
  document.body.appendChild(box);
}
