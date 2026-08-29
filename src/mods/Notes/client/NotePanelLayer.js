import {
    ACTIVE_ACCENT,
    ConnectedPanelLayer,
    ManagedPanel,
    PANEL_TINT,
    PANEL_TITLE_TEXT,
    ROW_HEIGHT,
    TILE_SIZE,
    TextInput,
    TextRole,
    UIPanel,
    buildPanelButton,
} from "@spup/sdk/client";
import {NOTE_TEXT_MAX_LENGTH} from "../common/constants.js";
import {NotePlaceMessage, NoteEditMessage, NoteDeleteMessage} from "../common/messages.js";
import {NOTE_EDITOR_MODE_PLACE, NOTE_EDITOR_MODE_EDIT, NOTE_EDITOR_MODE_DELETE} from "./NotesState.js";
import {clamp, noteAnchor} from "./layout.js";

const PANEL_WIDTH = 280;
// The connector aims at the marker itself, not at the whole tile under it.
const MARKER_SIZE_TILES = 0.4;
// Clearance the panel keeps from the marker it belongs to, and from the screen edges.
const MARKER_GAP = 40;
const SCREEN_MARGIN = 12;

/**
 * The note editor: writes a new note, rewrites the player's own, or removes another player's from
 * a chunk they may build in. Linked to its tile by a connector curve.
 */
export class NotePanelLayer extends ConnectedPanelLayer {

    /**
     * @param {Application} app
     * @param {ClientCache} cache
     * @param {AbstractSession} session
     * @param {boolean} showAuthor false in solo play, where every note is the reader's own
     */
    constructor(
        app,
        cache,
        session,
        showAuthor,
    ) {
        super(app);
        this._cache = cache;
        this._session = session;
        this._showAuthor = showAuthor;
        this._notes = cache.writer("notes");
        this._players = cache.view("players");
        this.textureRegistry = null;
        this._editor = new ManagedPanel();
        // The DOM-backed input the editor owns while writing; absent in delete mode.
        this._input = null;
        // The target the built panel stands for; a repeat write must not rebuild under the typing.
        this._shownTarget = null;

        this._connectors.set("editor", () => this._editor.panel, () => this._targetTile());

        cache.subscribe("notes.editorTarget", () => this._sync());
    }

    /**
     * Repaints for the current theme; the engine calls this on any HUD layer defining it.
     * @returns {void}
     */
    restyle() {
        this._shownTarget = null;
        this._sync();
    }

    /**
     * @private
     * @returns {NoteEditorTarget|null}
     */
    _target() {
        return this._cache.get("notes.editorTarget");
    }

    /**
     * @private
     * @returns {{x: number, y: number, size: number}|null} the marker's box, in tiles
     */
    _targetTile() {
        const target = this._target();
        if (target === null) {
            return null;
        }
        const anchor = noteAnchor(target);
        return {
            x: anchor.x / TILE_SIZE - MARKER_SIZE_TILES / 2,
            y: anchor.y / TILE_SIZE - MARKER_SIZE_TILES / 2,
            size: MARKER_SIZE_TILES,
        };
    }

    /**
     * @private
     * @returns {void}
     */
    _sync() {
        const target = this._target();
        if (target === this._shownTarget) {
            return;
        }
        this._shownTarget = target;
        if (target === null) {
            this._destroyInput();
            this._editor.hide();
        } else {
            this._show(target);
        }
    }

    /**
     * @private
     * @param {NoteEditorTarget} target
     * @returns {void}
     */
    _show(target) {
        // The rebuild destroys the panel's children; the input carries its text into the new one.
        let text = target.text;
        if (this._input !== null) {
            text = this._input.value;
        }
        this._destroyInput();
        // Each open belongs to another marker, so a spot dragged for the last one means nothing.
        this._editor.forgetPosition();
        if (target.mode !== NOTE_EDITOR_MODE_DELETE) {
            this._input = new TextInput(this._app, UIPanel.contentWidthFor(PANEL_WIDTH), ROW_HEIGHT, NOTE_TEXT_MAX_LENGTH, "Leave a note");
            this._input.value = text;
            this._input.onSubmit(() => this._save(target));
        }

        const panel = this._editor.show({
            app: this._app,
            textureRegistry: this.textureRegistry,
            title: this._title(target),
            titleColor: PANEL_TITLE_TEXT,
            tint: PANEL_TINT,
            width: PANEL_WIDTH,
            onClose: () => this._notes.closeEditor(),
        }, this._positionBeside(target), stack => this._buildBody(stack, target));
        this.addChild(panel);
        if (this._input !== null) {
            this._input.focus();
        }
    }

