import {test} from "node:test";
import assert from "node:assert/strict";
import {GameEngine} from "@/sim/GameEngine.js";
import {AbstractComponent} from "@/sim/AbstractComponent.js";
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
