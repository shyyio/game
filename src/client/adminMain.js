import {createApp} from "vue";
import AdminApp from "@/components/admin/AdminApp.vue";
import "@/assets/main.css";
import "vuetify/styles";
import {createVuetify} from "vuetify";
import {aliases, mdi} from "vuetify/iconsets/mdi-svg";

const vuetify = createVuetify({
    defaults: {
        VTextField: {variant: "outlined"},
    },
    icons: {
        defaultSet: "mdi",
        aliases,
        sets: {mdi},
    },
});

createApp(AdminApp).use(vuetify).mount("#app");
