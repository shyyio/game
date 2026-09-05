import {test} from "node:test";
import assert from "node:assert";
import {wireRegistryFor, assertRoundTrip} from "@/test/wireRoundTrip.js";
import {ProductionLogDeclaration} from "../declaration.js";
import {
    ProductionLogRequestMessage,
    ItemLeaderboardRequestMessage,
} from "./messages.js";
import {
    ItemsDiscoveredEvent,
    ProductionLogEvent,
    ItemLeaderboardEvent,
} from "./events.js";

test("Round-trips the production log messages and events", () => {
    const reg = wireRegistryFor(new ProductionLogDeclaration());
    assertRoundTrip(reg, new ProductionLogRequestMessage(7), ProductionLogRequestMessage);
    assertRoundTrip(reg, new ItemLeaderboardRequestMessage(321, 40), ItemLeaderboardRequestMessage);
    assertRoundTrip(reg, new ItemsDiscoveredEvent([321, 322]), ItemsDiscoveredEvent);
    assertRoundTrip(reg, new ProductionLogEvent(7, [321, 322], [5, 1], [2, 1]), ProductionLogEvent);
    assertRoundTrip(reg, new ItemLeaderboardEvent(321, [2, 1], [7, 5], 2, 2), ItemLeaderboardEvent);
});

test("Request validation gates ids and offsets", () => {
    assert.strictEqual(new ProductionLogRequestMessage(7).validate(null, null), true);
    assert.strictEqual(new ProductionLogRequestMessage(7.5).validate(null, null), false);
    assert.strictEqual(new ItemLeaderboardRequestMessage(321, 0).validate(null, null), true);
    assert.strictEqual(new ItemLeaderboardRequestMessage(-1, 0).validate(null, null), false);
    assert.strictEqual(new ItemLeaderboardRequestMessage(321, -20).validate(null, null), false);
    assert.strictEqual(new ItemLeaderboardRequestMessage(321, 5).validate(null, null), false);
});
