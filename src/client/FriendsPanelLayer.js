import {Container} from "pixi.js";
import {ManagedPanel, UIPanel} from "@/client/UIPanel.js";
import {TextInput} from "@/client/TextInput.js";
import {buildPanelButton} from "@/client/panelButton.js";
import {ROW_HEIGHT} from "@/client/PanelStack.js";
import {ViewMode, viewportChunks} from "@/client/constants.js";
import {PANEL_TINT, PANEL_TITLE_TEXT, ACTIVE_ACCENT} from "@/client/Theme.js";
import {USERNAME_PATTERN, USERNAME_PATTERN_HINT} from "@/common/constants.js";
import {AddFriendByUsernameResultEvent} from "@/common/PlayerEvents.js";

const PANEL_WIDTH = 360;
// Default open position: right edge under the button row, clear of it by this much.
const ANCHOR_MARGIN_RIGHT = 16;
const ANCHOR_GAP = 12;
const INPUT_HEIGHT = ROW_HEIGHT;
const INPUT_GAP = 8;
const MAX_USERNAME_LENGTH = 12;

/**
 * Friend list/management panel: granted rights, add-by-username field, visible-chunk-owners roster.
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
        this._managed = new ManagedPanel();
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
            // Blurs the DOM input before destroying it, so focus doesn't dangle.
            this._usernameInput.blur();
            this._usernameInput = null;
        }
        this._managed.hide();
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
     * Anchor below the friends button, or center on first-ever show.
     * @private
     * @param {number} height
     * @returns {{x: number, y: number}}
     */
    _defaultPosition(height) {
        if (this.anchorButton !== null) {
            return {
                x: this._app.screen.width - ANCHOR_MARGIN_RIGHT - PANEL_WIDTH,
                y: this.anchorButton.bottomY + ANCHOR_GAP,
            };
        }
        return UIPanel.centerPosition(this._app, PANEL_WIDTH)(height);
    }

    /**
     * @private
     * @returns {void}
     */
    _rebuild() {
        const friendIds = this._sortByUsername(this._claims.friendIds());
        const panel = this._managed.show({
            app: this._app,
            textureRegistry: this.textureRegistry,
            title: "Friends",
            titleColor: PANEL_TITLE_TEXT,
            tint: PANEL_TINT,
            width: PANEL_WIDTH,
            onClose: () => this.hide(),
        }, (height) => this._defaultPosition(height), (stack) => this._buildBody(stack, friendIds));
        this.addChild(panel);
    }

    /**
     * @private
     * @param {PanelStack} stack
     * @param {number[]} friendIds
     * @returns {void}
     */
    _buildBody(stack, friendIds) {
        stack.header("Friends");
        stack.scrollSection(this.viewport, friendIds, (id) => ({
            label: this._players.usernameOf(id),
            buttonLabel: "Remove",
            onClick: () => this._onUnfriend(id),
        }), "Not friends with anyone yet");
        stack.gap();

        if (this._viewMode !== ViewMode.OVERWORLD) {
            const roster = this._sortByUsername(this._nearbyOwners());
            stack.header("Nearby (in view)");
            stack.scrollSection(this.viewport, roster, (id) => ({
                label: this._players.usernameOf(id),
                buttonLabel: "Add",
                onClick: () => this._onAddFriend(id),
            }), "No other claimed chunks in view");
            stack.gap();
        }

        stack.header("Add by name");
        stack.row((row) => this._fillUsernameRow(row, stack.contentWidth));
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
     * The add-by-username row: a text input plus its Add button. The input is reused across
     * rebuilds (re-parented into the fresh row) rather than recreated, so its real DOM element
     * doesn't get torn down and flicker on every viewport-triggered refresh.
     * @private
     * @param {Container} row
     * @param {number} contentWidth
     * @returns {void}
     */
    _fillUsernameRow(row, contentWidth) {
        const addButtonWidth = 70;
        let input = this._usernameInput;
        if (input === null) {
            input = new TextInput(
                this._app,
                contentWidth - addButtonWidth - INPUT_GAP,
                INPUT_HEIGHT,
                MAX_USERNAME_LENGTH,
                "Name",
            );
            input.value = this._pendingUsername;
            this._usernameInput = input;
        }
        const submit = () => this._submitUsername(input);
        input.onInput(value => this._pendingUsername = value);
        input.onSubmit(submit);
        row.addChild(input);

        const button = buildPanelButton(this.textureRegistry, "Add", ACTIVE_ACCENT, submit);
        button.x = input.x + input.width + INPUT_GAP;
        row.addChild(button);
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
