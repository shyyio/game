import {test} from "node:test";
import assert from "node:assert";
import {wireRegistryFor, assertRoundTrip} from "@/test/wireRoundTrip.js";
import {
    DeleteObjectMessage, CreateObjectMessage,
    ObjectInsertEvent, ObjectSyncEvent, ObjectDeleteEvent,
} from "@spup/sdk";
import {LogisticsDeclaration} from "../declaration.js";
import {LogicSnapshotEvent} from "./events.js";

test("Round-trips core messages, including id fields", () => {
    const reg = wireRegistryFor(new LogisticsDeclaration());
    assertRoundTrip(reg, new DeleteObjectMessage(123456789012345), DeleteObjectMessage);
});

test("Round-trips generic object events, preserving exact ids in the port-id array", () => {
    const reg = wireRegistryFor(new LogisticsDeclaration());
    assertRoundTrip(reg, new ObjectInsertEvent(1, 99, 5, 6, 1, [7, 999999999999], null), ObjectInsertEvent);
    assertRoundTrip(reg, new ObjectSyncEvent(2, 100, 5, 6, 2, [123456789012], 42), ObjectSyncEvent);
    assertRoundTrip(reg, new ObjectDeleteEvent(1, 99, 5, 6), ObjectDeleteEvent);
    assertRoundTrip(reg, new CreateObjectMessage(1, 5, 6, 1), CreateObjectMessage);
});

test("Decoded object ref is a Number, round-tripped exactly", () => {
    const reg = wireRegistryFor(new LogisticsDeclaration());
    const objectRef = 123456789012345;
    const decoded = reg.decode(reg.encode(new DeleteObjectMessage(objectRef)));
    assert.strictEqual(typeof decoded.objectRef, "number");
    assert.strictEqual(decoded.objectRef, objectRef);
});

test("Round-trips a LogicSnapshotEvent's parallel columns", () => {
    const reg = wireRegistryFor(new LogisticsDeclaration());
    const snapshot = new LogicSnapshotEvent(
        999999999999, 1, 2, [7, 8], [3, 4], [10, -5], [0, 12],
        [7], [2], [1], [0], [1],
        [0], [8], [-1], [2], [0], [5],
    );
    assertRoundTrip(reg, snapshot, LogicSnapshotEvent);
});
