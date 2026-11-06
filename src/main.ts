import type { Engine } from './engine/api';
import { loadManifest, loadStory, loadSubs } from './engine/data';
import { createEngine } from './engine/engine';
import { mountDebug } from './engine/debug';
import { mountTestUI } from './engine/testui';

const params = new URLSearchParams(window.location.search);
const debug = params.get('debug') === '1';

// A6's UI, if it exists at build time.
const uiModules = import.meta.glob('./ui/index.ts') as Record<
  string,
  () => Promise<{ mountUI: (engine: Engine) => void }>
>;

async function boot(): Promise<void> {
  const stage = document.getElementById('stage');
  if (!stage) throw new Error('#stage is missing');

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
}

boot().catch((err) => {
  console.error('[kalpa] failed to start', err);
});
