// Full-screen notices that must work even when the game, its styles or WebGL did not load.
// The styles for #fatal and #boot live inline in index.html, so nothing here needs ui.css.

export type NoticeKind = 'startup' | 'webgl' | 'context';

const COPY: Record<NoticeKind, { title: string; body: string; button: string }> = {
  startup: {
    title: 'Something went wrong',
    body: 'The game could not start. Reload the page to try again. If it keeps happening, try another browser.',
    button: 'Reload',
  },
  webgl: {
    title: 'This browser cannot show the game',
    body: 'KALPA needs WebGL, and it is switched off or unavailable here. Turn on hardware acceleration in your browser settings, or open the game in a recent version of Chrome, Edge, Firefox or Safari.',
    button: 'Try again',
  },
  context: {
    title: 'The graphics were interrupted',
    body: 'The browser stopped the game\u2019s graphics, which can happen when a device runs short of memory. Reload to pick up from your last save.',
    button: 'Reload',
  },
};

/** Removes the first-paint splash that index.html shows before the scripts load. */
export function hideBoot(): void {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.classList.add('is-done');
  window.setTimeout(() => boot.remove(), 700);
}

/** Shows a notice over everything. Returns a function that removes it again. */
export function showNotice(kind: NoticeKind): () => void {
  document.getElementById('boot')?.remove();
  document.getElementById('fatal')?.remove();
  const c = COPY[kind];
  const root = document.createElement('div');
  root.id = 'fatal';
  root.setAttribute('role', 'alert');
  const card = document.createElement('div');
  card.className = 'fatal-card';
  const h = document.createElement('h1');
  h.textContent = c.title;
  const p = document.createElement('p');
  p.textContent = c.body;
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = c.button;
  b.addEventListener('click', () => window.location.reload());
  card.append(h, p, b);
  root.appendChild(card);
  document.body.appendChild(root);
  b.focus();
  return () => root.remove();
}
