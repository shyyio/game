import {test} from "node:test";
import assert from "node:assert";

import {ModRegistry} from "@/common/ModRegistry.js";
import {WireRegistry} from "@/common/wire.js";
import {DeleteObjectMessage, CreateObjectMessage} from "@/common/CoreMessages.js";
import {EasyObjectInsertEvent, EasyObjectSyncEvent, EasyObjectDeleteEvent} from "@/common/EasyObjectEvents.js";
import {LogisticsMod} from "./mod.js";
import {CreateBeltMessage} from "./messages.js";
import {
    BeltInsertEvent,
    BeltSyncEvent,
    BeltDeleteEvent,
    BeltPathRecalculateEvent,
} from "./events.js";

function registry() {
    const modRegistry = new ModRegistry();
    modRegistry.loadMod(new LogisticsMod());
    return new WireRegistry(modRegistry);
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

test("Round-trips belt messages, including null and id fields", () => {
    const reg = registry();
    roundTrip(reg, new CreateBeltMessage(1, 2, 3, 0, undefined, 123456789012345), CreateBeltMessage);
    roundTrip(reg, new DeleteObjectMessage(123456789012345), DeleteObjectMessage);
});

test("Round-trips belt events, preserving exact ids", () => {
    const reg = registry();
    roundTrip(reg, new BeltInsertEvent(1, 2, 99, 3, 0), BeltInsertEvent);
    roundTrip(reg, new BeltSyncEvent(4, 5, 100, 1, 2), BeltSyncEvent);
    roundTrip(reg, new BeltDeleteEvent(1, 2, 99), BeltDeleteEvent);
    roundTrip(reg, new BeltPathRecalculateEvent(1, 2, [1, 2, 999999999999]), BeltPathRecalculateEvent);
});

test("Round-trips generic object events, preserving exact ids in the port-id array", () => {
    const reg = registry();
    roundTrip(reg, new EasyObjectInsertEvent(1, 99, 5, 6, 1, [7, 999999999999], null), EasyObjectInsertEvent);
    roundTrip(reg, new EasyObjectSyncEvent(2, 100, 5, 6, 2, [123456789012], 42), EasyObjectSyncEvent);
    roundTrip(reg, new EasyObjectDeleteEvent(1, 99, 5, 6), EasyObjectDeleteEvent);
    roundTrip(reg, new CreateObjectMessage(1, 5, 6, 1), CreateObjectMessage);
});

test("Decoded belt id is a Number, round-tripped exactly", () => {
    const reg = registry();
    const id = 123456789012345;
    const decoded = reg.decode(reg.encode(new DeleteObjectMessage(id)));
    assert.strictEqual(typeof decoded.id, "number");
    assert.strictEqual(decoded.id, id);
});
