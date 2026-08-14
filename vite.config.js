import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"],
      manifest: {
        name: "Sleeper Draft Viewer",
        short_name: "Draft Viewer",
        description: "A live, party-ready presentation for Sleeper fantasy football drafts.",
        theme_color: "#060a14",
        background_color: "#060a14",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "/icons/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/(api\.sleeper\.app|sleepercdn\.com)\//,
            handler: "NetworkOnly"
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts" }
          }
        ]
      }
    })
  ],
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.js"]
  }
});
