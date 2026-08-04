// Application close-code range: 4000-4999. Shared between the server (which sends these) and the
// client (which classifies them: CLOSE_CODE_SUPERSEDED never retries, the rest do).
export const CLOSE_CODE_SLOW_CONSUMER = 4000;
export const CLOSE_CODE_BAD_SIGN_IN = 4001;
export const CLOSE_CODE_BAD_FRAME = 4002;
export const CLOSE_CODE_SUPERSEDED = 4003;
export const CLOSE_CODE_SERVER_SHUTDOWN = 4004;
