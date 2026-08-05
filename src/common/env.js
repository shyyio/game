
// In the browser/Vite build __DEV__ is injected as a literal. In Node it is absent, so DEV
// follows the test flag set by the test loader: on under tests, off for the server/prod.
export const DEV = typeof __DEV__ === "undefined" ? globalThis.__TEST__ === true : __DEV__;

// True in the browser; false under Node tests/server.
export const BROWSER = typeof window !== "undefined";

// Git commit the client bundle was built from; "dev" outside a Vite build.
export const BUILD_COMMIT = typeof __BUILD_COMMIT__ === "undefined" ? "dev" : __BUILD_COMMIT__;

// BUILD_COMMIT's commit date (ISO); null outside a Vite build.
export const BUILD_DATE = typeof __BUILD_DATE__ === "undefined" ? null : __BUILD_DATE__;
