import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: ["web2.beckermann-zibert.com"],
    host: "127.0.0.1",
    port: 3100,
  },
  test: { include: ["src/**/*.test.ts"] },
});
