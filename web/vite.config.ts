import { defineConfig } from "vite";

export default defineConfig({
  // Относительные пути — сборку можно положить в любую подпапку.
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  build: {
    target: "es2022",
  },
});
