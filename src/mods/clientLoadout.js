import {ModPackage} from "@/common/ModPackage.js";
import {BaseTexturesDeclaration} from "@/mods/BaseTextures/declaration.js";
import {LogisticsDeclaration} from "@/mods/Logistics/declaration.js";
import {LogisticsClientMod} from "@/mods/Logistics/client.js";
import {DemoDeclaration} from "@/mods/Demo/declaration.js";
import {ResourcesDeclaration} from "@/mods/Resources/declaration.js";
import {FluidsDeclaration} from "@/mods/Fluids/declaration.js";
import {FluidsClientMod} from "@/mods/Fluids/client.js";

/**
 * The loadout for a browser client (which also runs the local sim): declarations + client parts,
 * registered in the same order as loadout.js's simLoadout so positional ids match.
 * @returns {ModPackage[]}
 */
export function clientLoadout() {
    return [
        new ModPackage(new BaseTexturesDeclaration()),
        new ModPackage(new LogisticsDeclaration(), {client: new LogisticsClientMod()}),
        new ModPackage(new DemoDeclaration()),
        new ModPackage(new ResourcesDeclaration()),
        new ModPackage(new FluidsDeclaration(), {client: new FluidsClientMod()}),
    ];
}
