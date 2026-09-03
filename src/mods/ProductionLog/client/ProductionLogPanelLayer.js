import {
    Container,
    ManagedPanel,
    UIPanel,
    IconPicker,
    IconPickerEntry,
    PanelStack,
    PanelRowDescriptor,
    ScrollView,
    buildPanelButton,
    buildToggleRow,
    panelText,
    TextRole,
    PANEL_TINT,
    PANEL_TITLE_TEXT,
    PANEL_BORDER,
    ACTIVE_ACCENT,
    SUCCESS_TEXT,
    scaleColor,
    formatCount,
    formatExactCount,
} from "@spup/sdk/client";
import {LEADERBOARD_PAGE_SIZE} from "../common/constants.js";
import {LogView, ItemBoardView} from "./views.js";

const PANEL_WIDTH = 460;
const ICON_CELL_SIZE = 60;
const PICKER_VISIBLE_ROWS = 3;
const BOARD_VISIBLE_ROWS = 10;
// The categories scroll past this share of the screen, keeping the whole panel on a short one.
const CATEGORIES_HEIGHT_FRACTION = 0.5;
const TOGGLE_GAP = 4;
// Unproduced items keep their shape at a fraction of their brightness.
const UNPRODUCED_BRIGHTNESS = 0.3;

/**
 * The production log panel: a player's log (every item by category, produced ones lit and
 * labeled with their count or rank) or a leaderboard, with a history of the views walked through
 * and a Back button along it.
 */
export class ProductionLogPanelLayer extends Container {

    /**
     * @param {Application} app
     * @param {ClientCache} cache
     * @param {ModRegistry} modRegistry
     * @param {HoverTooltip} tooltip
     */
    constructor(app, cache, modRegistry, tooltip) {
        super();
        this._app = app;
        this._cache = cache;
        this._writer = cache.writer("productionLog");
        this._items = modRegistry.items;
        this._categories = modRegistry.itemCategories;
        this._players = cache.view("players");
        this._claims = cache.view("chunkClaims");
        this._tooltip = tooltip;
        this.textureRegistry = null;
        this.anchorButton = null;
        this.visible = false;
        this._managed = new ManagedPanel();
        /**
         * The views walked through, the last one on screen.
         * @type {Array<LogView|ItemBoardView>}
         */
        this._history = [];
        this._showRank = false;
        this._unbinds = [];
    }

    /**
     * Opens the own log, or closes the panel when open.
     * @returns {void}
     */
    toggle() {
        if (this.visible) {
            this.hide();
            return;
        }
        this.showFor(this._claims.ownPlayerId);
    }

    /**
     * Opens the panel on a player's log, starting a fresh history.
     * @param {number} playerId
     * @returns {void}
     */
    showFor(playerId) {
        this._history = [new LogView(playerId)];
        this._enter();
    }

    /**
     * Re-asks for the own log when it is the one on screen.
     * @returns {void}
     */
    refreshOwn() {
        const view = this._current();
        if (this.visible && view instanceof LogView && view.playerId === this._claims.ownPlayerId) {
            this._writer.requestLog(view.playerId);
        }
    }

    /**
     * @returns {void}
     */
    hide() {
        if (!this.visible) {
            return;
        }
        this.visible = false;
        for (const unbind of this._unbinds) {
            unbind();
        }
        this._unbinds = [];
        this._managed.hide();
    }

    /**
     * Repaints for the current theme.
     * @returns {void}
     */
    restyle() {
        if (this.visible) {
            this._build();
        }
    }

    /**
     * @private
     * @returns {LogView|ItemBoardView}
     */
    _current() {
        return this._history[this._history.length - 1];
    }

    /**
     * @private
     * @param {LogView|ItemBoardView} view
     * @returns {void}
     */
    _push(view) {
        this._history.push(view);
        this._enter();
    }

    /**
     * @private
     * @returns {void}
     */
    _back() {
        this._history.pop();
        this._enter();
    }

    /**
     * Requests the current view's data and shows it.
     * @private
     * @returns {void}
     */
    _enter() {
        this._request();
        if (!this.visible) {
            this.visible = true;
            this._unbinds = [
                this._cache.subscribe("productionLog.log", () => this._build()),
                this._cache.subscribe("productionLog.itemBoard", () => this._build()),
            ];
        }
        this._build();
    }

    /**
     * @private
     * @returns {void}
     */
    _request() {
        const view = this._current();
        if (view instanceof LogView) {
            this._writer.requestLog(view.playerId);
            return;
        }
        this._writer.requestItemBoard(view.itemType, view.offset);
    }

