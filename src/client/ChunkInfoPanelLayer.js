import {Container, Graphics, Text} from "pixi.js";
import {PLAYER_ID_NONE} from "@/common/constants.js";
import {ClaimResult} from "@/common/ClaimEvents.js";
import {GAME_FONT, HUD_BOTTOM_OFFSET} from "@/client/constants.js";
import {PANEL_BORDER, PANEL_TEXT, ACTIVE_ACCENT, LABEL_EMPHASIS} from "@/client/Theme.js";
import {drawPanelBackground} from "@/client/icons.js";
import {buildPanelButton, BUTTON_HEIGHT} from "@/client/panelButton.js";

const PADDING_X = 14;
const PADDING_Y = 10;
const LINE_GAP = 4;
const BUTTON_GAP = 10;
const MIN_WIDTH = 220;

/**
 * Map-mode chunk panel: the hovered chunk's owner and buildability, with a claim or unclaim
 * button where available. A screen-space HUD on app.stage; the host feeds it the chunk.
 */
export class ChunkInfoPanelLayer extends Container {

    /**
     * @param {Application} app
     * @param {ChunkClaimsView} claims
     * @param {PlayersView} players
     */
    constructor(app, claims, players) {
        super();
        this._app = app;
        this._claims = claims;
        this._players = players;
        this.zIndex = 900;
        this.visible = false;
        this._chunk = null;
        this._onClaim = null;
        this._onUnclaim = null;
        this._onAddFriend = null;
        this._onUnfriend = null;
        // The panel and its texts persist; a rebuild only retargets them and the button.
        this._panel = new Container();
        this._background = new Graphics();
        this._title = new Text({
            text: "",
            style: {fontFamily: GAME_FONT, fontSize: 16, fill: LABEL_EMPHASIS, fontWeight: "bold"},
        });
        this._info = new Text({
            text: "",
            style: {fontFamily: GAME_FONT, fontSize: 15, fill: PANEL_TEXT},
        });
        this._panel.addChild(this._background);
        this._panel.addChild(this._title);
        this._panel.addChild(this._info);
        // Presses on the panel body must not fall through to the viewport (pan/tap).
        this._panel.eventMode = "static";
        this._panel.on("pointerdown", (e) => e.stopPropagation());
        this.addChild(this._panel);
        this._button = null;
        this._buttonLabel = null;
        this._buttonDisabled = false;
        // Current button action; retargeting swaps it without rebuilding the button.
        this._buttonAction = null;
        app.renderer.on("resize", () => this._layout());
    }

    /**
     * @param {function(chunk: number): void} callback
     */
    onClaim(callback) {
        this._onClaim = callback;
    }

