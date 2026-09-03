import {test} from "node:test";
import assert from "node:assert";
import {wireRegistryFor, assertRoundTrip} from "@/test/wireRoundTrip.js";
import {
    DeleteObjectMessage, CreateObjectMessage,
    ObjectInsertEvent, ObjectSyncEvent, ObjectDeleteEvent,
} from "@spup/sdk";
import {LogisticsDeclaration} from "../declaration.js";
import {
    BeltPathRecalculateEvent,
    BeltItemBatchEvent,
} from "./events.js";

test("Round-trips belt messages, including null and id fields", () => {
    const reg = wireRegistryFor(new LogisticsDeclaration());
    assertRoundTrip(reg, new DeleteObjectMessage(123456789012345), DeleteObjectMessage);
});

test("Round-trips belt events, preserving exact ids", () => {
    const reg = wireRegistryFor(new LogisticsDeclaration());
    assertRoundTrip(reg, new BeltPathRecalculateEvent(1, 2, [1, 2, 999999999999]), BeltPathRecalculateEvent);
});

test("Round-trips generic object events, preserving exact ids in the port-id array", () => {
    const reg = wireRegistryFor(new LogisticsDeclaration());
    assertRoundTrip(reg, new ObjectInsertEvent(1, 99, 5, 6, 1, [7, 999999999999], null), ObjectInsertEvent);
    assertRoundTrip(reg, new ObjectSyncEvent(2, 100, 5, 6, 2, [123456789012], 42), ObjectSyncEvent);
    assertRoundTrip(reg, new ObjectDeleteEvent(1, 99, 5, 6), ObjectDeleteEvent);
    assertRoundTrip(reg, new CreateObjectMessage(1, 5, 6, 1), CreateObjectMessage);
});

test("Decoded belt id is a Number, round-tripped exactly", () => {
    const reg = wireRegistryFor(new LogisticsDeclaration());
    const id = 123456789012345;
    const decoded = reg.decode(reg.encode(new DeleteObjectMessage(id)));
    assert.strictEqual(typeof decoded.id, "number");
    assert.strictEqual(decoded.id, id);
});

test("Round-trips a BeltItemBatchEvent's packed columns", () => {
    const reg = wireRegistryFor(new LogisticsDeclaration());
    const batch = new BeltItemBatchEvent(12, -5);
    batch.addDelete(999999999999, 41);
    batch.addUpsert(7, 42, 0, 3);
    batch.addUpsert(7, 43, 12, 3);
    assertRoundTrip(reg, batch, BeltItemBatchEvent);
});
