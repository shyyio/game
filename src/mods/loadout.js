import {ModPackage} from "@/common/ModPackage.js";
import {BASE_MOD_DIRS} from "@/mods/baseMods.js";
import {BaseTexturesDeclaration} from "@/mods/BaseTextures/declaration.js";
import {LogisticsDeclaration} from "@/mods/Logistics/declaration.js";
import {LogisticsSimMod} from "@/mods/Logistics/sim.js";
import {BaseGameDeclaration} from "@/mods/BaseGame/declaration.js";
import {FluidsDeclaration} from "@/mods/Fluids/declaration.js";
import {CursorSyncDeclaration} from "@/mods/CursorSync/declaration.js";
import {CursorSyncSimMod} from "@/mods/CursorSync/sim.js";
import {MarketDeclaration} from "@/mods/Market/declaration.js";
import {MarketSimMod} from "@/mods/Market/sim.js";
import {NotesDeclaration} from "@/mods/Notes/declaration.js";
import {NotesSimMod} from "@/mods/Notes/sim.js";
import {ProductionLogDeclaration} from "@/mods/ProductionLog/declaration.js";
import {ProductionLogSimMod} from "@/mods/ProductionLog/sim.js";

export {BASE_MOD_DIRS};

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
        new ModPackage(new LogisticsDeclaration(), {sim: new LogisticsSimMod()}),
        new ModPackage(new BaseGameDeclaration()),
        new ModPackage(new FluidsDeclaration()),
        new ModPackage(new CursorSyncDeclaration(), {sim: new CursorSyncSimMod()}),
        new ModPackage(new MarketDeclaration(), {sim: new MarketSimMod()}),
        new ModPackage(new NotesDeclaration(), {sim: new NotesSimMod()}),
        new ModPackage(new ProductionLogDeclaration(), {sim: new ProductionLogSimMod()}),
    ];
}
