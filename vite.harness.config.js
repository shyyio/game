import {defineConfig} from "vite";
import {gitBuildInfo} from "./vite.build-defines.js";
import {ALIASES} from "./vite.aliases.js";

const {commit: BUILD_COMMIT, date: BUILD_DATE} = gitBuildInfo();

// The mod-author test harness (src/test/harness.js): the real SDK and the sim helpers in one node
// bundle, shipped in @spup/game-server. Everything is inlined — the sim it reaches has no native
// dependency, so unlike the server bundle this one needs no externals and installs nothing.
export default defineConfig(({mode}) => ({
    publicDir: false,
    build: {
        ssr: "src/test/harness.js",
        outDir: "build/harness",
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
        alias: ALIASES,
    },
}))
