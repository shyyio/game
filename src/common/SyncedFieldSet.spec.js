import {test} from "node:test";
import assert from "node:assert/strict";
import {SyncedField, SyncedFieldSet, FIELD_ROLE_PRODUCT, FIELD_ROLE_STALL} from "@/common/SyncedFieldSet.js";

test("a field carries its name, default and role", () => {
    const field = new SyncedField("lastOutput", -1, FIELD_ROLE_PRODUCT);
    assert.equal(field.name, "lastOutput");
    assert.equal(field.defaultValue, -1);
    assert.equal(field.role, FIELD_ROLE_PRODUCT);
});

test("a field declares no role by default", () => {
    assert.equal(new SyncedField("open", 1).role, null);
});

test("a set names each role's field among its fields", () => {
    const product = new SyncedField("lastOutput", -1, FIELD_ROLE_PRODUCT);
    const stall = new SyncedField("isStalled", 0, FIELD_ROLE_STALL);
    const set = new SyncedFieldSet("Extractor", [product, stall]);
    assert.equal(set.getFieldByRoleOrNull(FIELD_ROLE_PRODUCT), product);
    assert.equal(set.getFieldByRoleOrNull(FIELD_ROLE_STALL), stall);
});

test("a set without a role's field names none", () => {
    const set = new SyncedFieldSet("Gate", [new SyncedField("open", 1)]);
    assert.equal(set.getFieldByRoleOrNull(FIELD_ROLE_PRODUCT), null);
    assert.equal(set.getFieldByRoleOrNull(FIELD_ROLE_STALL), null);
});

test("a second field of one role throws", () => {
    assert.throws(
        () => new SyncedFieldSet("Gate", [
            new SyncedField("lastOutput", -1, FIELD_ROLE_PRODUCT),
            new SyncedField("fluidType", -1, FIELD_ROLE_PRODUCT),
        ]),
        /two product fields/,
    );
});
