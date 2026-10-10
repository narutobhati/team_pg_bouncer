import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    resolve: { alias: { "@": path.resolve(__dirname, "src") } },
    optimizeDeps: {
      include: ["framer-motion"],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom", "react-router-dom"],
            motion: ["framer-motion"],
            data: ["@tanstack/react-query", "zustand", "jszip"],
          },
        },
      },
    },
    server: {
      port: 5173,
      proxy: {
        "/api": { target: env.API_PROXY_TARGET || "http://localhost:8080", changeOrigin: true },
      },
    },
  };
});
