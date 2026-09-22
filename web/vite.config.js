import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One file out.
 *
 * Apps Script serves HTML by name from the script project — it has no idea what an asset is, and
 * a <script src> pointing anywhere else would be blocked by the sandbox. So the build ends with
 * everything folded into a single Dialog.html: the JavaScript inline, the CSS inline, no
 * requests but the fonts.
 *
 * The output lands in addon/, beside the .gs files, because that whole folder is what gets
 * pushed to the script project.
 */
function singleFile({ out, name }) {
  return {
    name: 'kartz-single-file',
    enforce: 'post',
    writeBundle(options, bundle) {
      const dist = options.dir;
      let html = readFileSync(join(dist, 'index.html'), 'utf8');
      const js = [], css = [];
      for (const [file, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'chunk' && chunk.isEntry) js.push(chunk.code);
        else if (chunk.type === 'chunk') js.unshift(chunk.code);
        else if (file.endsWith('.css')) css.push(String(chunk.source));
      }
      html = html
        .replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '')
        .replace(/<link[^>]*rel="stylesheet"[^>]*href="\.?\/assets[^"]*"[^>]*>/g, '')
        // A function replacement, not a string one: `$&` and `$'` mean something to
        // String.replace, and minified JavaScript is full of `$` names — `a&&$&&$.row` would
        // otherwise paste the matched tag into the middle of the code.
        .replace('</head>', () => `<style>\n${css.join('\n')}\n</style>\n</head>`)
        // The closing tag inside any string in the bundle would end the block early.
        .replace('</body>', () => `<script type="module">\n${js.join('\n').replace(/<\/script>/g, '<\\/script>')}\n</script>\n</body>`);
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, name), html);
      rmSync(dist, { recursive: true, force: true });
      const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
      this.warn(`${name} → ${out} (${kb} KB, everything inline)`);
    },
  };
}

export default defineConfig({
  plugins: [react(), singleFile({ out: '../addon', name: 'Dialog.html' })],
  base: './',
  server: { port: 5173 },
  build: {
    outDir: 'dist',
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
    modulePreload: { polyfill: false },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
