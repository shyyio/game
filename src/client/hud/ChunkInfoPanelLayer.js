import {Container, Text} from "pixi.js";
import {PLAYER_ID_NONE} from "@/common/constants.js";
import {ClaimResult, ChunkPermission} from "@/common/ClaimEvents.js";
import {GAME_FONT, HUD_BOTTOM_OFFSET} from "@/client/constants.js";
import {PANEL_BORDER, PANEL_TINT_TEXT, ACTIVE_ACCENT, PANEL_TITLE_TEXT, PANEL_TINT} from "@/client/Theme.js";
import {UIPanel} from "@/client/hud/UIPanel.js";
import {buildPanelButton, buildToggleRow, BUTTON_HEIGHT} from "@/client/hud/panelButton.js";
import {swallowClicks} from "@/client/layers/pixiUtils.js";

const PADDING_X = 14;
const PADDING_Y = 10;
const BUTTON_GAP = 10;
const SEGMENT_GAP = 4;
const MIN_WIDTH = 220;

// Left to right, the own-chunk permission row's segments.
const PERMISSION_ORDER = [
    ChunkPermission.PERMISSION_FRIENDS,
    ChunkPermission.PERMISSION_ONLY_ME,
];
const PERMISSION_LABELS = {
    [ChunkPermission.PERMISSION_FRIENDS]: "Friends",
    [ChunkPermission.PERMISSION_ONLY_ME]: "Only me",
};
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
 * Map-mode HUD: hovered chunk's owner/buildability and a claim/unclaim button; host feeds it the chunk.
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
        // Above the always-visible settings/friends buttons (9500), below toasts/dialogs.
        this.zIndex = 9600;
        this.visible = false;
        this._bottomOffset = HUD_BOTTOM_OFFSET;
        this._chunk = null;
        this._onClaim = null;
        this._onUnclaim = null;
        this._onAddFriend = null;
        this._onUnfriend = null;
        this._onSetPermission = null;
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
            style: {fontFamily: GAME_FONT, fontSize: 15, fill: PANEL_TINT_TEXT},
        });
        this._panel.addChild(this._title);
        this._panel.addChild(this._info);
        // Presses on the panel body must not fall through to the viewport (pan/tap).
        swallowClicks(this._panel);
        this.addChild(this._panel);
        this._button = null;
        this._buttonLabel = null;
        this._buttonDisabled = false;
        // Current button action; retargeting swaps it without rebuilding the button.
        this._buttonAction = null;
        // Own-chunk permission row; null while showing a chunk that isn't the own player's.
        this._permissionRow = null;
        this._permissionValue = undefined;
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
     * @param {function(chunk: number, permission: number): void} callback
     */
    onSetPermission(callback) {
        this._onSetPermission = callback;
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
     * @returns {{
     *     title: string, info: string, buttonLabel: string|null, buttonAction: function(): void|null,
     *     permission: number|null,
     * }}
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
                permission: claims.permissionOf(chunk),
            };
        }
        if (owner !== PLAYER_ID_NONE) {
            const name = this._players.usernameOf(owner);
            // Access comes from THEIR grant; the button toggles the own player's grant back.
            let info;
            if (claims.isFriendsWithMe(owner)) {
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
            return {
                title: `${name}'s chunk`,
                info,
                buttonLabel,
                buttonAction,
                permission: null,
            };
        }
        const check = claims.claimCheck(chunk);
        if (check === ClaimResult.CLAIM_RESULT_OK) {
            return {
                title: "Unclaimed chunk",
                info: "Claim it to build here",
                buttonLabel: "Claim chunk",
                buttonAction: () => this._onClaim(chunk),
                permission: null,
            };
        }
        if (check === ClaimResult.CLAIM_RESULT_LIMIT) {
            return {
                title: "Unclaimed chunk",
                info: `Chunk limit reached (${claims.maxChunks}/${claims.maxChunks})`,
                buttonLabel: "Claim chunk",
                buttonAction: null,
                permission: null,
            };
        }
        return {
            title: "Unclaimed chunk",
            info: "Must touch one of your claimed chunks",
            buttonLabel: null,
            buttonAction: null,
            permission: null,
        };
    }

    /**
     * @private
     * @returns {void}
     */
    _rebuild() {
        const {title, info, buttonLabel, buttonAction, permission} = this._content();
        this._title.text = title;
        this._info.text = info;
        this._refreshPermissionRow(permission);
        this._refreshButton(buttonLabel, buttonAction);

        const rowWidth = this._permissionRow === null ? 0 : this._permissionRow.width;
        const buttonWidth = this._button === null ? 0 : this._button.width;
        const contentWidth = Math.max(MIN_WIDTH, this._title.width, this._info.width, rowWidth, buttonWidth);
        const width = contentWidth + (PADDING_X + FRAME_MARGIN) * 2;
        let height = FRAME_MARGIN + TITLE_ROW_HEIGHT + PADDING_Y + this._info.height + PADDING_Y + FRAME_MARGIN;
        if (this._permissionRow !== null) {
            height += BUTTON_GAP + BUTTON_HEIGHT;
        }
        if (this._button !== null) {
            height += BUTTON_GAP + BUTTON_HEIGHT;
        }
        this._rebuildBackground(width, height);

        this._title.x = TITLE_PADDING_X;
        this._title.y = FRAME_MARGIN + (TITLE_ROW_HEIGHT - this._title.height) / 2;
        this._info.x = FRAME_MARGIN + PADDING_X;
        this._info.y = FRAME_MARGIN + TITLE_ROW_HEIGHT + PADDING_Y;
        let nextY = this._info.y + this._info.height;
        if (this._permissionRow !== null) {
            nextY += BUTTON_GAP;
            this._permissionRow.x = (width - this._permissionRow.width) / 2;
            this._permissionRow.y = nextY;
            nextY += BUTTON_HEIGHT;
        }
        if (this._button !== null) {
            nextY += BUTTON_GAP;
            this._button.x = (width - this._button.width) / 2;
            this._button.y = nextY;
        }
        this._layout();
        this.visible = true;
    }

    /**
     * Retargets the permission row; no-op if unchanged, drops on null (not own chunk).
     * @private
     * @param {number|null} permission
     * @returns {void}
     */
    _refreshPermissionRow(permission) {
        if (permission === this._permissionValue) {
            return;
        }
        this._permissionValue = permission;
        if (this._permissionRow !== null) {
            this._panel.removeChild(this._permissionRow);
            this._permissionRow.destroy({children: true});
            this._permissionRow = null;
        }
        if (permission === null) {
            return;
        }
        this._permissionRow = this._buildPermissionRow(permission);
        this._panel.addChild(this._permissionRow);
    }

    /**
     * A row of one button per {@link PERMISSION_ORDER} entry; the active one is accent-bordered,
     * tapping any of them sets that permission.
     * @private
     * @param {number} current
     * @returns {Container}
     */
    _buildPermissionRow(current) {
        const options = PERMISSION_ORDER.map(value => ({value, label: PERMISSION_LABELS[value]}));
        return buildToggleRow(this.textureRegistry, options, current, value => this._onSetPermission(this._chunk, value),
            {activeTint: ACTIVE_ACCENT, inactiveTint: PANEL_BORDER, gap: SEGMENT_GAP});
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
        const insetHeight = height - FRAME_MARGIN - TITLE_ROW_HEIGHT - FRAME_MARGIN;
        const insetPosition = {x: FRAME_MARGIN, y: FRAME_MARGIN + TITLE_ROW_HEIGHT};
        this._inset = UIPanel.rebuildInset(this._panel, this._inset, this.textureRegistry,
            width - FRAME_MARGIN * 2, insetHeight, PANEL_TINT, insetPosition);
        this._frame = UIPanel.rebuildFrame(this._panel, this._frame, this.textureRegistry, width, height, PANEL_TINT);

        // Trailing decorative pattern filling the title row past the title text.
        const patternX = TITLE_PADDING_X + this._title.width + TITLE_GAP;
        const patternWidth = Math.max(width - FRAME_MARGIN - PADDING_X - patternX, 0);
        const patternPosition = {x: patternX, y: FRAME_MARGIN + (TITLE_ROW_HEIGHT - PATTERN_HEIGHT) / 2};
        this._pattern = UIPanel.rebuildPattern(this._panel, this._pattern, this.textureRegistry,
            patternWidth, PATTERN_HEIGHT, patternPosition, 2);
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
