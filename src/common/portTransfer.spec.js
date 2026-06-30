
import {test} from "node:test";
import assert from "node:assert/strict";
import {setup} from "@/test/common.js";

// Builds `count` fresh ports and fills the given ids with an item.
function makePorts(game, count, filledIds) {
    for (let i = 0; i < count; i += 1) {
        game.db.db.prepare("INSERT INTO Port DEFAULT VALUES").run();
    }
    filledIds.forEach(id => game.rawExec(`UPDATE Port SET item=1 WHERE id=${id}`));
}

function intent(game, source, destination, destinationEmpty) {
    game.rawExec(
        `INSERT INTO PortTransferIntent (source_id, destination_id, destination_is_empty)
         VALUES (${source}, ${destination}, ${destinationEmpty ? 1 : 0})`
    );
}

function resolved(game) {
    return game.db.db.prepare("SELECT source_id, destination_id FROM ResolvedPortTransfer ORDER BY source_id")
        .all()
        .map(r => `${r.source_id}->${r.destination_id}`)
        .join(", ");
}

test("Resolves a packed transfer chain as a single shift when the end drains", async () => {
    const game = await setup();
    // Chain 1->2->3->4, items at 1,2,3 and port 4 empty (drained).
    makePorts(game, 4, [1, 2, 3]);
    intent(game, 1, 2, false);
    intent(game, 2, 3, false);
    intent(game, 3, 4, true);

    game.exec("ResolvePortTransfer");

    // The whole chain shifts in one tick, not just the hop into the empty port.
    assert.equal(resolved(game), "1->2, 2->3, 3->4");
});

test("Resolves no transfer when the chain's end is blocked", async () => {
    const game = await setup();
    // Same chain but port 4 also holds an item — nothing can move.
    makePorts(game, 4, [1, 2, 3, 4]);
    intent(game, 1, 2, false);
    intent(game, 2, 3, false);
    intent(game, 3, 4, false);

    game.exec("ResolvePortTransfer");

    assert.equal(resolved(game), "");
});

// Runs the resolve + commit ops so the move (or sink) lands in Port.
function settle(game) {
    game.exec("ResolvePortTransfer");
    game.exec("CaptureResolvedSinks");
    game.exec("FlushResolvedPortTransferSource");
    game.exec("FlushResolvedPortTransferDestination");
    game.exec("FlushResolvedSink");
}

function portItem(game, id) {
    return game.rawScalar(`SELECT item FROM Port WHERE id=${id}`);
}

test("Translates the item type on a managed transfer via output_item", async () => {
    const game = await setup();
    makePorts(game, 2, [1]);
    game.rawExec(
        `INSERT INTO PortTransferIntent (source_id, destination_id, destination_is_empty, output_item, managed)
         VALUES (1, 2, 1, 99, 1)`
    );

    settle(game);

    assert.equal(portItem(game, 1), null);
    assert.equal(portItem(game, 2), 99);
});

test("Creates a brand-new item with a source-less managed intent", async () => {
    const game = await setup();
    makePorts(game, 1, []);
    game.rawExec(
        `INSERT INTO PortTransferIntent (source_id, destination_id, destination_is_empty, output_item, managed)
         VALUES (NULL, 1, 1, 55, 1)`
    );

    settle(game);

    assert.equal(portItem(game, 1), 55);
});

test("Sinks (consumes) the source item on a managed destination-less intent", async () => {
    const game = await setup();
    makePorts(game, 1, [1]);
    game.rawExec(
        `INSERT INTO PortTransferIntent (source_id, destination_id, managed) VALUES (1, NULL, 1)`
    );

    settle(game);

    assert.equal(portItem(game, 1), null);
});

test("Leaves an unmanaged destination-less intent (self-drain) untouched", async () => {
    const game = await setup();
    makePorts(game, 1, [1]);
    game.rawExec(
        `INSERT INTO PortTransferIntent (source_id, destination_id, managed) VALUES (1, NULL, 0)`
    );

    settle(game);

    // managed=0 means the owner does the move; the engine must not clear it.
    assert.equal(portItem(game, 1), 1);
});
