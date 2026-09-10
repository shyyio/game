import {test} from "node:test";
import assert from "node:assert/strict";
import {GameEngine} from "@/sim/GameEngine.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {AbstractComponent} from "@/sim/AbstractComponent.js";
import {LaneItemComponent} from "@/sim/LaneItemComponent.js";
import {LaneComponent} from "@/sim/LaneComponent.js";
import {LaneCellComponent} from "@/sim/LaneCellComponent.js";
import {PortComponent} from "@/sim/PortComponent.js";
import {PositionComponent} from "@/sim/PositionComponent.js";
import {OccupancyComponent} from "@/sim/OccupancyComponent.js";
import {PlacedObjectComponent} from "@/sim/PlacedObjectComponent.js";
import {NO_EID} from "@/sim/sentinels.js";

class WidgetComponent extends AbstractComponent {

    constructor() {
        super("Widget", [
            {name: "parent", kind: "eid", defaultValue: NO_EID},
            {name: "weight", kind: "f32", defaultValue: 1},
            {name: "size"},
        ], {sparse: true});
    }
}

test("a sparse component registered on the engine creates rows it can look up", async () => {
    const engine = new GameEngine();
    await engine.init();
    const widgets = engine.components.register(new WidgetComponent());
    assert.equal(engine.components.get("Widget"), widgets);

    const eid = widgets.create();
    const row = widgets.row(eid);
    assert.equal(widgets.count, 1);
    assert.equal(widgets.eids[row], eid);
    assert.equal(widgets.store.parent[row], NO_EID);
    assert.equal(widgets.store.weight[row], 1);
    assert.equal(widgets.store.size[row], 0);

    widgets.destroy(eid);
    assert.equal(widgets.count, 0);
    assert.equal(widgets.row(eid), -1);
});

test("LaneItemComponent walks the file from its first item", async () => {
    const engine = new GameEngine();
    await engine.init();
    const items = engine.lanes.items;
    assert.ok(items instanceof LaneItemComponent);
    const firstEid = items.create(7);
    const secondEid = items.create(8);
    items.store.nextItem[items.row(firstEid)] = secondEid;
    assert.deepEqual(items.getFileByFirstItemEid(firstEid), [firstEid, secondEid]);
    assert.deepEqual(items.getFileByFirstItemEid(NO_EID), []);
});

test("LaneIndex holds its lane and cell components", async () => {
    const engine = new GameEngine();
    await engine.init();
    assert.ok(engine.lanes.lanes instanceof LaneComponent);
    assert.ok(engine.lanes.cells instanceof LaneCellComponent);
    assert.equal(engine.components.get("Lane"), engine.lanes.lanes);
    assert.equal(engine.components.get("LaneCell"), engine.lanes.cells);
});

test("the engine collaborators hold their components", async () => {
    const engine = await makeGameEngine();
    assert.ok(engine.ports.ports instanceof PortComponent);
    assert.ok(engine.space.positions instanceof PositionComponent);
    assert.ok(engine.space.occupancies instanceof OccupancyComponent);
    assert.ok(engine.placed.objects instanceof PlacedObjectComponent);
    assert.equal(engine.Port, engine.ports.ports.store);
    assert.equal(engine.Position, engine.space.positions.store);
});
