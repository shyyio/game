// The one resolver every bundle shares: `@spup/sdk` is the mod surface, `@/` the source root. The
// node services register the same two in src/nodeservice/hooks.js.

import {fileURLToPath} from "node:url";

export const ALIASES = [
    {find: /^@spup\/sdk$/, replacement: fileURLToPath(new URL("./src/sdk/common.js", import.meta.url))},
    {find: /^@spup\/sdk\/client$/, replacement: fileURLToPath(new URL("./src/sdk/client.js", import.meta.url))},
    {find: /^@\//, replacement: `${fileURLToPath(new URL("./src", import.meta.url))}/`},
];
