// Loads the mod packages named by `?mod=<url>` (comma-separated) into local play. The parameter is
// an override: when it is present it replaces the stored local loadout for that page load, so a dev
// link always runs exactly what it names. Remote mode ignores it entirely — a server's loadout is
// exactly what that server pins, or the positional wire ids desynchronise.
//
// A side-loaded bundle is code from a URL, evaluated with this page's origin and everything in it —
// the signed-in session token included — so only a build with the dev tools on honours the
// parameter. The public site ignores it: a link is not consent to run a stranger's code.

import {DEV_TOOLS} from "@/common/env.js";

// Side-loads packages: ?mod=http://localhost:5050/mod/
export const MOD_PARAM = "mod";

/**
 * The package base URLs the current location asks for, empty in a build without the dev tools.
 * @returns {string[]}
 */
export function sideloadedModUrls() {
    if (!DEV_TOOLS) {
        return [];
    }
    const value = new URLSearchParams(window.location.search).get(MOD_PARAM);
    if (value === null) {
        return [];
    }
    return value.split(",").filter(url => url.length > 0);
}
