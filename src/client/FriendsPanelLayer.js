import {Container, Text} from "pixi.js";
import {UIPanel} from "@/client/UIPanel.js";
import {TextInput} from "@/client/TextInput.js";
import {ScrollView} from "@/client/ScrollView.js";
import {buildPanelButton, BUTTON_HEIGHT} from "@/client/panelButton.js";
import {GAME_FONT, ViewMode, viewportChunks} from "@/client/constants.js";
import {PANEL_TINT, PANEL_TITLE_TEXT, ACTIVE_ACCENT, TOOLBAR_TEXT} from "@/client/Theme.js";
import {USERNAME_PATTERN, USERNAME_PATTERN_HINT} from "@/common/constants.js";
import {AddFriendByUsernameResultEvent} from "@/common/PlayerEvents.js";
import Mobile from "@/client/Mobile.js";

const PANEL_WIDTH = 360;
// Default open position: right edge under the button row, clear of it by this much.
const ANCHOR_MARGIN_RIGHT = 16;
const ANCHOR_GAP = 12;
const ROW_HEIGHT = BUTTON_HEIGHT;
const ROW_GAP = 6;
const HEADER_HEIGHT = 22;
const SECTION_GAP = 14;
// Clearance between a scrollable section's rows and its inset sprite's edges.
const SECTION_PADDING_TOP = 6;
const SECTION_PADDING_RIGHT = 0;
const SECTION_PADDING_BOTTOM = 0;
const SECTION_PADDING_LEFT = 6;
const INPUT_HEIGHT = BUTTON_HEIGHT;
const INPUT_GAP = 8;
const MAX_USERNAME_LENGTH = 12;
// The friends and nearby lists scroll past this many rows instead of growing the panel
// indefinitely (the nearby roster in particular is unbounded — every claimed chunk in view).
// Mobile screens are shorter, so its section viewports show fewer rows before scrolling.
const SECTION_VISIBLE_ROWS = 5;
const SECTION_VISIBLE_ROWS_MOBILE = 3;

/**
 * Friend list and management: granted rights, an add-by-username field, and a roster of the
 * currently visible claimed chunks' owners. A single {@link UIPanel}, rebuilt whenever
 * friend/claim/name state changes while open.
 */
export class FriendsPanelLayer extends Container {

    /**
     * @param {Application} app
     * @param {ClientCache} state
     */
    constructor(app, state) {
        super();
        this._app = app;
        this._claims = state.view("chunkClaims");
        this._players = state.view("players");
        this.textureRegistry = null;
        // The game viewport, for the currently-visible-owners roster (set by the host).
        this.viewport = null;
        // The friends button, to open below it by default (set by the host).
        this.anchorButton = null;
        // Overworld zoom shows too many claimed chunks at once for a meaningful roster.
        this._viewMode = ViewMode.WORLD;
        // Above the always-visible settings/friends buttons (9500), below toasts/dialogs.
        this.zIndex = 9600;
        this.visible = false;
        this._panel = null;
        // Last dragged position, kept across a close/reopen (null until first shown).
        this._savedX = null;
        this._savedY = null;
        this._usernameInput = null;
        this._pendingUsername = "";
        this._onAddByUsername = null;
        this._onAddFriend = null;
        this._onUnfriend = null;
        this._onError = null;

        const refresh = () => this.refresh();
        state.subscribe("chunkClaims.friendIds", refresh);
        state.subscribe("chunkClaims.ownerByChunk", refresh);
        state.subscribe("players.usernameByPlayer", refresh);
    }

    /**
     * @param {function(username: string): void} callback
     */
    onAddByUsername(callback) {
        this._onAddByUsername = callback;
    }

    /**
     * @param {function(playerId: number): void} callback
     */
    onAddFriend(callback) {
        this._onAddFriend = callback;
    }

    /**
     * @param {function(playerId: number): void} callback
     */
    onUnfriend(callback) {
        this._onUnfriend = callback;
    }

    /**
     * @param {function(message: string): void} callback fired on a rejected add-by-name (bad
     * format locally, or unknown name once the server answers)
     */
    onError(callback) {
        this._onError = callback;
    }

    /**
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (event instanceof AddFriendByUsernameResultEvent && event.found === 0) {
            this._onError(`No player named "${event.username}"`);
        }
    }

    /**
     * @param {ViewMode} mode
     * @returns {void}
     */
    setViewMode(mode) {
        this._viewMode = mode;
        this.refresh();
    }

    /**
     * @returns {void}
     */
    toggle() {
        if (this.visible) {
            this.hide();
        } else {
            this.show();
        }
    }

    /**
     * @returns {void}
     */
    show() {
        this.visible = true;
        this._rebuild();
    }

