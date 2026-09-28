import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { defineConfig } from "vite";
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

export default defineConfig({
  base: "/SongToNotes/",
  define: {
    __SEPARATION_MODEL_BYTES__: JSON.stringify(separationModelBytes()),
  },
  plugins: [
    react(),
    inlineBasicPitchModel(),
    binaryAsTextParts(),
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
