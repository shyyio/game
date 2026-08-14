import {createRouter, createWebHistory} from "vue-router";
import SignIn from "@/components/SignIn.vue";
import Game from "@/components/Game.vue";
import ModList from "@/components/ModList.vue";
import {gameStart} from "@/client/GameStart.js";
import {hasSessionToken} from "@/client/AuthClient.js";
import {SCENARIO_PARAM} from "@/test/scenarios/scenarioParam.js";

const hasScenario = new URLSearchParams(window.location.search).has(SCENARIO_PARAM);

export const router = createRouter({
    history: createWebHistory(),
    routes: [
        {path: "/", name: "login", component: SignIn},
        {path: "/servers", name: "servers", component: SignIn},
        {path: "/mods", name: "mods", component: ModList},
        {path: "/play", name: "play", component: Game},
    ],
});

// A scenario URL skips straight to the game; a bare "/play" without a set-up session (e.g. a
// refresh) bounces back to the server list rather than mounting Game with nothing to connect to;
// "/servers" without (or no longer with) a valid session token bounces back to the login screen.
// "/mods" browses the public registry and needs no session at all.
router.beforeEach((to) => {
    if (to.name === "login" && hasScenario) {
        return {name: "play"};
    }
    if (to.name === "servers" && !hasSessionToken()) {
        return {name: "login"};
    }
    if (to.name === "play" && gameStart.value === null) {
        if (hasScenario) {
            gameStart.value = {mode: "local", username: "", serverUrl: ""};
            return true;
        }
        return {name: "servers"};
    }
    return true;
});
