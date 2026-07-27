import {fileURLToPath, URL} from "node:url";

import {defineConfig} from "vite";

// Server CLI bundle: node target, pure-JS deps inlined, native addons external. The deploy
// artifact is dist-server plus an install of just the external deps; the unbundled
// `npm run serve` dev path (src/server/loader.js hooks) is unaffected.
export default defineConfig(({mode}) => ({
    // The public dir (favicon) belongs to the browser build only.
    publicDir: false,
    build: {
        ssr: "src/server/main.js",
        outDir: "dist-server",
        target: "node20",
        // SSR builds skip minification by default; the server artifact wants it anyway.
        minify: "esbuild",
        rollupOptions: {
            // Native addons cannot be inlined into the bundle.
            external: ["better-sqlite3", "uWebSockets.js"],
        },
    },
    ssr: {
        // Inline every other dependency (protobufjs, underscore) for a self-contained bundle.
        noExternal: true,
    },
    define: {
        __DEV__: JSON.stringify(mode !== "production"),
    },
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url))
        },
    },
}))
