import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {NodeAccountStore} from "@/authserver/NodeAccountStore.js";

test("a file-backed store runs in WAL mode with a busy timeout", () => {
    const store = new NodeAccountStore(join(mkdtempSync(join(tmpdir(), "authserver-store-")), "auth.sqlite3"));

    assert.equal(store.db.pragma("journal_mode", {simple: true}), "wal");
    assert.ok(store.db.pragma("busy_timeout", {simple: true}) > 0);
});
