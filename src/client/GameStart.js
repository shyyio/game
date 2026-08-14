import {ref} from "vue";

/**
 * Params for the in-progress or active game session, set right before navigating to the "play"
 * route. Kept out of the URL since remote mode carries a join token.
 * @type {import("vue").Ref<{mode: string, username: string, token: string, serverUrl: string}|null>}
 */
export const gameStart = ref(null);

/**
 * Why the last join attempt bounced back to the server list (e.g. the server's mods failed to load);
 * shown there once, then cleared.
 * @type {import("vue").Ref<string>}
 */
export const startError = ref("");
