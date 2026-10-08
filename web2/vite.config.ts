import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Not the default ".vite": Cloudflare still holds stale bundles under that path (see server.headers).
  // Cleanup: after a purge of the Cloudflare cache for this host, remove this line.
  cacheDir: "node_modules/.vite-web2",
  server: {
    allowedHosts: ["web2.beckermann-zibert.com"],
    // Vite marks pre-bundled dependencies "immutable". Cloudflare in front of Caddy then keeps a
    // stale bundle across restarts, and the page loads two copies of React. This header stops the
    // CDN only; the browser still caches.
    // Cleanup: after Cloudflare has a cache rule that bypasses the cache for this host, remove it.
    headers: { "CDN-Cache-Control": "no-store" },
    host: "127.0.0.1",
    port: 3100,
  },
  test: { include: ["src/**/*.test.ts"] },
});
