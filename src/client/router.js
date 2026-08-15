import {createRouter, createWebHistory} from "vue-router";
import SignIn from "@/components/SignIn.vue";
import Game from "@/components/Game.vue";
import ModList from "@/components/ModList.vue";
import {GAME_MODE_LOCAL, gameStart, lastGameMode, startGame} from "@/client/GameStart.js";
import {hasSessionToken} from "@/client/AuthClient.js";
import {SCENARIO_PARAM} from "@/test/scenarios/scenarioParam.js";
import {sideloadedModUrls} from "@/client/ModSideload.js";

// Either URL parameter means "start a local game with what the URL says", with no session to set up.
const startsLocalGame = new URLSearchParams(window.location.search).has(SCENARIO_PARAM)
    || sideloadedModUrls().length > 0;

export const router = createRouter({
    history: createWebHistory(),
    routes: [
        {path: "/", name: "login", component: SignIn},
        {path: "/servers", name: "servers", component: SignIn},
        {path: "/mods", name: "mods", component: ModList},
        {path: "/play", name: "play", component: Game},
    ],
});

// A scenario or ?mod= URL skips straight to the game; a bare "/play" without a set-up session
// (e.g. a refresh) bounces back to the server list rather than mounting Game with nothing to join;
// "/servers" without (or no longer with) a valid session token bounces back to the login screen.
// "/mods" browses the public registry and needs no session at all.
router.beforeEach((to) => {
    if (to.name === "login" && startsLocalGame) {
        return {name: "play"};
    }
    if (to.name === "servers" && !hasSessionToken()) {
        return {name: "login"};
    }
    if (to.name === "play" && gameStart.value === null) {
        if (startsLocalGame) {
            startGame({mode: GAME_MODE_LOCAL, username: "", serverUrl: ""});
            return true;
        }
        // A local game is launched from the login screen, a remote one from the server list.
        if (lastGameMode() === GAME_MODE_LOCAL) {
            return {name: "login"};
        }
        return {name: "servers"};
    }
    return true;
});
