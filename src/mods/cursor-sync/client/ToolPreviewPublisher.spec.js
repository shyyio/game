import {test} from "node:test";
import assert from "node:assert/strict";
import {Blueprint, BlueprintEntry, Direction, ModRegistry, ToolPreviewCache, SelectionPreviewEntry} from "@spup/sdk/client";
import {ToolPreviewPublisher} from "./ToolPreviewPublisher.js";
import {
    CursorSelectionStartMessage, CursorSelectionEndMessage, CursorPasteMessage, CursorPasteClearMessage,
} from "../common/messages.js";
import {PASTE_FIXTURE_PACKAGE, PasteSquareType} from "../pasteFixture.js";

function publisher() {
    const sent = [];
    const modRegistry = new ModRegistry();
    modRegistry.register(PASTE_FIXTURE_PACKAGE);
    modRegistry.freeze();
    const toolPreview = new ToolPreviewCache();
    new ToolPreviewPublisher({sendMessage: message => sent.push(message)}, toolPreview, modRegistry);
    return {sent, toolPreview};
}

test("an opened and closed selection sends its start and end", () => {
    const {sent, toolPreview} = publisher();
    toolPreview.setSelection(new SelectionPreviewEntry(2.5, -1.5, 40));
    toolPreview.setSelection(null);
    assert.deepEqual(sent.map(message => message.constructor), [CursorSelectionStartMessage, CursorSelectionEndMessage]);
    assert.equal(sent[0].x, 2.5);
    assert.equal(sent[0].toolId, 40);
});

test("a held and dropped blueprint sends its mask and a clear", () => {
    const {sent, toolPreview} = publisher();
    toolPreview.setPaste(new Blueprint([new BlueprintEntry(PasteSquareType.objectTypeId, 0, 0, Direction.UP)]));
    toolPreview.setPaste(null);
    assert.deepEqual(sent.map(message => message.constructor), [CursorPasteMessage, CursorPasteClearMessage]);
    assert.deepEqual(sent[0].runs, [0, 4]);
});
