// The one resolver every bundle shares: `@spup/sdk` is the mod surface, `@/` the source root. The
// node services register the same two in src/nodeservice/hooks.js.

import {fileURLToPath} from "node:url";

export const ALIASES = [
    // A bundle has no directory to read at runtime, so every vite build globs the mods instead.
    {find: /^@\/mods\/modDirs\.js$/, replacement: fileURLToPath(new URL("./src/mods/modDirs.vite.js", import.meta.url))},
    {find: /^@\/mods\/modSources\.js$/, replacement: fileURLToPath(new URL("./src/mods/modSources.vite.js", import.meta.url))},
    {find: /^@spup\/sdk$/, replacement: fileURLToPath(new URL("./src/sdk/common.js", import.meta.url))},
    {find: /^@spup\/sdk\/client$/, replacement: fileURLToPath(new URL("./src/sdk/client.js", import.meta.url))},
    {find: /^@\//, replacement: `${fileURLToPath(new URL("./src", import.meta.url))}/`},
];
