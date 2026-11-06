import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import type { Plugin } from 'vite';

const COMPRESSIBLE = /\.(?:js|css|html|svg|json|txt)$/;
const MIN_BYTES = 1024;

function* filesIn(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* filesIn(full);
    else yield full;
  }
}

/** Writes `.br` and `.gz` next to each text asset; the server's static handler sends them to clients that accept them. */
export function preCompress(): Plugin {
  let outDir = '';
  return {
    name: 'homestream:precompress',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle: {
      order: 'post',
      handler() {
        for (const file of filesIn(outDir)) {
          if (!COMPRESSIBLE.test(file) || statSync(file).size < MIN_BYTES) continue;
          const source = readFileSync(file);
          writeFileSync(`${file}.gz`, gzipSync(source, { level: 9 }));
          writeFileSync(
            `${file}.br`,
            brotliCompressSync(source, {
              params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: source.length },
            }),
          );
        }
      },
    },
  };
}

/** The Inter font is needed by the first paint, so the page asks for it before the CSS has been parsed. */
export function preloadFont(): Plugin {
  return {
    name: 'homestream:preload-font',
    transformIndexHtml: {
      order: 'post',
      handler(_html, context) {
        const font = Object.keys(context.bundle ?? {}).find((name) => name.endsWith('.woff2'));
        if (!font) return undefined;
        return [
          {
            tag: 'link',
            attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `/${font}`, crossorigin: true },
            injectTo: 'head-prepend',
          },
        ];
      },
    },
  };
}
