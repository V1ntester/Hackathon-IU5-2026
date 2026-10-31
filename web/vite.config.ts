import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const target = env.BACKEND_PROXY_TARGET || "http://127.0.0.1:8000";
  return {
    // Относительные пути статических ресурсов; API имеет собственные пути от корня.
    base: "./",
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": { target },
        "/ws": { target, ws: true },
      },
    },
    build: {
      target: "es2022",
    },
  };
});
