import {defineConfig} from "vite";
import vue from "@vitejs/plugin-vue";
import vuetify from "vite-plugin-vuetify";
import {gitBuildInfo, packageVersion} from "./vite.build-defines.js";
import {ALIASES} from "./vite.aliases.js";

const {commit: BUILD_COMMIT, date: BUILD_DATE} = gitBuildInfo();
const APP_VERSION = packageVersion();
const GAME_SERVER = "http://127.0.0.1:27500";

// The server's admin page: a second Vue build the game server serves from build/admin/ under
// /admin. `npm run dev:admin` proxies its API to a locally running server.
export default defineConfig(({mode}) => ({
    plugins: [
        vue(),
        vuetify({
            autoImport: {labs: true},
            styles: {configFile: "src/client/vuetify-settings.scss"}
        }),
    ],
    publicDir: false,
    base: "/admin/",
    define: {
        __DEV__: JSON.stringify(mode !== "production"),
        __DEV_TOOLS__: JSON.stringify(false),
        __APP_VERSION__: JSON.stringify(APP_VERSION),
        __BUILD_COMMIT__: JSON.stringify(BUILD_COMMIT),
        __BUILD_DATE__: JSON.stringify(BUILD_DATE),
    },
    build: {
        outDir: "build/admin",
        rollupOptions: {
            input: "admin.html",
        },
    },
    server: {
        open: "/admin/admin.html",
        proxy: {
            "/admin/api": GAME_SERVER,
        },
    },
    resolve: {
        alias: ALIASES,
    },
}))
