import {test} from "node:test";
import assert from "node:assert/strict";
import {ToolPreviewCache, SelectionPreviewEntry} from "@/client/state/ToolPreviewCache.js";
import {Blueprint} from "@/common/Blueprint.js";

test("a selection change notifies once per change", () => {
    const preview = new ToolPreviewCache();
    const seen = [];
    preview.onSelectionChange(selection => seen.push(selection));
    const selection = new SelectionPreviewEntry(1.5, -2.25, 40);
    preview.setSelection(selection);
    preview.setSelection(selection);
    preview.setSelection(null);
    assert.deepEqual(seen, [selection, null]);
    assert.equal(preview.selection, null);
});

test("a paste change notifies once per change", () => {
    const preview = new ToolPreviewCache();
    const seen = [];
    preview.onPasteChange(blueprint => seen.push(blueprint));
    const blueprint = new Blueprint([]);
    preview.setPaste(blueprint);
    preview.setPaste(blueprint);
    assert.deepEqual(seen, [blueprint]);
    assert.equal(preview.paste, blueprint);
});
