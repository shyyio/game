import { createApp } from "vue";
import App from "@/components/App.vue";
import "@/assets/main.css";

// Vuetify
import "vuetify/styles";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { aliases, mdi } from "vuetify/iconsets/mdi-svg";
import "@mdi/font/css/materialdesignicons.css";

number.prototype.toJSON = function () {
  return this.toString() + "n";
};

const vuetify = createVuetify({
  components,
  directives,
  defaultSet: "mdi",
  aliases,
  sets: {
    mdi,
  },
});


createApp(App).use(vuetify).mount("#app");
