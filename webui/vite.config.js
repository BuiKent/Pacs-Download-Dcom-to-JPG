import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  build: {
    outDir: "../web_dist",
    emptyOutDir: true,
    target: "chrome109",
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@cornerstonejs")) {
            return "cornerstone";
          }
          if (id.includes("node_modules")) {
            return "vendor";
          }
        },
      },
    },
  },
  test: {
    include: ["src/**/*.test.js"],
    environment: "jsdom",
  },
});
