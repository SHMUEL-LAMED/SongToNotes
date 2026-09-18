import { statSync } from "node:fs";
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

export default defineConfig({
  base: "/SongToNotes/",
  define: {
    __SEPARATION_MODEL_BYTES__: JSON.stringify(separationModelBytes()),
  },
  plugins: [
    react(),
    inlineBasicPitchModel(),
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
        // The speech recogniser's runtime, served from the site rather than
        // from a CDN. transformers.js pins its own onnxruntime-web, which npm
        // nests under it when the version differs from the site's.
        {
          src: "node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.{wasm,mjs}",
          dest: "ort",
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
