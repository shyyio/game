import {Container, Text} from "pixi.js";
import {PLAYER_ID_NONE} from "@/common/constants.js";
import {ClaimResult} from "@/common/ClaimEvents.js";
import {GAME_FONT, HUD_BOTTOM_OFFSET} from "@/client/constants.js";
import {PANEL_BORDER, PANEL_TEXT, ACTIVE_ACCENT, PANEL_TITLE_TEXT, PANEL_TINT} from "@/client/Theme.js";
import {UIPanel} from "@/client/UIPanel.js";
import {buildPanelButton, BUTTON_HEIGHT} from "@/client/panelButton.js";

const PADDING_X = 14;
const PADDING_Y = 10;
const BUTTON_GAP = 10;
const MIN_WIDTH = 220;
// Gap between the outer frame and the sunken inset body.
const FRAME_MARGIN = 6;
// Title row above the inset body, matching the inspect panel's title bar.
const TITLE_ROW_HEIGHT = 36;
// Left inset of the title text, matching the inspect panel's title bar padding.
const TITLE_PADDING_X = 8;
// Gap between the title text and the trailing decorative pattern.
const TITLE_GAP = 8;
const PATTERN_HEIGHT = 22;

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
        this.textureRegistry = null;
        this.zIndex = 900;
        this.visible = false;
        this._bottomOffset = HUD_BOTTOM_OFFSET;
        this._chunk = null;
        this._onClaim = null;
        this._onUnclaim = null;
        this._onAddFriend = null;
        this._onUnfriend = null;
        // The panel and its texts persist; a rebuild only retargets them and the button.
        this._panel = new Container();
        this._frame = null;
        this._inset = null;
        this._pattern = null;
        this._title = new Text({
            text: "",
            style: {fontFamily: GAME_FONT, fontSize: 18, fill: PANEL_TITLE_TEXT, fontWeight: "bold"},
        });
        this._info = new Text({
            text: "",
            style: {fontFamily: GAME_FONT, fontSize: 15, fill: PANEL_TEXT},
        });
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
                buttonLabel: "Claim chunk",
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
        const width = contentWidth + (PADDING_X + FRAME_MARGIN) * 2;
        let height = FRAME_MARGIN + TITLE_ROW_HEIGHT + PADDING_Y + this._info.height + PADDING_Y + FRAME_MARGIN;
        if (this._button !== null) {
            height += BUTTON_GAP + BUTTON_HEIGHT;
        }
        this._rebuildBackground(width, height);

        this._title.x = TITLE_PADDING_X;
        this._title.y = FRAME_MARGIN + (TITLE_ROW_HEIGHT - this._title.height) / 2;
        this._info.x = FRAME_MARGIN + PADDING_X;
        this._info.y = FRAME_MARGIN + TITLE_ROW_HEIGHT + PADDING_Y;
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
        return buildPanelButton(this.textureRegistry, label, borderColor, () => this._buttonAction(), disabled);
    }

    /**
     * @private
     * @param {number} width
     * @param {number} height
     * @returns {void}
     */
    _rebuildBackground(width, height) {
        if (this._frame !== null) {
            this._frame.destroy();
            this._inset.destroy();
        }
        if (this._pattern !== null) {
            this._pattern.destroy();
        }
        this._frame = UIPanel.frameSprite(this.textureRegistry, width, height, PANEL_TINT);

        const insetHeight = height - FRAME_MARGIN - TITLE_ROW_HEIGHT - FRAME_MARGIN;
        this._inset = UIPanel.insetSprite(this.textureRegistry, width - FRAME_MARGIN * 2, insetHeight, PANEL_TINT);
        this._inset.position.set(FRAME_MARGIN, FRAME_MARGIN + TITLE_ROW_HEIGHT);

        // Trailing decorative pattern filling the title row past the title text.
        const patternX = TITLE_PADDING_X + this._title.width + TITLE_GAP;
        const patternWidth = Math.max(width - FRAME_MARGIN - PADDING_X - patternX, 0);
        if (patternWidth > 0) {
            this._pattern = UIPanel.patternStrip(this.textureRegistry, patternWidth, PATTERN_HEIGHT);
            this._pattern.position.set(patternX, FRAME_MARGIN + (TITLE_ROW_HEIGHT - PATTERN_HEIGHT) / 2);
        } else {
            this._pattern = null;
        }

        this._panel.addChildAt(this._inset, 0);
        this._panel.addChildAt(this._frame, 0);
        if (this._pattern !== null) {
            this._panel.addChildAt(this._pattern, 2);
        }
    }

    /**
     * Sets the clearance from the screen bottom (the host docks this to the toolbar's height,
     * or a small margin once the toolbar is hidden).
     * @param {number} offset
     * @returns {void}
     */
    setBottomOffset(offset) {
        if (offset === this._bottomOffset) {
            return;
        }
        this._bottomOffset = offset;
        this._layout();
    }

    /**
     * Bottom-center, clear of the toolbar.
     * @private
     * @returns {void}
     */
    _layout() {
        this._panel.x = Math.round((this._app.screen.width - this._panel.width) / 2);
        this._panel.y = this._app.screen.height - this._bottomOffset - this._panel.height;
    }
}
