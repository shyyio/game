import {test} from "node:test";
import assert from "node:assert/strict";
import {NodeAccountStore} from "@/authserver/NodeAccountStore.js";
import {AccountRegistry} from "@/authserver/AccountRegistry.js";

test("getOrCreate is idempotent and allocates stable ids from 1", () => {
    const accounts = new AccountRegistry(new NodeAccountStore());
    const alice = accounts.getOrCreate("alice");
    const bob = accounts.getOrCreate("bob");
    assert.equal(alice.accountId, 1);
    assert.equal(bob.accountId, 2);
    assert.deepEqual(accounts.getOrCreate("alice"), alice);
});

test("invalid usernames are rejected", () => {
    const accounts = new AccountRegistry(new NodeAccountStore());
    assert.throws(() => accounts.getOrCreate(" alice"), RangeError, "leading space");
    assert.throws(() => accounts.getOrCreate("ab"), RangeError, "too short");
});

test("unknown ids break loudly", () => {
    const accounts = new AccountRegistry(new NodeAccountStore());
    assert.throws(() => accounts.byId(7), RangeError);
});

test("accounts persist across registries sharing a store", () => {
    const store = new NodeAccountStore();
    const alice = new AccountRegistry(store).getOrCreate("alice");
    const reopened = new AccountRegistry(store);
    assert.equal(reopened.byId(alice.accountId).username, "alice");
    assert.deepEqual(reopened.getOrCreate("alice"), alice);
});
