import {ModPackage} from "@/common/ModPackage.js";
import {BaseTexturesDeclaration} from "@/mods/BaseTextures/declaration.js";
import {LogisticsDeclaration} from "@/mods/Logistics/declaration.js";
import {DemoDeclaration} from "@/mods/Demo/declaration.js";
import {ResourcesDeclaration} from "@/mods/Resources/declaration.js";
import {FluidsDeclaration} from "@/mods/Fluids/declaration.js";
import {CursorSyncDeclaration} from "@/mods/CursorSync/declaration.js";
import {CursorSyncSimMod} from "@/mods/CursorSync/sim.js";

// The canonical mod loadout. Both build sites register the same declarations in the same order, so
// the positional typeIds/wireIds assigned at freeze() match between sim and client. The client
// loadout lives in clientLoadout.js — importing the client mods here would drag pixi into the
// server bundle.

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
        new ModPackage(new FluidsDeclaration()),
        new ModPackage(new CursorSyncDeclaration(), {sim: new CursorSyncSimMod()}),
    ];
}