    /**
     * @returns {void}
     */
    hide() {
        this.visible = false;
        if (this._usernameInput !== null) {
            // Blurs the real DOM input before it's destroyed, rather than leaving the page's
            // focus dangling on an element about to be removed.
            this._usernameInput.blur();
            this._usernameInput = null;
        }
        if (this._panel !== null) {
            this._savedX = this._panel.x;
            this._savedY = this._panel.y;
            this._panel.destroy({children: true});
            this._panel = null;
        }
    }

    /**
     * Re-renders while open; a no-op while hidden (the next {@link show} rebuilds fresh).
     * @returns {void}
     */
    refresh() {
        if (this.visible) {
            this._rebuild();
        }
    }

    /**
     * Builds the body into a detached container first (so its measured height sizes the panel),
     * then swaps it in, preserving the previous panel's position. The previous input (if any) is
     * blurred before the rebuild destroys it, rather than leaving the page's focus dangling.
     * @private
     * @returns {void}
     */
    _rebuild() {
        const friendIds = this._sortByUsername(this._claims.friendIds());

        if (this._usernameInput !== null) {
            this._usernameInput.blur();
        }

        const contentWidth = UIPanel.contentWidthFor(PANEL_WIDTH);
        const body = new Container();
        let cursorY = 0;
        cursorY = this._addHeader(body, "Friends", cursorY);
        cursorY = this._addScrollableRows(body, contentWidth, friendIds, cursorY, (id) => ({
            label: this._players.usernameOf(id),
            buttonLabel: "Remove",
            onClick: () => this._onUnfriend(id),
        }), "Not friends with anyone yet");
        cursorY += SECTION_GAP;

        if (this._viewMode !== ViewMode.OVERWORLD) {
            const roster = this._sortByUsername(this._nearbyOwners());
            cursorY = this._addHeader(body, "Nearby (in view)", cursorY);
            cursorY = this._addScrollableRows(body, contentWidth, roster, cursorY, (id) => ({
                label: this._players.usernameOf(id),
                buttonLabel: "Add",
                onClick: () => this._onAddFriend(id),
            }), "No other claimed chunks in view");
            cursorY += SECTION_GAP;
        }

        cursorY = this._addHeader(body, "Add by name", cursorY);
        const inputRowHeight = this._addUsernameRow(body, contentWidth, cursorY);
        const contentHeight = cursorY + inputRowHeight;

        const previous = this._panel;
        let x;
        let y;
        if (this._savedX !== null) {
            x = this._savedX;
            y = this._savedY;
        } else if (this.anchorButton !== null) {
            x = this._app.screen.width - ANCHOR_MARGIN_RIGHT - PANEL_WIDTH;
            y = this.anchorButton.bottomY + ANCHOR_GAP;
        } else {
            x = (this._app.screen.width - PANEL_WIDTH) / 2;
            y = (this._app.screen.height - UIPanel.heightForContent(contentHeight)) / 2;
        }
        if (previous !== null) {
            x = previous.x;
            y = previous.y;
            previous.destroy({children: true});
        }

        this._panel = new UIPanel({
            app: this._app,
            textureRegistry: this.textureRegistry,
            title: "Friends",
            titleColor: PANEL_TITLE_TEXT,
            tint: PANEL_TINT,
            width: PANEL_WIDTH,
            height: UIPanel.heightForContent(contentHeight),
            onClose: () => this.hide(),
        });
        this._panel.x = x;
        this._panel.y = y;
        this.addChild(this._panel);
        this._panel.addContent(body);
    }

    /**
     * A player-row list, scrolled past {@link SECTION_VISIBLE_ROWS} instead of growing the panel;
     * short lists render directly with no scrollbar (the row width matches either way, so a list
     * never reflows crossing the threshold).
     * @private
     * @param {Container} body
     * @param {number} contentWidth
     * @param {number[]} ids
     * @param {number} y
     * @param {function(number): {label: string, buttonLabel: string|null, onClick: function(): void|null}} describe
     * @param {string} emptyLabel
     * @returns {number} the next y
     */
    _addScrollableRows(body, contentWidth, ids, y, describe, emptyLabel) {
        const innerWidth = contentWidth - SECTION_PADDING_LEFT - SECTION_PADDING_RIGHT;
        const rowsWidth = ScrollView.contentWidthFor(innerWidth);
        const rows = new Container();
        const rowsHeight = this._addPlayerRows(rows, rowsWidth, ids, 0, describe, emptyLabel);
        const viewportHeight = this._sectionViewportHeight();
        const visibleHeight = Math.min(rowsHeight, viewportHeight);

        const insetHeight = visibleHeight + SECTION_PADDING_TOP + SECTION_PADDING_BOTTOM;
        const inset = UIPanel.insetSprite(this.textureRegistry, contentWidth, insetHeight, PANEL_TINT);
        inset.y = y;
        body.addChild(inset);

        if (rowsHeight <= viewportHeight) {
            rows.x = SECTION_PADDING_LEFT;
            rows.y = y + SECTION_PADDING_TOP;
            body.addChild(rows);
        } else {
            const scrollView = new ScrollView(this.viewport, innerWidth, viewportHeight);
            scrollView.x = SECTION_PADDING_LEFT;
            scrollView.y = y + SECTION_PADDING_TOP;
            scrollView.content.addChild(rows);
            scrollView.setContentHeight(rowsHeight);
            body.addChild(scrollView);
        }
        return y + insetHeight;
    }

