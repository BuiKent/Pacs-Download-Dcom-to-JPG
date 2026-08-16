import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  build: {
    outDir: "../web_dist",
    emptyOutDir: true,
    target: "chrome109",
    chunkSizeWarningLimit: 1800,
  },
  test: {
    include: ["src/**/*.test.js"],
    environment: "jsdom",
  },
});
