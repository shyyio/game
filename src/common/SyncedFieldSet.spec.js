import {test} from "node:test";
import assert from "node:assert/strict";
import {SyncedField, ProductField, SyncedFieldSet} from "@/common/SyncedFieldSet.js";

test("a product field carries its name and default", () => {
    const field = new ProductField("lastOutput", -1);
    assert.equal(field.name, "lastOutput");
    assert.equal(field.defaultValue, -1);
});

test("a set names the product field among its fields", () => {
    const product = new ProductField("lastOutput", -1);
    const set = new SyncedFieldSet("Gate", [new SyncedField("open", 1), product]);
    assert.equal(set.productField, product);
});

test("a set without one names no product field", () => {
    assert.equal(new SyncedFieldSet("Gate", [new SyncedField("open", 1)]).productField, null);
});

test("a second product field in one set throws", () => {
    assert.throws(
        () => new SyncedFieldSet("Gate", [new ProductField("lastOutput", -1), new ProductField("fluidType", -1)]),
        /one product field/,
    );
});
