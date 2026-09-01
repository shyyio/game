import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {ModPackage} from "@/common/ModPackage.js";
import {AbstractModDeclaration} from "@/common/AbstractModDeclaration.js";
import {AbstractBehavior} from "@/common/behaviors/AbstractBehavior.js";
import {ObjectType, PlacementRule} from "@/common/ObjectType.js";

class RecordingBehavior extends AbstractBehavior {

    constructor() {
        super();
        this.calls = [];
    }

    install(...args) {
        this.calls.push({hook: "install", args});
    }

    onSpawn(...args) {
        this.calls.push({hook: "onSpawn", args});
    }

    onDespawn(...args) {
        this.calls.push({hook: "onDespawn", args});
    }

    argsOf(hook) {
        for (const call of this.calls) {
            if (call.hook === hook) {
                return call.args;
            }
        }
        throw new Error(`${hook} was never called`);
    }
}

const RecordingType = new ObjectType({
    name: "RecordingHookObject",
    geometry: "1x1",
    textureName: "demo-machine/0",
    label: "RecordingHookObject",
    placement: new PlacementRule({replaceSameKind: true}),
    behavior: new RecordingBehavior(),
});

class RecordingDeclaration extends AbstractModDeclaration {

    get name() {
        return "RecordingHookFixture";
    }

    get objectTypes() {
        return [RecordingType];
    }
}

test("a behavior hook takes the engine and the entity, with PlacedObjects reached through the engine", async () => {
    const behavior = RecordingType.behavior;
    behavior.calls = [];
    const engine = await makeGameEngine([new ModPackage(new RecordingDeclaration())]);

    const installArgs = behavior.argsOf("install");
    assert.equal(installArgs.length, 1);
    assert.equal(installArgs[0], engine);
    assert.equal(engine.placed !== null, true, "engine.placed is reachable while a behavior installs");

    engine.applyMessage(new CreateObjectMessage(RecordingType.typeId, 5, 5, Direction.UP));
    const [eid] = engine.placed.eidsOf(RecordingType.typeId);
    const spawnArgs = behavior.argsOf("onSpawn");
    assert.equal(spawnArgs.length, 4);
    assert.equal(spawnArgs[0], engine);
    assert.equal(spawnArgs[1], eid);
    assert.equal(spawnArgs[2], RecordingType);

    engine.applyMessage(new DeleteObjectMessage(engine.placed.objectIdOf(eid)));
    const despawnArgs = behavior.argsOf("onDespawn");
    assert.equal(despawnArgs.length, 2);
    assert.equal(despawnArgs[0], engine);
    assert.equal(despawnArgs[1], eid);
});

test("every AbstractBehavior hook drops the PlacedObjects parameter", () => {
    const arities = {
        install: 1,
        canSpawn: 3,
        onSpawn: 4,
        onDespawn: 2,
        syncData: 2,
        inspect: 3,
        resyncRenderedPorts: 2,
        setWorkers: 3,
        onRebuild: 1,
        logicRead: 3,
        logicWrite: 4,
        logicStored: 2,
    };
    for (const [hook, arity] of Object.entries(arities)) {
        assert.equal(AbstractBehavior.prototype[hook].length, arity, `${hook} takes ${arity} parameters`);
    }
});
