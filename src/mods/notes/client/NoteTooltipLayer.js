import {
    AbstractTooltipLayer,
    GAME_FONT,
    PANEL_BORDER,
    PANEL_TINT_TEXT,
    Text,
    TOOLTIP_PADDING,
} from "@spup/sdk/client";
import {noteAnchor} from "./layout.js";

const TEXT_SIZE = 15;
const WRAP_WIDTH = 240;
// Clearance from the hovered pin.
const PIN_CLEARANCE_X = 14;
const PIN_CLEARANCE_Y = 10;

/**
 * The hovered note's text, in a tooltip box beside its pin.
 */
export class NoteTooltipLayer extends AbstractTooltipLayer {

    /**
     * @param {Application} app
     * @param {ClientCache} cache the hovered note and the open editor
     * @param {boolean} showAuthor false in solo play, where every note is the reader's own
     */
    constructor(
        app,
        cache,
        showAuthor,
    ) {
        super(app);
        this._cache = cache;
        this._showAuthor = showAuthor;
        this._players = cache.view("players");
        this._mapMode = false;

        this._text = new Text({
            text: "",
            style: {fontFamily: GAME_FONT, fontSize: TEXT_SIZE, fill: PANEL_TINT_TEXT, wordWrap: true, wordWrapWidth: WRAP_WIDTH},
        });
        this._text.x = TOOLTIP_PADDING;
        this._text.y = TOOLTIP_PADDING;
        this.addChild(this._text);
        this._author = new Text({
            text: "",
            style: {fontFamily: GAME_FONT, fontSize: TEXT_SIZE, fill: PANEL_BORDER, fontStyle: "italic"},
        });
        this._author.x = TOOLTIP_PADDING;
        this.addChild(this._author);

        cache.subscribe("notes.hoverTarget", () => this._refresh());
        cache.subscribe("notes.editorTarget", () => this._refresh());
        // The pin moves with every pan and zoom; the box follows it per frame.
        this._tick = () => this._follow();
        app.ticker.add(this._tick);
    }

    /**
     * Map mode parks every pin on its tile center; the box follows them there.
     * @param {boolean} value
     * @returns {void}
     */
    setMapMode(value) {
        this._mapMode = value;
        this._follow();
    }

    /**
     * Repaints for the current theme; the engine calls this on any HUD layer defining it.
     * @returns {void}
     */
    restyle() {
        this._text.style.fill = PANEL_TINT_TEXT;
        this._author.style.fill = PANEL_BORDER;
        this._refresh();
    }

    /**
     * @private
     * @returns {Note|null} the note to show, null while none is hovered
     */
    _note() {
        if (this._cache.get("notes.editorTarget") !== null) {
            return null;
        }
        return this._cache.get("notes.hoverTarget");
    }

    /**
     * @private
     * @returns {void}
     */
    _refresh() {
        const note = this._note();
        this.visible = note !== null;
        if (note === null) {
            return;
        }
        this._text.text = note.text;
        this._author.visible = this._showAuthor;
        let contentWidth = this._text.width;
        let contentBottom = this._text.height;
        if (this._showAuthor) {
            this._author.text = this._players.usernameOf(note.authorId);
            this._author.y = this._text.y + contentBottom + TOOLTIP_PADDING / 2;
            contentWidth = Math.max(contentWidth, this._author.width);
            contentBottom = this._author.y + this._author.height - this._text.y;
        }
        this.drawBox(contentWidth, contentBottom);
        this._follow();
    }

    /**
     * Keeps the box beside its pin.
     * @private
     * @returns {void}
     */
    _follow() {
        const note = this._note();
        if (note === null || this.viewport === null) {
            return;
        }
        const world = noteAnchor(note, this._mapMode);
        this.placeAt(world.x, world.y, PIN_CLEARANCE_X, PIN_CLEARANCE_Y);
    }
}
