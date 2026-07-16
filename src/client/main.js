import { createApp } from "vue";
import App from "@/components/App.vue";
import "@/assets/main.css";

// Vuetify: components/directives auto-imported per use by vite-plugin-vuetify
import "vuetify/styles";
import { createVuetify } from "vuetify";

const vuetify = createVuetify();


createApp(App).use(vuetify).mount("#app");
