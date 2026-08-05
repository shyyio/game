import {fileURLToPath, URL} from "node:url";

import {defineConfig} from "vite";
import vue from "@vitejs/plugin-vue";
import vuetify from "vite-plugin-vuetify";
import {gitBuildInfo} from "./vite.build-defines.js";

const {commit: BUILD_COMMIT, date: BUILD_DATE} = gitBuildInfo();

// https://vite.dev/config/
export default defineConfig(({mode}) => ({
    plugins: [
        vue(),
        vuetify({
            autoImport: true,
            styles: {configFile: "src/client/vuetify-settings.scss"}
        }),
        // vueDevTools(),
    ],
    // Literals for src/common/env.js: __DEV__ enables dead-code elimination.
    define: {
        __DEV__: JSON.stringify(mode !== "production"),
        __BUILD_COMMIT__: JSON.stringify(BUILD_COMMIT),
        __BUILD_DATE__: JSON.stringify(BUILD_DATE),
    },
    build: {
        // Public build ships no source; only reportingserver's private build opts in.
        sourcemap: process.env.BUILD_SOURCEMAPS === "1",
    },
    server: {
        host: "0.0.0.0"
    },
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url))
        },
    },
}))