    /**
     * @private
     * @returns {string}
     */
    _title() {
        const view = this._current();
        if (!(view instanceof LogView)) {
            return "Leaderboard";
        }
        if (view.playerId === this._claims.ownPlayerId) {
            return "Production log";
        }
        return `${this._players.usernameOf(view.playerId)}'s log`;
    }

    /**
     * @private
     * @returns {void}
     */
    _build() {
        const width = UIPanel.fitWidth(this._app, PANEL_WIDTH);
        const panel = this._managed.show({
            app: this._app,
            textureRegistry: this.textureRegistry,
            title: this._title(),
            titleColor: PANEL_TITLE_TEXT,
            tint: PANEL_TINT,
            width,
            onClose: () => this.hide(),
        }, UIPanel.anchoredPosition(this._app, this.anchorButton, width), (stack) => {
            const view = this._current();
            if (view instanceof LogView) {
                this._buildLogBody(stack, view);
            } else {
                this._buildBoardBody(stack, view);
            }
        });
        this.addChild(panel);
    }

    /**
     * @private
     * @returns {Container}
     */
    _buildBackButton() {
        return buildPanelButton(this.textureRegistry, "Back", PANEL_BORDER, () => this._back(), this._history.length === 1);
    }

    /**
     * @private
     * @param {PanelStack} stack
     * @param {LogView} view
     * @returns {void}
     */
    _buildLogBody(stack, view) {
        const {counts, ranks} = this._logOf(view.playerId);
        const total = this._categories.reduce((sum, category) => sum + Object.keys(category.items).length, 0);
        stack.row((row) => {
            row.pushLeft(this._buildBackButton());
            row.pushRight(buildToggleRow(
                this.textureRegistry,
                [{value: false, label: "Count"}, {value: true, label: "Rank"}],
                this._showRank,
                (value) => {
                    this._showRank = value;
                    this._build();
                },
                {activeTint: ACTIVE_ACCENT, inactiveTint: PANEL_BORDER, gap: TOGGLE_GAP},
            ));
        });
        stack.text(`${counts.size}/${total} items`);
        stack.gap();
        const categories = new PanelStack(this.textureRegistry, ScrollView.contentWidthFor(stack.contentWidth));
        for (const category of this._categories) {
            this._buildCategoryHeader(categories, category, counts);
            const picker = this._buildPicker(categories.contentWidth, category, counts, ranks);
            categories.block(picker, picker.pickerHeight);
            categories.gap();
        }
        const visibleHeight = Math.min(categories.contentHeight, this._app.screen.height * CATEGORIES_HEIGHT_FRACTION);
        const scrollView = new ScrollView(this.textureRegistry, stack.contentWidth, visibleHeight);
        scrollView.content.addChild(categories);
        scrollView.setContentHeight(categories.contentHeight);
        stack.block(scrollView, visibleHeight);
    }

    /**
     * The last log answer's counts and ranks when it is this player's, empty while still loading.
     * @private
     * @param {number} playerId
     * @returns {{counts: Map<number, number>, ranks: Map<number, number>}}
     */
    _logOf(playerId) {
        const log = this._cache.get("productionLog.log");
        const counts = new Map();
        const ranks = new Map();
        if (log !== null && log.playerId === playerId) {
            for (let i = 0; i < log.itemTypes.length; i += 1) {
                counts.set(log.itemTypes[i], log.counts[i]);
                ranks.set(log.itemTypes[i], log.ranks[i]);
            }
        }
        return {counts, ranks};
    }

    /**
     * The category's name and discovered count, both green once every item is.
     * @private
     * @param {PanelStack} stack
     * @param {ItemCategory} category
     * @param {Map<number, number>} counts
     * @returns {void}
     */
    _buildCategoryHeader(stack, category, counts) {
        const itemTypes = Object.keys(category.items).map(Number);
        const discovered = itemTypes.filter((itemType) => counts.has(itemType)).length;
        const caption = panelText(`${discovered}/${itemTypes.length}`, TextRole.CAPTION);
        const header = stack.headerRow(category.name, (row) => {
            row.pushLeft(caption);
        });
        if (discovered === itemTypes.length) {
            header.style.fill = SUCCESS_TEXT;
            caption.style.fill = SUCCESS_TEXT;
            caption.alpha = 1;
        }
    }

