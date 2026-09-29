import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, runnerImport } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

const VIRTUAL_MODEL_ID = "virtual:basic-pitch-model";
const RESOLVED_VIRTUAL_MODEL_ID = `\0${VIRTUAL_MODEL_ID}`;

function inlineBasicPitchModel(): Plugin {
  return {
    name: "inline-basic-pitch-model",
    resolveId(id) {
      return id === VIRTUAL_MODEL_ID ? RESOLVED_VIRTUAL_MODEL_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_MODEL_ID) {
        return null;
      }

      const modelJsonUrl = new URL(
        "./node_modules/@spotify/basic-pitch/model/model.json",
        import.meta.url,
      );
      const modelWeightsUrl = new URL(
        "./node_modules/@spotify/basic-pitch/model/group1-shard1of1.bin",
        import.meta.url,
      );

      return Promise.all([
        import("node:fs/promises").then(({ readFile }) =>
          readFile(modelJsonUrl, "utf8"),
        ),
        import("node:fs/promises").then(({ readFile }) =>
          readFile(modelWeightsUrl),
        ),
      ]).then(([modelJson, modelWeights]) => {
        if (modelWeights.byteLength % 4 !== 0) {
          throw new Error("Basic Pitch model weights are not 32-bit aligned.");
        }

        return [
          `export const modelJson = ${JSON.stringify(modelJson)};`,
          `export const modelWeightsBase64 = ${JSON.stringify(modelWeights.toString("base64"))};`,
        ].join("\n");
      });
    },
  };
}

/**
 * Size of the separation model shipped with this build, or 0 when the build
 * has none. The page uses it to show download progress even when the server
 * leaves out Content-Length.
 */
function separationModelBytes() {
  try {
    return statSync(new URL("./models/htdemucs_embedded.onnx", import.meta.url)).size;
  } catch {
    return 0;
  }
}

/** Raw bytes per part; about 5MB of text each once written as base64. */
const TEXT_PART_BYTES = 4 * 1024 * 1024;

/**
 * Large binaries the separation needs, and where their parts are published.
 * Filtered connections (NetFree, for one) hold back or damage big binary
 * downloads — the pitch model above is inlined into the JS for the same
 * reason — so each file also ships as a set of small JSON files holding
 * base64 text, with a manifest next to them. See `src/lib/textParts.ts`.
 */
const TEXT_PART_ASSETS = [
  { name: "htdemucs", src: "./models/htdemucs_embedded.onnx" },
  {
    name: "ort-wasm",
    src: "./node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm",
  },
];

function binaryAsTextParts(): Plugin {
  return {
    name: "binary-as-text-parts",
    apply: "build",
    generateBundle() {
      for (const { name, src } of TEXT_PART_ASSETS) {
        let bytes: Buffer;
        try {
          bytes = readFileSync(new URL(src, import.meta.url));
        } catch {
          // A build without the model (no prebuild) keeps the page's
          // fallback to the direct download.
          continue;
        }
        // The hash in the names keeps a stale part from an older deploy out
        // of a newer file.
        const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
        const parts: string[] = [];
        for (let offset = 0; offset < bytes.byteLength; offset += TEXT_PART_BYTES) {
          const fileName = `parts/${name}/${hash}-${parts.length}.json`;
          const slice = bytes.subarray(offset, offset + TEXT_PART_BYTES);
          this.emitFile({
            type: "asset",
            fileName,
            source: JSON.stringify(slice.toString("base64")),
          });
          parts.push(fileName.slice(`parts/${name}/`.length));
        }
        this.emitFile({
          type: "asset",
          fileName: `parts/${name}/manifest.json`,
          source: JSON.stringify({ bytes: bytes.byteLength, parts }),
        });
      }
    },
  };
}

const SITE_URL = "https://shmuel-lamed.github.io/SongToNotes/";
const SITE_NAME = "כלי מוזיקה";

function escapeAttr(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Sets the content of the first tag matching `pattern`'s attribute. */
function setAttr(html: string, pattern: RegExp, value: string) {
  return html.replace(pattern, (tag) =>
    tag.replace(/(content|href)="[^"]*"/, (_, name: string) => `${name}="${escapeAttr(value)}"`),
  );
}

type ToolPage = { id: string; title: string; tagline: string; description: string };

/**
 * The tools live behind hash routes, which search engines fold into the one
 * home page. This writes a real page for every visible tool —
 * `<tool>/index.html`, the same app with its own title, description and
 * canonical address — and lists them all in sitemap.xml, so each tool can be
 * found on its own. The router reads the tool from the path on these pages.
 */
function toolPages(): Plugin {
  let outDir = "dist";
  return {
    name: "tool-pages",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    async writeBundle() {
      const { module } = await runnerImport<{ TOOLS: ToolPage[] }>("./src/lib/tools.tsx");
      const shell = readFileSync(join(outDir, "index.html"), "utf8")
        // Relative links would point inside the tool's folder.
        .replace(/(href|src)="\.\//g, '$1="/SongToNotes/');

      for (const tool of module.TOOLS) {
        const url = `${SITE_URL}${tool.id}/`;
        const title = `${tool.title} — ${tool.tagline} | ${SITE_NAME}`;
        let html = shell.replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(title)}</title>`);
        html = setAttr(html, /<meta\s+name="description"[^>]*>/, tool.description);
        html = setAttr(html, /<link rel="canonical"[^>]*>/, url);
        html = setAttr(html, /<meta property="og:title"[^>]*>/, title);
        html = setAttr(html, /<meta\s+property="og:description"[^>]*>/, tool.description);
        html = setAttr(html, /<meta property="og:url"[^>]*>/, url);
        mkdirSync(join(outDir, tool.id), { recursive: true });
        writeFileSync(join(outDir, tool.id, "index.html"), html);
      }

      const urls = [SITE_URL, ...module.TOOLS.map((tool) => `${SITE_URL}${tool.id}/`)];
      const sitemap = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...urls.map(
          (loc, index) =>
            `  <url><loc>${loc}</loc><changefreq>weekly</changefreq><priority>${index === 0 ? "1.0" : "0.8"}</priority></url>`,
        ),
        "</urlset>",
        "",
      ].join("\n");
      writeFileSync(join(outDir, "sitemap.xml"), sitemap);
    },
  };
}

export default defineConfig({
  base: "/SongToNotes/",
  define: {
    __SEPARATION_MODEL_BYTES__: JSON.stringify(separationModelBytes()),
  },
  plugins: [
    react(),
    inlineBasicPitchModel(),
    binaryAsTextParts(),
    toolPages(),
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/@spotify/basic-pitch/model/*",
          dest: "model",
        },
        // The vocal-separation network ships with the site rather than being
        // fetched from a third-party host by every visitor. `npm run build`
        // downloads it first (scripts/fetch-separation-model.mjs); a dev
        // server without it falls back to the upstream URL.
        {
          src: "models/htdemucs_embedded.onnx",
          dest: "model",
        },
      ],
    }),
  ],
  // Workers are bundled in their own pass, which does not inherit the plugins
  // above. The transcription worker is what imports the inlined model, so the
  // plugin has to be registered here too.
  worker: {
    format: "es",
    plugins: () => [inlineBasicPitchModel()],
  },
  build: {
    chunkSizeWarningLimit: 1800,
  },
});
