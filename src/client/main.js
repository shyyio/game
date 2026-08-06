import { createApp } from "vue";
import App from "@/components/App.vue";
import { router } from "@/client/router.js";
import { installCrashReporter, reportVueError } from "@/client/CrashReporter.js";
import "@/assets/main.css";

// Vuetify: components/directives auto-imported per use by vite-plugin-vuetify
import "vuetify/styles";
import { createVuetify } from "vuetify";

const vuetify = createVuetify();

installCrashReporter();

const app = createApp(App);
app.config.errorHandler = (error, instance, info) => {
    console.error(error, info);
    reportVueError(error, info);
};
app.use(vuetify).use(router).mount("#app");
