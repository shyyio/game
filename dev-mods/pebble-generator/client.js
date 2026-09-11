import {AbstractClientMod, CounterEntry} from "@spup/sdk/client";
import {pebbleGeneratorTextureAtlases} from "./assets.js";
import {GeneratorCountRequestMessage} from "./common/messages.js";
import {GeneratorCountEvent} from "./common/events.js";
import {drawPebbleIcon, PEBBLE_COLOR} from "./client/icons.js";

// This mod's row in the core counter list.
const GENERATOR_COUNTER = "pebbleGenerators";
const GENERATOR_ENTRY = new CounterEntry(drawPebbleIcon, PEBBLE_COLOR, "Pebble Generators");

/**
 * The half of the mod that runs in the browser. The machine already gets its sprite, toolbar button
 * and placement ghost from its ObjectType, so this part only ships the art and shows what the
 * server reports.
 */
export class PebbleGeneratorClientMod extends AbstractClientMod {

    /**
     * @returns {TextureAtlas[]}
     */
    textureAtlases() {
        return pebbleGeneratorTextureAtlases;
    }

    /**
     * One request is enough: the server tells this session again whenever the count changes.
     * @param {Client} client
     * @returns {void}
     */
    onReady(client) {
        client.sendMessage(new GeneratorCountRequestMessage());
    }

    /**
     * Every event the server sends comes through here, this mod's own and the game's alike.
     * @param {AbstractEvent} event
     * @param {Client} client
     * @returns {void}
     */
    onEvent(event, client) {
        if (event instanceof GeneratorCountEvent) {
            client.hud.counterListLayer.setCounter(GENERATOR_COUNTER, GENERATOR_ENTRY, event.count);
        }
    }
}
