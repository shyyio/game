import { createApp } from "vue";
import App from "@/components/App.vue";
import { router } from "@/client/router.js";
import "@/assets/main.css";

// Vuetify: components/directives auto-imported per use by vite-plugin-vuetify
import "vuetify/styles";
import { createVuetify } from "vuetify";

const vuetify = createVuetify();


createApp(App).use(vuetify).use(router).mount("#app");
