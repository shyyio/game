import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ServerDirectory} from "@/authserver/ServerDirectory.js";

const ENTRY_A = {origin: "wss://a.example.com:443"};
const ENTRY_B = {origin: "wss://b.example.com:443"};

/**
 * @returns {string}
 */
function freshPath() {
    return join(mkdtempSync(join(tmpdir(), "authserver-directory-")), "servers.json");
}

test("a missing file lists nothing", () => {
    assert.deepEqual(new ServerDirectory(freshPath()).findQuotesByItemTypeId(), []);
});

test("edits to the file are picked up without a restart", () => {
    const path = freshPath();
    writeFileSync(path, JSON.stringify([ENTRY_A]));
    const directory = new ServerDirectory(path);
    assert.deepEqual(directory.findQuotesByItemTypeId(), [ENTRY_A]);
    writeFileSync(path, JSON.stringify([ENTRY_B]));
    assert.deepEqual(directory.findQuotesByItemTypeId(), [ENTRY_B]);
});

test("a malformed file keeps serving the last good list", () => {
    const path = freshPath();
    writeFileSync(path, JSON.stringify([ENTRY_A]));
    const directory = new ServerDirectory(path);
    directory.findQuotesByItemTypeId();
    writeFileSync(path, "{ not json");
    assert.deepEqual(directory.findQuotesByItemTypeId(), [ENTRY_A]);
});

test("a malformed file with no last good list lists nothing", () => {
    const path = freshPath();
    writeFileSync(path, "{ not json");
    assert.deepEqual(new ServerDirectory(path).findQuotesByItemTypeId(), []);
});

test("a file holding something other than an array lists nothing", () => {
    const path = freshPath();
    writeFileSync(path, JSON.stringify(ENTRY_A));
    assert.deepEqual(new ServerDirectory(path).findQuotesByItemTypeId(), []);
});