    /**
     * Places the panel beside its marker — right of it where that fits, left of it otherwise —
     * vertically centered on it, kept inside the screen. Falls back to the screen center before
     * the viewport is bound.
     * @private
     * @param {NoteEditorTarget} target
     * @returns {function(height: number): {x: number, y: number}}
     */
    _positionBeside(target) {
        if (this.viewport === null) {
            return UIPanel.centerPosition(this._app, PANEL_WIDTH);
        }
        const world = noteAnchor(target);
        const marker = this.viewport.toScreen(world.x, world.y);
        return (height) => {
            let x = marker.x + MARKER_GAP;
            if (x + PANEL_WIDTH > this._app.screen.width - SCREEN_MARGIN) {
                x = marker.x - MARKER_GAP - PANEL_WIDTH;
            }
            const y = marker.y - height / 2;
            return {
                x: clamp(x, SCREEN_MARGIN, this._app.screen.width - PANEL_WIDTH - SCREEN_MARGIN),
                y: clamp(y, SCREEN_MARGIN, UIPanel.maxTop(this._app, height)),
            };
        };
    }

    /**
     * @private
     * @param {NoteEditorTarget} target
     * @returns {string}
     */
    _title(target) {
        if (target.mode === NOTE_EDITOR_MODE_PLACE) {
            return "New note";
        }
        if (target.mode === NOTE_EDITOR_MODE_EDIT) {
            return "Edit note";
        }
        return "Note";
    }

    /**
     * @private
     * @param {PanelStack} stack
     * @param {NoteEditorTarget} target
     * @returns {void}
     */
    _buildBody(stack, target) {
        if (this._input === null) {
            stack.text(target.text);
            if (this._showAuthor) {
                stack.text(this._players.usernameOf(target.authorId), TextRole.MUTED);
            }
        } else {
            stack.row(row => row.leading(this._input));
        }
        stack.gap();
        stack.row(row => this._fillButtons(row, target));
    }

    /**
     * @private
     * @param {Container} row
     * @param {NoteEditorTarget} target
     * @returns {void}
     */
    _fillButtons(row, target) {
        row.leading(buildPanelButton(this.textureRegistry, "Back", PANEL_TINT, () => this._notes.closeEditor()));
        if (target.mode !== NOTE_EDITOR_MODE_PLACE) {
            row.leading(buildPanelButton(this.textureRegistry, "Delete", PANEL_TINT, () => {
                this._session.sendMessage(new NoteDeleteMessage(target.tileX, target.tileY));
                this._notes.closeEditor();
            }));
        }
        if (this._input === null) {
            return;
        }
        row.leading(buildPanelButton(this.textureRegistry, "Save", ACTIVE_ACCENT, () => this._save(target)));
    }

    /**
     * Sends the typed text as a placement or an edit; empty text saves nothing.
     * @private
     * @param {NoteEditorTarget} target
     * @returns {void}
     */
    _save(target) {
        const text = this._input.value.trim();
        if (text.length === 0) {
            return;
        }
        if (target.mode === NOTE_EDITOR_MODE_EDIT) {
            this._session.sendMessage(new NoteEditMessage(target.tileX, target.tileY, text));
        } else {
            this._session.sendMessage(new NotePlaceMessage(target.tileX, target.tileY, target.offsetMx, target.offsetMy, text));
        }
        this._notes.closeEditor();
    }

    /**
     * Drops the editor's DOM input before anything destroys the panel holding it.
     * @private
     * @returns {void}
     */
    _destroyInput() {
        if (this._input === null) {
            return;
        }
        this._input.removeFromParent();
        this._input.destroy();
        this._input = null;
    }
}
