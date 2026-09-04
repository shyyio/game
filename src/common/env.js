
// In the browser/Vite build __DEV__ is injected as a literal. In Node it is absent, so DEV
// follows the test flag set by the test loader: on under tests, off for the server/prod.
export const DEV = typeof __DEV__ === "undefined" ? globalThis.__TEST__ === true : __DEV__;

// Dev-only client controls (joining a server by URL): on in a dev build and in the client
// @spup/game-client ships, off on the public site.
export const DEV_TOOLS = typeof __DEV_TOOLS__ === "undefined" ? DEV : __DEV_TOOLS__;

// True in the browser; false under Node tests/server.
export const BROWSER = typeof window !== "undefined";

// The package version the client was built from; "dev" outside a Vite build.
export const APP_VERSION = typeof __APP_VERSION__ === "undefined" ? "dev" : __APP_VERSION__;

// Git commit the client bundle was built from; "dev" outside a Vite build.
export const BUILD_COMMIT = typeof __BUILD_COMMIT__ === "undefined" ? "dev" : __BUILD_COMMIT__;

// BUILD_COMMIT's commit date (ISO); null outside a Vite build.
export const BUILD_DATE = typeof __BUILD_DATE__ === "undefined" ? null : __BUILD_DATE__;

// The sha-256 of every base mod bundle this client was built with, which is how it tells its own
// base mods from a server's third-party pins. Empty in a dev build and outside Vite, where the mod
// gate does not run.
export const BASE_MOD_HASHES = typeof __BASE_MOD_HASHES__ === "undefined" ? [] : __BASE_MOD_HASHES__;
