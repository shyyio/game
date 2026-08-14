import {fileURLToPath, URL} from "node:url";

import {defineConfig} from "vite";
import {gitBuildInfo} from "./vite.build-defines.js";

const {commit: BUILD_COMMIT, date: BUILD_DATE} = gitBuildInfo();

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
        // Only reportingserver's private build opts in, to symbolicate the stacks this bundle reports.
        sourcemap: process.env.BUILD_SOURCEMAPS === "1",
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
        // Crash reports carry this so reportingserver can symbolicate against the matching maps;
        // it also gates reporting off for unbundled runs, where it stays "dev".
        __BUILD_COMMIT__: JSON.stringify(BUILD_COMMIT),
        __BUILD_DATE__: JSON.stringify(BUILD_DATE),
    },
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url))
        },
    },
}))
