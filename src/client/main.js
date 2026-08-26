import { createApp } from "vue";
import App from "@/components/App.vue";
import { router } from "@/client/router.js";
import { installCrashReporter, reportVueError } from "@/client/CrashReporter.js";
import "@/assets/main.css";

// Vuetify: components/directives auto-imported per use by vite-plugin-vuetify
import "vuetify/styles";
import { createVuetify } from "vuetify";
// SVG icons, not the icon font: the alias set inlines its path data, and any icon a component names
// itself comes from @mdi/js as a tree-shaken string constant. Nothing to download at runtime.
import { aliases, mdi } from "vuetify/iconsets/mdi-svg";
import { vuetifyThemes, vuetifyThemeName } from "@/client/vuetifyTheme.js";
import DeviceSettings, { DEVICE_SETTING_THEME } from "@/client/state/DeviceSettings.js";
import { THEME_DEFAULT } from "@/client/Theme.js";

const vuetify = createVuetify({
    defaults: {
        VTextField: {variant: "outlined"},
    },
    icons: {
        defaultSet: "mdi",
        aliases,
        sets: {mdi},
    },
    theme: {
        defaultTheme: vuetifyThemeName(DeviceSettings.getNumber(DEVICE_SETTING_THEME, THEME_DEFAULT)),
        themes: vuetifyThemes,
    },
});

installCrashReporter();

const app = createApp(App);
app.config.errorHandler = (error, instance, info) => {
    console.error(error, info);
    reportVueError(error, info);
};
app.use(vuetify).use(router).mount("#app");
