import {test} from "node:test";
import assert from "node:assert";

import {ModSet} from "@/common/ModSet.js";
import {WireRegistry} from "@/common/wire.js";
import {BeltMod} from "@/mods/Belt/mod.js";
import {CreateBeltMessage, DeleteBeltMessage} from "@/mods/Belt/messages.js";
import {
    BeltInsertEvent,
    BeltUpdateEvent,
    BeltDeleteEvent,
    BeltPathRecalculateEvent,
} from "@/mods/Belt/mod.js";

function registry() {
    const modSet = new ModSet();
    modSet.loadMod(new BeltMod());
    return new WireRegistry(modSet);
}

/**
 * Reduces an object to its declared wire fields, mapping undefined → null so
 * absent-on-the-wire fields compare equal to the source.
 */
function pick(obj, cls) {
    const out = {};
    Object.keys(cls.wireFields).forEach(key => {
        out[key] = obj[key] === undefined ? null : obj[key];
    });
    return out;
}

function roundTrip(reg, instance, cls) {
    const decoded = reg.decode(reg.encode(instance));
    assert.ok(decoded instanceof cls, `decoded value is not a ${cls.name}`);
    assert.deepStrictEqual(pick(decoded, cls), pick(instance, cls));
}

test("round-trips belt messages, including null and BigInt fields", () => {
    const reg = registry();
    roundTrip(reg, new CreateBeltMessage({
        x: 1, y: 2, direction: 3, beltType: 0,
        rampParent: undefined, disconnectRampChild: 123456789012345n,
    }), CreateBeltMessage);
    roundTrip(reg, new DeleteBeltMessage(123456789012345n), DeleteBeltMessage);
});

test("round-trips belt events, preserving exact BigInt ids", () => {
    const reg = registry();
    roundTrip(reg, new BeltInsertEvent(1, 2, 99n, 3, 0, null, null), BeltInsertEvent);
    roundTrip(reg, new BeltInsertEvent(4, 5, 100n, 1, 2, 4, 5), BeltInsertEvent);
    roundTrip(reg, new BeltUpdateEvent(1, 2, 99n, 4, 5), BeltUpdateEvent);
    roundTrip(reg, new BeltUpdateEvent(1, 2, 99n, null, null), BeltUpdateEvent);
    roundTrip(reg, new BeltDeleteEvent(1, 2, 99n), BeltDeleteEvent);
    roundTrip(reg, new BeltPathRecalculateEvent(1, 2, [1n, 2n, 9999999999999999n]), BeltPathRecalculateEvent);
});

test("decoded belt id is an exact, lossless BigInt", () => {
    const reg = registry();
    const id = 9007199254740993n; // 2^53 + 1, beyond Number precision
    const decoded = reg.decode(reg.encode(new DeleteBeltMessage(id)));
    assert.strictEqual(typeof decoded.id, "bigint");
    assert.strictEqual(decoded.id, id);
});
