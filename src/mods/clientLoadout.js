import {ModPackage} from "@/common/ModPackage.js";
import {BaseTexturesDeclaration} from "@/mods/BaseTextures/declaration.js";
import {BaseTexturesClientMod} from "@/mods/BaseTextures/client.js";
import {LogisticsDeclaration} from "@/mods/Logistics/declaration.js";
import {LogisticsClientMod} from "@/mods/Logistics/client.js";
import {LogisticsSimMod} from "@/mods/Logistics/sim.js";
import {BaseGameDeclaration} from "@/mods/BaseGame/declaration.js";
import {FluidsDeclaration} from "@/mods/Fluids/declaration.js";
import {FluidsClientMod} from "@/mods/Fluids/client.js";
import {CursorSyncDeclaration} from "@/mods/CursorSync/declaration.js";
import {CursorSyncClientMod} from "@/mods/CursorSync/client.js";
import {MarketDeclaration} from "@/mods/Market/declaration.js";
import {MarketClientMod} from "@/mods/Market/client.js";
import {MarketSimMod} from "@/mods/Market/sim.js";
import {NotesDeclaration} from "@/mods/Notes/declaration.js";
import {NotesClientMod} from "@/mods/Notes/client.js";
import {NotesSimMod} from "@/mods/Notes/sim.js";

/**
 * The loadout for a browser client (which also runs the local sim): declarations + client parts,
 * registered in the same order as loadout.js's simLoadout so positional ids match. Market also
 * needs its sim part here (unlike CursorSync's, which only relays to OTHER sessions and is a
 * no-op solo) — local mode hosts an in-process Game off this same registry.
 * @returns {ModPackage[]}
 */
export function clientLoadout() {
    return [
        new ModPackage(new BaseTexturesDeclaration(), {client: new BaseTexturesClientMod()}),
        new ModPackage(new LogisticsDeclaration(), {sim: new LogisticsSimMod(), client: new LogisticsClientMod()}),
        new ModPackage(new BaseGameDeclaration()),
        new ModPackage(new FluidsDeclaration(), {client: new FluidsClientMod()}),
        new ModPackage(new CursorSyncDeclaration(), {client: new CursorSyncClientMod()}),
        new ModPackage(new MarketDeclaration(), {sim: new MarketSimMod(), client: new MarketClientMod()}),
        new ModPackage(new NotesDeclaration(), {sim: new NotesSimMod(), client: new NotesClientMod()}),
    ];
}
