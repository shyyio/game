import {fileURLToPath, URL} from "node:url";

import {defineConfig} from "vite";

// Auth server CLI bundle: node target, pure-JS deps inlined, native addons external. The deploy
// artifact is dist-authserver plus an install of just the external deps; the unbundled
// `npm run serve:auth` dev path (src/server/loader.js hooks) is unaffected.
export default defineConfig(({mode}) => ({
    // The public dir (favicon) belongs to the browser build only.
    publicDir: false,
    build: {
        ssr: "src/authserver/main.js",
        outDir: "dist-authserver",
        target: "node20",
        rollupOptions: {
            // Native addons cannot be inlined into the bundle.
            external: ["better-sqlite3", "uWebSockets.js"],
        },
    },
    ssr: {
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
