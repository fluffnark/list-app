import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icon.svg", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "ListFlow",
        short_name: "ListFlow",
        description: "A little space for everything on your mind.",
        theme_color: "#7771ef",
        background_color: "#111214",
        display: "standalone",
        start_url: ".",
        scope: ".",
        icons: [
          {
            src: "icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
        ],
      },
      workbox: {
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/\/api\//, /\/auth\//, /\/mcp/, /\/openapi/],
        globPatterns: ["**/*.{js,css,html,svg,png}"],
      },
    }),
  ],
  build: { target: "es2022" },
  base: process.env.APP_BASE || "/",
  server: {
    proxy: {
      "/api": "http://127.0.0.1:4318",
      "/auth": "http://127.0.0.1:4318",
    },
  },
  test: { include: ["tests/**/*.test.ts"] },
} as any);
