import {fileURLToPath, URL} from "node:url";

import {defineConfig} from "vite";
import {gitBuildInfo} from "./vite.build-defines.js";

const {commit: BUILD_COMMIT, date: BUILD_DATE} = gitBuildInfo();

// The mod-author test harness (src/test/harness.js): the real SDK and the sim helpers in one node
// bundle, shipped in @spup/game-server. Same externals as the server bundle, since it reaches the
// same engine.
export default defineConfig(({mode}) => ({
    publicDir: false,
    build: {
        ssr: "src/test/harness.js",
        outDir: "dist-harness",
        target: "node20",
        sourcemap: false,
    },
    ssr: {
        noExternal: true,
    },
    define: {
        __DEV__: JSON.stringify(mode !== "production"),
        __BUILD_COMMIT__: JSON.stringify(BUILD_COMMIT),
        __BUILD_DATE__: JSON.stringify(BUILD_DATE),
    },
    resolve: {
        // See vite.config.js: the mods this bundle carries import the SDK by its package name.
        alias: [
            {find: /^@spup\/sdk$/, replacement: fileURLToPath(new URL("./src/sdk/common.js", import.meta.url))},
            {find: /^@spup\/sdk\/client$/, replacement: fileURLToPath(new URL("./src/sdk/client.js", import.meta.url))},
            {find: /^@\//, replacement: `${fileURLToPath(new URL("./src", import.meta.url))}/`},
        ],
    },
}))
