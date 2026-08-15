import {Container, GAME_FONT, Graphics, PANEL_BORDER, PANEL_TINT, PANEL_TINT_TEXT, Text} from "@spup/sdk/client";
import {clamp, noteAnchor} from "./layout.js";

const TEXT_SIZE = 15;
const WRAP_WIDTH = 240;
const PADDING = 8;
const CORNER_RADIUS = 4;
const BORDER_ALPHA = 0.35;
// Clearance from the hovered pin, and from the screen edges the box is nudged back inside.
const PIN_CLEARANCE_X = 14;
const PIN_CLEARANCE_Y = 10;
const SCREEN_MARGIN = 8;

/**
 * The hovered note's text, drawn as a plain box beside its pin — the weight of a browser tooltip,
 * not of a panel. Screen-anchored, so it neither scales nor rotates with the world.
 */
export class NoteTooltipLayer extends Container {

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
        super();
        this._app = app;
        this._cache = cache;
        this._showAuthor = showAuthor;
        this._players = cache.view("players");
        // The game viewport, for mapping the hovered pin to the screen (set by the host).
        this.viewport = null;
        this.zIndex = 9500;
        this.visible = false;
        this._mapMode = false;
        this.eventMode = "none";
        // The box's drawn size, so following it per frame costs no bounds walk.
        this._boxWidth = 0;
        this._boxHeight = 0;

        this._box = new Graphics();
        this.addChild(this._box);
        this._text = new Text({
            text: "",
            style: {fontFamily: GAME_FONT, fontSize: TEXT_SIZE, fill: PANEL_TINT_TEXT, wordWrap: true, wordWrapWidth: WRAP_WIDTH},
        });
        this._text.x = PADDING;
        this._text.y = PADDING;
        this.addChild(this._text);
        this._author = new Text({
            text: "",
            style: {fontFamily: GAME_FONT, fontSize: TEXT_SIZE, fill: PANEL_BORDER, fontStyle: "italic"},
        });
        this._author.x = PADDING;
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
        let contentBottom = this._text.y + this._text.height;
        if (this._showAuthor) {
            this._author.text = this._players.usernameOf(note.authorId);
            this._author.y = contentBottom + PADDING / 2;
            contentWidth = Math.max(contentWidth, this._author.width);
            contentBottom = this._author.y + this._author.height;
        }
        this._boxWidth = contentWidth + PADDING * 2;
        this._boxHeight = contentBottom + PADDING;
        this._box
            .clear()
            .roundRect(0, 0, this._boxWidth, this._boxHeight, CORNER_RADIUS)
            .fill(PANEL_TINT)
            .stroke({color: PANEL_TINT_TEXT, width: 1, alpha: BORDER_ALPHA});
        this._follow();
    }

    /**
     * Keeps the box beside its pin, nudged back inside the screen at the edges.
     * @private
     * @returns {void}
     */
    _follow() {
        const note = this._note();
        if (note === null || this.viewport === null) {
            return;
        }
        const world = noteAnchor(note, this._mapMode);
        const anchor = this.viewport.toScreen(world.x, world.y);
        const maxX = this._app.screen.width - this._boxWidth - SCREEN_MARGIN;
        const maxY = this._app.screen.height - this._boxHeight - SCREEN_MARGIN;
        this.x = clamp(anchor.x + PIN_CLEARANCE_X, SCREEN_MARGIN, maxX);
        this.y = clamp(anchor.y + PIN_CLEARANCE_Y, SCREEN_MARGIN, maxY);
    }
}