    /**
     * @private
     * @returns {number}
     */
    _sectionViewportHeight() {
        const rows = Mobile.enabled ? SECTION_VISIBLE_ROWS_MOBILE : SECTION_VISIBLE_ROWS;
        return rows * (ROW_HEIGHT + ROW_GAP) - ROW_GAP;
    }

    /**
     * @private
     * @param {number[]} ids
     * @returns {number[]}
     */
    _sortByUsername(ids) {
        return [...ids].sort((a, b) => this._players.usernameOf(a).localeCompare(this._players.usernameOf(b)));
    }

    /**
     * The distinct foreign, non-friend owners of the chunks currently in view;
     * unbounded, scrolled by the caller.
     * @private
     * @returns {number[]}
     */
    _nearbyOwners() {
        if (this.viewport === null) {
            return [];
        }
        const center = this.viewport.center;
        return this._claims.nearbyForeignOwners(viewportChunks(this.viewport), center.x, center.y);
    }

    /**
     * @private
     * @param {Container} body
     * @param {string} label
     * @param {number} y
     * @returns {number} the next y
     */
    _addHeader(body, label, y) {
        const text = new Text({
            text: label,
            style: {fontFamily: GAME_FONT, fontSize: 14, fill: TOOLBAR_TEXT, fontWeight: "bold"},
        });
        text.y = y;
        body.addChild(text);
        return y + HEADER_HEIGHT;
    }

    /**
     * Renders one row per id via `describe(id)`, or a single muted placeholder row when empty.
     * @private
     * @param {Container} body
     * @param {number} contentWidth
     * @param {number[]} ids
     * @param {number} y
     * @param {function(number): {label: string, buttonLabel: string|null, onClick: function(): void|null}} describe
     * @param {string} emptyLabel
     * @returns {number} the next y
     */
    _addPlayerRows(body, contentWidth, ids, y, describe, emptyLabel) {
        if (ids.length === 0) {
            const text = new Text({
                text: emptyLabel,
                style: {fontFamily: GAME_FONT, fontSize: 14, fill: TOOLBAR_TEXT},
            });
            text.alpha = 0.6;
            text.y = y + (ROW_HEIGHT - text.height) / 2;
            body.addChild(text);
            return y + ROW_HEIGHT + ROW_GAP;
        }
        let cursorY = y;
        for (const id of ids) {
            const {label, buttonLabel, onClick} = describe(id);
            const row = new Container();
            row.y = cursorY;
            const text = new Text({
                text: label,
                style: {fontFamily: GAME_FONT, fontSize: 15, fill: TOOLBAR_TEXT},
            });
            text.y = (ROW_HEIGHT - text.height) / 2;
            row.addChild(text);
            if (buttonLabel !== null) {
                const button = buildPanelButton(this.textureRegistry, buttonLabel, ACTIVE_ACCENT, onClick);
                button.x = contentWidth - button.width;
                row.addChild(button);
            }
            body.addChild(row);
            cursorY += ROW_HEIGHT + ROW_GAP;
        }
        return cursorY;
    }

    /**
     * The add-by-username row: a text input plus its Add button.
     * @private
     * @param {Container} body
     * @param {number} contentWidth
     * @param {number} y
     * @returns {number} the row's height
     */
    _addUsernameRow(body, contentWidth, y) {
        const row = new Container();
        row.y = y;

        const addButtonWidth = 70;
        const input = new TextInput(
            this._app,
            contentWidth - addButtonWidth - INPUT_GAP,
            INPUT_HEIGHT,
            MAX_USERNAME_LENGTH,
            "Name",
        );
        input.value = this._pendingUsername;
        input.onInput(value => this._pendingUsername = value);
        const submit = () => this._submitUsername(input);
        input.onSubmit(submit);
        row.addChild(input);
        this._usernameInput = input;

        const button = buildPanelButton(this.textureRegistry, "Add", ACTIVE_ACCENT, submit);
        button.x = input.x + input.width + INPUT_GAP;
        row.addChild(button);

        body.addChild(row);
        return INPUT_HEIGHT;
    }

    /**
     * @private
     * @param {TextInput} input
     * @returns {void}
     */
    _submitUsername(input) {
        const username = input.value;
        if (!USERNAME_PATTERN.test(username)) {
            this._onError(USERNAME_PATTERN_HINT);
            return;
        }
        this._onAddByUsername(username);
        this._pendingUsername = "";
        input.blur();
    }
}
