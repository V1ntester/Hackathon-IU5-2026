import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const target = env.BACKEND_PROXY_TARGET || "http://127.0.0.1:8000";
  return {
    base: "./",
    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": { target },
        "/ws": { target, ws: true },
      },
    },
    build: {
      target: "es2022",
      rollupOptions: {
        input: {
          game: "index.html",
          admin: "admin/index.html",
        },
      },
    },
  };
});
