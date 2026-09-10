import {test} from "node:test";
import assert from "node:assert/strict";
import {GameEngine} from "@/sim/GameEngine.js";
import {AbstractComponent, FieldDefinition, NO_EID} from "@/sim/AbstractComponent.js";
import {LaneItemComponent} from "@/sim/LaneItemComponent.js";

class WidgetComponent extends AbstractComponent {

    constructor() {
        super("Widget", [
            new FieldDefinition("parent", "eid", NO_EID),
            new FieldDefinition("weight", "f32", 1),
            new FieldDefinition("size"),
        ], {sparse: true});
    }
}

test("a sparse component registered on the engine creates rows it can look up", async () => {
    const engine = new GameEngine();
    await engine.init();
    const widgets = engine.components.register(new WidgetComponent());
    assert.equal(engine.components.getComponentByName("Widget"), widgets);

    const eid = widgets.create();
    const row = widgets.getRowByEid(eid);
    assert.equal(widgets.count, 1);
    assert.equal(widgets.eids[row], eid);
    assert.equal(widgets.store.parent[row], NO_EID);
    assert.equal(widgets.store.weight[row], 1);
    assert.equal(widgets.store.size[row], 0);

    widgets.destroy(eid);
    assert.equal(widgets.count, 0);
    assert.equal(widgets.getRowByEid(eid), -1);
});

test("LaneItemComponent walks the file from its first item", async () => {
    const engine = new GameEngine();
    await engine.init();
    const items = engine.lanes.items;
    assert.ok(items instanceof LaneItemComponent);
    const firstEid = items.create(7);
    const secondEid = items.create(8);
    items.store.nextItem[items.getRowByEid(firstEid)] = secondEid;
    assert.deepEqual(items.getFileByFirstItemEid(firstEid), [firstEid, secondEid]);
    assert.deepEqual(items.getFileByFirstItemEid(NO_EID), []);
});
