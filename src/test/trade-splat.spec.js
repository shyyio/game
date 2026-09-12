import {test} from "node:test";
import assert from "node:assert/strict";
import {ObjectsView} from "@/client/state/ObjectsState.js";
import {MarketClientMod} from "@/mods/market/client.js";
import {TradeSettledEvent} from "@/mods/market/common/events.js";

const TERMINAL_REF = 77;
const TILE_X = 12;
const TILE_Y = -5;

/**
 * A client stub carrying the two surfaces the mod's event handler reaches: the objects view the
 * terminal is looked up in, and a hitsplat layer that records what it was asked to draw.
 */
function clientWith(objects, splats) {
    return {
        objects,
        hitsplatLayer: {drawHitsplat: splat => splats.push(splat)},
    };
}

function objectsWithTerminal() {
    const objects = new ObjectsView(null);
    objects.set(TERMINAL_REF, TILE_X, TILE_Y, [{x: TILE_X, y: TILE_Y, layer: "surface"}]);
    return objects;
}

/**
 * The mod, wired to the given objects view, after one settled trade of `amount` credits.
 * @returns {Object[]} the splats it asked for
 */
function splatsForTrade(objects, amount) {
    const splats = [];
    const mod = new MarketClientMod();
    mod.onEvent(new TradeSettledEvent(TILE_X, TILE_Y, TERMINAL_REF, amount), clientWith(objects, splats));
    return splats;
}

test("a debit draws a red splat over the terminal's tile", () => {
    const splats = splatsForTrade(objectsWithTerminal(), -100);

    assert.equal(splats.length, 1);
    assert.equal(splats[0].text, "-100");
    assert.equal(splats[0].tileX, TILE_X);
    assert.equal(splats[0].tileY, TILE_Y);
});

test("a credit draws its own splat", () => {
    const splats = splatsForTrade(objectsWithTerminal(), 250);

    assert.equal(splats.length, 1);
    assert.equal(splats[0].text, "+250");
});

test("a trade on an object the client has not been told about draws nothing", () => {
    assert.equal(splatsForTrade(new ObjectsView(null), -100).length, 0);
});
