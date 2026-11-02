import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(() => {
  return {
    plugins: [react()],
    base: "/",
    build: {
      minify: "terser",
      terserOptions: {
        compress: {
          // Keep console output: the server logs are the only debugging aid
          drop_console: false,
          drop_debugger: true,
        },
      },
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom"],
            settings: ["./src/pages/SettingsPage"],
            movie: ["./src/pages/MoviePage"],
            tv: ["./src/pages/TVPage"],
          },
        },
      },
    },
  };
});
