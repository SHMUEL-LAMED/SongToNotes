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

export default defineConfig({
  base: "/SongToNotes/",
  plugins: [
    react(),
    inlineBasicPitchModel(),
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/@spotify/basic-pitch/model/*",
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
