import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  plugins: [react()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    sourcemap: true,
    // lang-markdown が HTML などの解析器を含むため大きくなる。ローカルで配信するので分割しない。
    chunkSizeWarningLimit: 1200,
  },
});
