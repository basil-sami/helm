import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, proxy /api to the Express backend on :4000.
// In production the backend serves the built files, so no proxy is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
