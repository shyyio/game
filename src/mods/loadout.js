import {ModPackage} from "@/common/ModPackage.js";
import {BaseTexturesDeclaration} from "@/mods/BaseTextures/declaration.js";
import {LogisticsDeclaration} from "@/mods/Logistics/declaration.js";
import {LogisticsClientMod} from "@/mods/Logistics/client.js";
import {DemoDeclaration} from "@/mods/Demo/declaration.js";
import {ResourcesDeclaration} from "@/mods/Resources/declaration.js";

// The canonical mod loadout. Both build sites register the same declarations in the same order, so
// the positional typeIds/wireIds assigned at freeze() match between sim and client.

/**
 * The loadout for a headless simulation (server, tests): declarations + sim parts only.
 * @returns {ModPackage[]}
 */
export function simLoadout() {
    return [
        new ModPackage(new BaseTexturesDeclaration()),
        new ModPackage(new LogisticsDeclaration()),
        new ModPackage(new DemoDeclaration()),
        new ModPackage(new ResourcesDeclaration()),
    ];
}

/**
 * The loadout for a browser client (which also runs the local sim): all three parts.
 * @returns {ModPackage[]}
 */
export function clientLoadout() {
    return [
        new ModPackage(new BaseTexturesDeclaration()),
        new ModPackage(new LogisticsDeclaration(), {client: new LogisticsClientMod()}),
        new ModPackage(new DemoDeclaration()),
        new ModPackage(new ResourcesDeclaration()),
    ];
}
