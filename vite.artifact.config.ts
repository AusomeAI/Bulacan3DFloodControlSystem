import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

/**
 * Single-file build. Everything - JS, CSS, dynamic chunks - lands in one bundle
 * that scripts/build-artifact.mjs then inlines into a standalone HTML page,
 * together with the contents of public/data. Used for sharing a runnable
 * preview where there is no server to fetch the datasets from.
 */
export default mergeConfig(
  base,
  defineConfig({
    build: {
      outDir: "dist-artifact",
      cssCodeSplit: false,
      assetsInlineLimit: 100_000_000,
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
          entryFileNames: "app.js",
          assetFileNames: "app.[ext]",
        },
      },
    },
  }),
);
