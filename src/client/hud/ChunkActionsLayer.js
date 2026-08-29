import {Container} from "pixi.js";
import {TILE_SIZE} from "@/client/constants.js";
import {CHUNK_SIZE, PLAYER_ID_NONE} from "@/common/constants.js";
import {chunkOrigin} from "@/common/util.js";
import {ClaimResult, ChunkPermission} from "@/common/ClaimEvents.js";
import {ACTIVE_ACCENT, PANEL_BORDER} from "@/client/Theme.js";
import {buildPanelButton, buildToggleRow, hotkeyLabel} from "@/client/hud/panelButton.js";
import {swallowClicks} from "@/client/layers/pixiUtils.js";
import {PANEL_SCREEN_MARGIN} from "@/client/hud/UIPanel.js";

// Key hint on the Claim button, matching the shift-click shortcut.
const CLAIM_SHORTCUT_HINT = "Shift+🖰";
// Vertical gap between stacked rows.
const ROW_GAP = 8;
// Gap between the permission row's segments.
const SEGMENT_GAP = 4;

// Left to right, the own-chunk permission row's segments.
const PERMISSION_ORDER = [
    ChunkPermission.PERMISSION_FRIENDS,
    ChunkPermission.PERMISSION_ONLY_ME,
];
const PERMISSION_LABELS = {
    [ChunkPermission.PERMISSION_FRIENDS]: "Friends",
    [ChunkPermission.PERMISSION_ONLY_ME]: "Only me",
};

/**
 * The selected chunk's action stack: claim/unclaim/friend/permission buttons centered inside the
 * chunk itself, following it through pan and zoom. The chunk's status text is not here — the
 * host surfaces {@link ChunkActionsLayer#statusText} in the bottom action bar.
 */
export class ChunkActionsLayer extends Container {

    /**
     * @param {Application} app
     * @param {ClientViewport} viewport
     * @param {ChunkClaimsView} claims
     * @param {PlayersView} players
     */
    constructor(app, viewport, claims, players) {
        super();
        this._app = app;
        this._viewport = viewport;
        this._claims = claims;
        this._players = players;
        this.textureRegistry = null;
        this.visible = false;
        this._chunk = null;
        this._statusText = null;
        // The stack's size, measured once per rebuild: pixi's width/height getters walk the
        // subtree, and _layout runs every frame.
        this._stackWidth = 0;
        this._stackHeight = 0;
        this._onClaim = null;
        this._onUnclaim = null;
        this._onAddFriend = null;
        this._onUnfriend = null;
        this._onSetPermission = null;
        this._stack = new Container();
        // Presses on the stack must not fall through to the viewport (pan/tap).
        swallowClicks(this._stack);
        this.addChild(this._stack);
        app.ticker.add(() => this._layout());
    }

    /**
     * The selected chunk's status line for the bottom bar; null without a selection.
     * @returns {string|null}
     */
    get statusText() {
        return this._statusText;
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
     * Shows (or retargets) the stack for a chunk; hover re-enters on the same chunk are free.
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
        this._statusText = null;
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
     * Repaints for the current theme.
     * @returns {void}
     */
    restyle() {
        this.refresh();
    }

    /**
     * The stack's rows and status line for the current chunk.
     * @private
     * @returns {{status: string, rows: Container[]}}
     */
    _content() {
        const chunk = this._chunk;
        const claims = this._claims;
        const owner = claims.ownerOf(chunk);
        if (owner !== PLAYER_ID_NONE && owner === claims.ownPlayerId) {
            return {
                status: "Your chunk. You can build here",
                rows: [
                    this._buildPermissionRow(claims.permissionOf(chunk)),
                    this._buildButton("Unclaim chunk", () => this._onUnclaim(chunk)),
                ],
            };
        }
        if (owner !== PLAYER_ID_NONE) {
            const name = this._players.usernameOf(owner);
            // Access comes from THEIR grant; the button toggles the own player's grant back.
            let status;
            if (claims.isFriendsWithMe(owner)) {
                status = `${name}'s chunk. ${name} lets you build here`;
            } else {
                status = `${name}'s chunk. You cannot build here`;
            }
            let row;
            if (claims.isFriend(owner)) {
                row = this._buildButton(`Unfriend ${name}`, () => this._onUnfriend(owner));
            } else {
                row = this._buildButton(`Add friend ${name}`, () => this._onAddFriend(owner));
            }
            return {status, rows: [row]};
        }
        const check = claims.claimCheck(chunk);
        if (check === ClaimResult.CLAIM_RESULT_OK) {
            const label = hotkeyLabel("Claim", CLAIM_SHORTCUT_HINT);
            return {
                status: "Unclaimed chunk. Claim it to build here",
                rows: [this._buildButton(label, () => this._onClaim(chunk))],
            };
        }
        if (check === ClaimResult.CLAIM_RESULT_LIMIT) {
            return {
                status: `Chunk limit reached (${claims.maxChunks}/${claims.maxChunks})`,
                rows: [],
            };
        }
        return {
            status: "Must touch one of your claimed chunks",
            rows: [],
        };
    }

    /**
     * @private
     * @returns {void}
     */
    _rebuild() {
        if (this.textureRegistry === null) {
            return;
        }
        const {status, rows} = this._content();
        this._statusText = status;
        for (const child of [...this._stack.children]) {
            child.destroy({children: true});
        }
        const width = rows.reduce((max, row) => Math.max(max, row.width), 0);
        let y = 0;
        for (const row of rows) {
            row.x = (width - row.width) / 2;
            row.y = y;
            y += row.height + ROW_GAP;
            this._stack.addChild(row);
        }
        this._stackWidth = width;
        this._stackHeight = Math.max(y - ROW_GAP, 0);
        this.visible = true;
        this._layout();
    }

    /**
     * A rounded accent-bordered button firing `action` on tap.
     * @private
     * @param {string} label
     * @param {function(): void} action
     * @returns {Container}
     */
    _buildButton(label, action) {
        return buildPanelButton(this.textureRegistry, label, ACTIVE_ACCENT, action);
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
        return buildToggleRow(this.textureRegistry, options, current,
            value => this._onSetPermission(this._chunk, value),
            {activeTint: ACTIVE_ACCENT, inactiveTint: PANEL_BORDER, gap: SEGMENT_GAP});
    }

    /**
     * Centers the stack inside the chunk's screen rect every frame, clamped on-screen.
     * @private
     * @returns {void}
     */
    _layout() {
        if (!this.visible || this._chunk === null || this._stack.children.length === 0) {
            return;
        }
        const origin = chunkOrigin(this._chunk);
        const center = this._viewport.toScreen(
            (origin.x + CHUNK_SIZE / 2) * TILE_SIZE,
            (origin.y + CHUNK_SIZE / 2) * TILE_SIZE,
        );
        const width = this._stackWidth;
        const height = this._stackHeight;
        const screen = this._app.screen;
        let x = center.x - width / 2;
        x = Math.min(Math.max(x, PANEL_SCREEN_MARGIN), screen.width - width - PANEL_SCREEN_MARGIN);
        let y = center.y - height / 2;
        y = Math.min(Math.max(y, PANEL_SCREEN_MARGIN), screen.height - height - PANEL_SCREEN_MARGIN);
        this._stack.x = Math.round(x);
        this._stack.y = Math.round(y);
    }
}
