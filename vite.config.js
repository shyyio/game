import {fileURLToPath, URL} from "node:url";

import {defineConfig} from "vite";
import vue from "@vitejs/plugin-vue";
import vuetify from "vite-plugin-vuetify";

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
    // Inject __DEV__ as a real literal so `src/env.js` folds to a constant and
    // dev-only branches are dead-code-eliminated from production builds.
    define: {
        __DEV__: JSON.stringify(mode !== "production"),
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
