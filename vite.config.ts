import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite';

// GitHub Pages serves the game from a subpath, so base must match the repository name.
const base = process.env.VITE_BASE ?? '/kalpa/';

// The public address of the site, for the tags that must be absolute (canonical, og:image, og:url).
// Unset by default, so no address is ever written into the repository. The deploy workflow sets it.
const siteUrl = (process.env.VITE_SITE_URL ?? '').trim().replace(/\/*$/, '/');
const hasSite = /^https?:\/\//.test(siteUrl);

/** Everything the game loads is served from its own origin. */
function csp(dev: boolean): string {
  return [
    "default-src 'none'",
    // wasm: Draco decodes meshes in WebAssembly. blob: workers carry that decoder.
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    // The first-paint splash in index.html is an inline <style>.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob: data:",
    "font-src 'self'",
    dev ? "connect-src 'self' blob: ws: http://localhost:* http://127.0.0.1:*" : "connect-src 'self' blob:",
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; ');
}

function kalpaHtml(): Plugin {
  return {
    name: 'kalpa-html',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const tags: HtmlTagDescriptor[] = [
          { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp(Boolean(ctx.server)) }, injectTo: 'head-prepend' },
        ];
        // Preload only the font the first paint needs (the display face of the splash and title).
        const font = ctx.bundle && Object.keys(ctx.bundle).find((k) => /marcellus-latin-400-normal.*\.woff2$/.test(k));
        if (font) tags.push({ tag: 'link', attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `${base}${font}`, crossorigin: '' }, injectTo: 'head' });
        if (hasSite) {
          tags.push(
            { tag: 'link', attrs: { rel: 'canonical', href: siteUrl }, injectTo: 'head' },
            { tag: 'meta', attrs: { property: 'og:url', content: siteUrl }, injectTo: 'head' },
            { tag: 'meta', attrs: { property: 'og:image', content: `${siteUrl}og-image.jpg` }, injectTo: 'head' },
            { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' }, injectTo: 'head' },
            { tag: 'meta', attrs: { property: 'og:image:height', content: '630' }, injectTo: 'head' },
            { tag: 'meta', attrs: { property: 'og:image:alt', content: 'The KALPA title: a door symbol above the name, with a whale passing in the deep.' }, injectTo: 'head' },
            { tag: 'meta', attrs: { name: 'twitter:image', content: `${siteUrl}og-image.jpg` }, injectTo: 'head' },
          );
        }
        return tags;
      },
    },
  };
}

export default defineConfig({
  base,
  plugins: [kalpaHtml()],
  build: { target: 'es2020', assetsInlineLimit: 0, chunkSizeWarningLimit: 1200 },
});
