
// Project-wide build/environment flags. Importable from anywhere, including mods/.
//
// `__DEV__` is injected as a literal by Vite's `define` (true under `vite dev`,
// false in a production build), so DEV folds to a constant and any `if (DEV)` /
// `DEV ? …` branch is dead-code-eliminated from production builds. Under Node
// (tests) `__DEV__` is undeclared; `typeof` on an undeclared identifier is safe
// and yields "undefined", so DEV defaults to true — test code always runs the
// dev-only paths.
export const DEV = typeof __DEV__ === "undefined" ? true : __DEV__;
