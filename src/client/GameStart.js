import {ref} from "vue";

export const GAME_MODE_LOCAL = "local";
export const GAME_MODE_REMOTE = "remote";

// Outlives the in-memory gameStart, which a page reload wipes.
const STORAGE_GAME_MODE = "spup.game-mode";

/**
 * Params for the in-progress or active game session, set right before navigating to the "play"
 * route. Kept out of the URL since remote mode carries a join token.
 * @type {import("vue").Ref<{mode: string, username: string, token: string, serverUrl: string}|null>}
 */
export const gameStart = ref(null);

/**
 * Sets the params for the game about to start, recording its mode so a reload of "/play" — which
 * loses them — knows which screen that game was launched from.
 * @param {{mode: string, username: string, token: string, serverUrl: string}} start
 * @returns {void}
 */
export function startGame(start) {
    gameStart.value = start;
    sessionStorage.setItem(STORAGE_GAME_MODE, start.mode);
}

/**
 * @returns {string|null} the mode of the last game started in this tab, or null if there was none
 */
export function lastGameMode() {
    return sessionStorage.getItem(STORAGE_GAME_MODE);
}

/**
 * Why the last join attempt bounced back to the server list (e.g. the server's mods failed to load);
 * shown there once, then cleared.
 * @type {import("vue").Ref<string>}
 */
export const startError = ref("");
