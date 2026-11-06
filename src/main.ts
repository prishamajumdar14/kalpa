import type { Engine } from './engine/api';
import { loadManifest, loadStory, loadSubs } from './engine/data';
import { createEngine } from './engine/engine';
import { mountDebug } from './engine/debug';
import { mountTestUI } from './engine/testui';
import { hideBoot, showNotice } from './ui/notice';

const params = new URLSearchParams(window.location.search);
const debug = params.get('debug') === '1';

// A6's UI, if it exists at build time.
const uiModules = import.meta.glob('./ui/index.ts') as Record<
  string,
  () => Promise<{ mountUI: (engine: Engine) => void }>
>;

// Startup failures get a plain "Something went wrong" screen with a Reload button. Once the game
// is up, a stray error is only logged: it never replaces a running game.
let started = false;
const startupFailed = (err: unknown) => {
  console.error('[kalpa] failed to start', err);
  if (!started) showNotice('startup');
};
window.addEventListener('error', (e) => startupFailed(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => startupFailed(e.reason));

// The browser can take the graphics context away (memory pressure, driver reset).
let clearContextNotice: (() => void) | null = null;
document.addEventListener(
  'webglcontextlost',
  (e) => {
    e.preventDefault(); // lets the renderer restore itself if the browser can
    clearContextNotice?.();
    clearContextNotice = showNotice('context');
  },
  true,
);
document.addEventListener(
  'webglcontextrestored',
  () => {
    clearContextNotice?.();
    clearContextNotice = null;
  },
  true,
);

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    if (!gl) return false;
    (gl as WebGLRenderingContext).getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  const stage = document.getElementById('stage');
  if (!stage) throw new Error('#stage is missing');
  if (!hasWebGL()) {
    showNotice('webgl');
    return;
  }

  const story = await loadStory(debug && params.get('story') === 'fixture');
  const built = createEngine(stage, story, loadManifest(), loadSubs());
  if (debug) mountDebug(built, story);

  const loadUI = uiModules['./ui/index.ts'];
  if (params.get('ui') !== 'none' && loadUI) {
    const { mountUI } = await loadUI();
    mountUI(built.engine);
  } else {
    mountTestUI(built.engine);
  }
  started = true;
  hideBoot();
}

boot().catch(startupFailed);
