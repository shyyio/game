import {defineConfig} from "vite";
import vue from "@vitejs/plugin-vue";
import vuetify from "vite-plugin-vuetify";
import {builtModHashes, gitBuildInfo, packageVersion} from "./vite.build-defines.js";
import {ALIASES} from "./vite.aliases.js";

const {commit: BUILD_COMMIT, date: BUILD_DATE} = gitBuildInfo();
const APP_VERSION = packageVersion();
const DIST_MODS = "build/mods";

// https://vite.dev/config/
export default defineConfig(({mode}) => {
    // A production client verifies a server's base mods against these, so a build without them
    // would refuse every server; a dev build runs no gate and needs none.
    let baseModHashes = [];
    if (mode === "production") {
        baseModHashes = builtModHashes(DIST_MODS);
    }
    return {
        plugins: [
            vue(),
            vuetify({
                autoImport: {labs: true},
                styles: {configFile: "src/client/vuetify-settings.scss"}
            }),
            // vueDevTools(),
        ],
        // Literals for src/common/env.js: __DEV__ enables dead-code elimination.
        define: {
            __DEV__: JSON.stringify(mode !== "production"),
            // On in a dev build, and in the production build @spup/game-client packs (SPUP_DEV_TOOLS=1):
            // it adds the controls an author needs to reach their own server, which the site does not ship.
            __DEV_TOOLS__: JSON.stringify(mode !== "production" || process.env.SPUP_DEV_TOOLS === "1"),
            __APP_VERSION__: JSON.stringify(APP_VERSION),
            __BUILD_COMMIT__: JSON.stringify(BUILD_COMMIT),
            __BUILD_DATE__: JSON.stringify(BUILD_DATE),
            __BASE_MOD_HASHES__: JSON.stringify(baseModHashes),
        },
        build: {
            outDir: "build/client",
            // Public build ships no source; only reportingserver's private build opts in.
            sourcemap: process.env.BUILD_SOURCEMAPS === "1",
        },
        server: {
            host: "0.0.0.0"
        },
        resolve: {
            // The SDK entries come first: mods import the engine by its published package name, and in
            // this repo that name resolves to the source it is packed from — never to an installed copy,
            // which would give a mod its own second set of engine classes.
            alias: ALIASES,
        },
    };
});
