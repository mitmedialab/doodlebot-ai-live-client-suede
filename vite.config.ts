import { defineConfig } from "vitest/config";
import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";

// The test server (test-server/server.py) runs on :8000 inside the container.
// Proxy its routes through the dev server so the browser only ever talks to the
// Vite origin (the one VS Code auto-forwards) — no need to forward :8000 or pass
// a cross-origin ?server=. Override the target with TEST_SERVER if it moves.
const TEST_SERVER = process.env.TEST_SERVER ?? "http://localhost:8000";
const apiProxy = Object.fromEntries(
  ["/client", "/sketch", "/resource", "/events"].map((path) => [
    path,
    { target: TEST_SERVER, changeOrigin: true },
  ]),
);

export default defineConfig({
  server: {
    host: "0.0.0.0",
    proxy: apiProxy,
  },
  plugins: [
    tailwindcss(),
    sveltekit({
      compilerOptions: {
        // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
        runes: ({ filename }) =>
          filename.split(/[/\\]/).includes("node_modules") ? undefined : true,
      },
      adapter: adapter(),
      inlineStyleThreshold: -1,
      output: {
        bundleStrategy: "inline"
      },
      files: {
        assets: "release"
      }
    }),
  ],
  test: {
    expect: { requireAssertions: true },
    projects: [
      {
        extends: "./vite.config.ts",
        test: {
          name: "server",
          environment: "node",
          include: ["src/**/*.{test,spec}.{js,ts}"],
          exclude: ["src/**/*.svelte.{test,spec}.{js,ts}"],
        },
      },
    ],
  },
});
