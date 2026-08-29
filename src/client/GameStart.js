import {ref} from "vue";

export const GAME_MODE_LOCAL = "local";
export const GAME_MODE_REMOTE = "remote";

// Outlives the in-memory gameStart, which a page reload wipes.
const STORAGE_GAME_MODE = "spup.game-mode";

// A local game's params, kept across the reload that starts it. Only local ones: a remote join
// carries a token, and per auth.md nothing a server's mod code can read may hold one.
const STORAGE_LOCAL_START = "spup.local-start";

/**
 * @typedef GameStartParams {Object}
 * @property {string} mode
 * @property {string} username
 * @property {string} token
 * @property {string} serverUrl
 */

/**
 * Params for the in-progress or active game session, set right before navigating to the "play"
 * route. Kept out of the URL since remote mode carries a join token.
 */
export const gameStart = ref(readLocalStart());

/**
 * @returns {GameStartParams|null} the local game this tab is starting, if it is mid-reload into one
 */
function readLocalStart() {
    const stored = sessionStorage.getItem(STORAGE_LOCAL_START);
    if (stored === null) {
        return null;
    }
    return JSON.parse(stored);
}

/**
 * Sets the params for the game about to start, recording its mode so a reload of "/play" — which
 * loses them — knows which screen that game was launched from.
 * @param {GameStartParams} start
 * @returns {void}
 */
export function startGame(start) {
    gameStart.value = start;
    sessionStorage.setItem(STORAGE_GAME_MODE, start.mode);
    if (start.mode === GAME_MODE_LOCAL) {
        sessionStorage.setItem(STORAGE_LOCAL_START, JSON.stringify(start));
        return;
    }
    sessionStorage.removeItem(STORAGE_LOCAL_START);
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
 */
export const startError = ref("");
