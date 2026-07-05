import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
	// Relative asset paths — the shell is loaded via file:// inside Electron.
	base: "./",
	plugins: [react(), tailwindcss()],
	build: { outDir: "dist", emptyOutDir: true },
});
