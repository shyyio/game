import {fileURLToPath, URL} from "node:url";

import {defineConfig} from "vite";
import {gitBuildInfo} from "./vite.build-defines.js";

const {commit: BUILD_COMMIT, date: BUILD_DATE} = gitBuildInfo();

// Reporting server CLI bundle: node target, pure-JS deps inlined, native addons external.
export default defineConfig(({mode}) => ({
    // Favicon dir belongs to the browser build only.
    publicDir: false,
    build: {
        ssr: "src/reportingserver/main.js",
        outDir: "build/reportingserver",
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
        // Shown in admin UI to match reports against the client build that produced them.
        __BUILD_COMMIT__: JSON.stringify(BUILD_COMMIT),
        __BUILD_DATE__: JSON.stringify(BUILD_DATE),
    },
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url))
        },
    },
}))
