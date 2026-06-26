
// In the browser/Vite build __DEV__ is injected as a literal. In Node it is absent, so DEV
// follows the test flag set by the test loader: on under tests, off for the server/prod.
export const DEV = typeof __DEV__ === "undefined" ? globalThis.__TEST__ === true : __DEV__;