    /**
     * @private
     * @param {number} width
     * @param {ItemCategory} category
     * @param {Map<number, number>} counts
     * @param {Map<number, number>} ranks
     * @returns {IconPicker}
     */
    _buildPicker(width, category, counts, ranks) {
        const entries = [];
        for (const [key, definition] of Object.entries(category.items)) {
            const itemType = Number(key);
            const count = counts.get(itemType);
            if (count === undefined) {
                entries.push(new IconPickerEntry(itemType, definition.texture, {
                    tint: scaleColor(definition.tint, UNPRODUCED_BRIGHTNESS),
                    tooltipText: definition.name,
                }));
            } else {
                entries.push(new IconPickerEntry(itemType, definition.texture, {
                    tint: definition.tint,
                    label: this._cellLabel(count, ranks.get(itemType)),
                    tooltipText: `${definition.name}\n${formatExactCount(count)}`,
                }));
            }
        }
        return new IconPicker(this.textureRegistry, width, entries, (itemType) => {
            let rank = ranks.get(itemType);
            if (rank === undefined) {
                rank = 0;
            }
            this._push(new ItemBoardView(itemType, rank));
        }, {
            columns: IconPicker.columnsFor(width, ICON_CELL_SIZE),
            visibleRows: PICKER_VISIBLE_ROWS,
            cellSize: ICON_CELL_SIZE,
            onHover: (itemType, cell) => this._hover(itemType, cell),
        });
    }

    /**
     * @private
     * @param {number} count
     * @param {number} rank
     * @returns {string}
     */
    _cellLabel(count, rank) {
        if (this._showRank) {
            return `#${rank}`;
        }
        return formatCount(count);
    }

    /**
     * @private
     * @param {number|null} itemType
     * @param {Container} cell
     * @returns {void}
     */
    _hover(itemType, cell) {
        if (itemType === null) {
            this._tooltip.clearTarget(cell);
            return;
        }
        this._tooltip.setTarget(cell);
    }

    /**
     * @private
     * @param {PanelStack} stack
     * @param {ItemBoardView} view
     * @returns {void}
     */
    _buildBoardBody(stack, view) {
        const board = this._boardOf(view);
        stack.row((row) => {
            row.pushLeft(this._buildBackButton());
        });
        stack.header(this._items.require(view.itemType).name);
        const ownPlayerId = this._claims.ownPlayerId;
        const rows = [];
        if (board !== null) {
            for (let i = 0; i < board.playerIds.length; i += 1) {
                rows.push({rank: view.offset + i + 1, playerId: board.playerIds[i], score: board.scores[i]});
            }
        }
        stack.scrollSection(rows, (row) => new PanelRowDescriptor({
            label: `#${row.rank} ${this._players.usernameOf(row.playerId)}`,
            rightLabel: formatExactCount(row.score),
            selected: row.playerId === ownPlayerId,
            onRowClick: () => this._push(new LogView(row.playerId)),
        }), "Nobody ranked yet", {visibleRows: BOARD_VISIBLE_ROWS, centerRow: view.focusRow});
        stack.gap();
        stack.text(this._rankLabel(board));
        const lastPage = board === null || view.offset + LEADERBOARD_PAGE_SIZE >= board.total;
        stack.row((row) => {
            row.pushLeft(buildPanelButton(this.textureRegistry, "Previous", PANEL_BORDER, () => this._turnPage(view, -LEADERBOARD_PAGE_SIZE), view.offset === 0));
            row.pushRight(buildPanelButton(this.textureRegistry, "Next", PANEL_BORDER, () => this._turnPage(view, LEADERBOARD_PAGE_SIZE), lastPage));
        });
    }

    /**
     * The last answer for a board, or null while still loading.
     * @private
     * @param {ItemBoardView} view
     * @returns {ItemLeaderboardEvent|null}
     */
    _boardOf(view) {
        const board = this._cache.get("productionLog.itemBoard");
        if (board === null || board.itemType !== view.itemType) {
            return null;
        }
        return board;
    }

    /**
     * @private
     * @param {ItemLeaderboardEvent|null} board
     * @returns {string}
     */
    _rankLabel(board) {
        if (board === null) {
            return "Loading";
        }
        if (board.requesterRank === 0) {
            return "You are unranked";
        }
        return `Your rank: ${board.requesterRank} of ${board.total}`;
    }

    /**
     * @private
     * @param {ItemBoardView} view
     * @param {number} delta
     * @returns {void}
     */
    _turnPage(view, delta) {
        view.offset += delta;
        this._enter();
    }
}
