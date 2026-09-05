import test from "node:test";
import assert from "node:assert/strict";
import {AbstractModDeclaration} from "@/common/AbstractModDeclaration.js";
import {AbstractSimMod} from "@/sim/AbstractSimMod.js";
import {simPackagesFrom, onlyClass} from "@/mods/modPackages.js";

class WidgetsDeclaration extends AbstractModDeclaration {

    get name() {
        return "Widgets";
    }
}

class WidgetsSimMod extends AbstractSimMod {

}

test("simPackagesFrom builds one package per source, in source order", () => {
    const packages = simPackagesFrom([
        {dir: "widgets", declaration: {WidgetsDeclaration}, sim: {WidgetsSimMod}},
        {dir: "gadgets", declaration: {WidgetsDeclaration}, sim: null},
    ]);

    assert.equal(packages.length, 2);
    assert.ok(packages[0].declaration instanceof WidgetsDeclaration);
    assert.ok(packages[0].sim instanceof WidgetsSimMod);
    assert.equal(packages[1].sim, null);
});

test("a part module that does not export exactly one class names the mod it came from", () => {
    assert.throws(
        () => onlyClass({WidgetsDeclaration, WidgetsSimMod}, "widgets", "declaration.js"),
        /widgets\/declaration.js must export exactly one class, found 2/,
    );
    assert.throws(
        () => onlyClass({}, "widgets", "sim.js"),
        /widgets\/sim.js must export exactly one class, found 0/,
    );
});