    /**
     * @param {function(chunk: number): void} callback
     */
    onUnclaim(callback) {
        this._onUnclaim = callback;
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
     * Shows (or retargets) the panel for a chunk; hover re-enters on the same chunk are free.
     * @param {number} chunk
     * @returns {void}
     */
    showChunk(chunk) {
        if (chunk === this._chunk && this.visible) {
            return;
        }
        this._chunk = chunk;
        this._rebuild();
    }

    /**
     * @returns {void}
     */
    hide() {
        this._chunk = null;
        this.visible = false;
    }

    /**
     * Re-renders the current chunk after a claim/friend change; a no-op while hidden.
     * @returns {void}
     */
    refresh() {
        if (this._chunk !== null) {
            this._rebuild();
        }
    }

    /**
     * The panel's lines and button for the current chunk; a labeled button with a null action
     * renders disabled.
     * @private
     * @returns {{title: string, info: string, buttonLabel: string|null, buttonAction: function(): void|null}}
     */
    _content() {
        const chunk = this._chunk;
        const claims = this._claims;
        const owner = claims.ownerOf(chunk);
        if (owner !== PLAYER_ID_NONE && owner === claims.ownPlayerId) {
            return {
                title: "Your chunk",
                info: "You can build here",
                buttonLabel: "Unclaim chunk",
                buttonAction: () => this._onUnclaim(chunk),
            };
        }
        if (owner !== PLAYER_ID_NONE) {
            const name = this._players.usernameOf(owner);
            // Access comes from THEIR grant; the button toggles the own player's grant back.
            let info;
            if (claims.isGrantedBy(owner)) {
                info = `${name} lets you build here`;
            } else {
                info = "You cannot build here";
            }
            let buttonLabel;
            let buttonAction;
            if (claims.isFriend(owner)) {
                buttonLabel = `Unfriend ${name}`;
                buttonAction = () => this._onUnfriend(owner);
            } else {
                buttonLabel = `Add friend ${name}`;
                buttonAction = () => this._onAddFriend(owner);
            }
            return {title: `${name}'s chunk`, info, buttonLabel, buttonAction};
        }
        const check = claims.claimCheck(chunk);
        if (check === ClaimResult.CLAIM_RESULT_OK) {
            return {
                title: "Unclaimed chunk",
                info: "Claim it to build here",
                buttonLabel: `Claim chunk (${claims.ownCount()}/${claims.maxChunks})`,
                buttonAction: () => this._onClaim(chunk),
            };
        }
        if (check === ClaimResult.CLAIM_RESULT_LIMIT) {
            return {
                title: "Unclaimed chunk",
                info: `Chunk limit reached (${claims.maxChunks}/${claims.maxChunks})`,
                buttonLabel: "Claim chunk",
                buttonAction: null,
            };
        }
        return {
            title: "Unclaimed chunk",
            info: "Must touch one of your claimed chunks",
            buttonLabel: null,
            buttonAction: null,
        };
    }

    /**
     * @private
     * @returns {void}
     */
    _rebuild() {
        const {title, info, buttonLabel, buttonAction} = this._content();
        this._title.text = title;
        this._info.text = info;
        this._refreshButton(buttonLabel, buttonAction);

        const buttonWidth = this._button === null ? 0 : this._button.width;
        const contentWidth = Math.max(MIN_WIDTH, this._title.width, this._info.width, buttonWidth);
        const width = contentWidth + PADDING_X * 2;
        let height = PADDING_Y + this._title.height + LINE_GAP + this._info.height + PADDING_Y;
        if (this._button !== null) {
            height += BUTTON_GAP + BUTTON_HEIGHT;
        }
        this._background.clear();
        drawPanelBackground(this._background, width, height);

        this._title.x = PADDING_X;
        this._title.y = PADDING_Y;
        this._info.x = PADDING_X;
        this._info.y = this._title.y + this._title.height + LINE_GAP;
        if (this._button !== null) {
            this._button.x = (width - this._button.width) / 2;
            this._button.y = this._info.y + this._info.height + BUTTON_GAP;
        }
        this._layout();
        this.visible = true;
    }

    /**
     * Retargets the button: an unchanged label and enabled state only swap the action;
     * otherwise it rebuilds, or drops with a null label.
     * @private
     * @param {string|null} label
     * @param {function(): void|null} action
     * @returns {void}
     */
    _refreshButton(label, action) {
        this._buttonAction = action;
        const disabled = action === null;
        if (label === this._buttonLabel && disabled === this._buttonDisabled) {
            return;
        }
        this._buttonLabel = label;
        this._buttonDisabled = disabled;
        if (this._button !== null) {
            this._panel.removeChild(this._button);
            this._button.destroy({children: true});
            this._button = null;
        }
        if (label !== null) {
            this._button = this._buildButton(label, disabled);
            this._panel.addChild(this._button);
        }
    }

    /**
     * A rounded accent-bordered button firing {@link _buttonAction} on tap; disabled grays it out.
     * @private
     * @param {string} label
     * @param {boolean} disabled
     * @returns {Container}
     */
    _buildButton(label, disabled) {
        const borderColor = disabled ? PANEL_BORDER : ACTIVE_ACCENT;
        return buildPanelButton(label, borderColor, () => this._buttonAction(), disabled);
    }

    /**
     * Bottom-center, clear of the toolbar.
     * @private
     * @returns {void}
     */
    _layout() {
        this._panel.x = Math.round((this._app.screen.width - this._panel.width) / 2);
        this._panel.y = this._app.screen.height - HUD_BOTTOM_OFFSET - this._panel.height;
    }
}
