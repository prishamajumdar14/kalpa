// Loads game data. Optional files are looked up with import.meta.glob, so a file that doesn't
// exist yet is simply absent rather than a build error.
import type { Manifest, Story, Subtitle } from './types';

const storyFiles = import.meta.glob('../data/story.json', { eager: true, import: 'default' });
const fixtureFiles = import.meta.glob('../data/story.fixture.json', { import: 'default' });
const manifestFiles = import.meta.glob('../data/manifest.json', { eager: true, import: 'default' });
const subFiles = import.meta.glob('../data/prologue_subs.json', { eager: true, import: 'default' });

export async function loadStory(forceFixture: boolean): Promise<Story> {
  const real = storyFiles['../data/story.json'] as Story | undefined;
  if (real && !forceFixture) return real;
  const loader = fixtureFiles['../data/story.fixture.json'];
  if (!loader) throw new Error('No story data: src/data/story.json is missing');
  if (!real) console.info('[kalpa] story.json not found, using the test fixture');
  return (await loader()) as Story;
}

export function loadManifest(): Manifest {
  const m = manifestFiles['../data/manifest.json'] as Partial<Manifest> | undefined;
  return { models: {}, ...m };
}

export function loadSubs(): Subtitle[] {
  const subs = subFiles['../data/prologue_subs.json'];
  return Array.isArray(subs) ? (subs as Subtitle[]) : [];
}
