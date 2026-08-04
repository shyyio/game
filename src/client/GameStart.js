import {ref} from "vue";

/**
 * Params for the in-progress or active game session, set right before navigating to the "game"
 * route. Kept out of the URL since remote mode carries a join token.
 * @type {import("vue").Ref<{mode: string, username: string, token: string, serverUrl: string}|null>}
 */
export const gameStart = ref(null);
