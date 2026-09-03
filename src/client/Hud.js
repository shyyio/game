import {InspectPanelLayer} from "@/client/hud/InspectPanelLayer.js";
import {RotateButtonsLayer} from "@/client/hud/RotateButtonsLayer.js";
import {ToolbarLayer} from "@/client/hud/ToolbarLayer.js";
import {NoticeLayer} from "@/client/hud/NoticeLayer.js";
import {ConfirmDialogLayer} from "@/client/hud/ConfirmDialogLayer.js";
import {PopoverHost} from "@/client/hud/PopoverHost.js";
import {PanelHost} from "@/client/hud/PanelHost.js";
import {CounterListLayer} from "@/client/hud/CounterListLayer.js";
import {HoverTooltip, TooltipSide} from "@/client/hud/HoverTooltip.js";
import {HudLayer} from "@/client/hud/HudLayer.js";
import {StatusMessageLayer} from "@/client/hud/StatusMessageLayer.js";
import {VersionWatermarkLayer} from "@/client/hud/VersionWatermarkLayer.js";
import {TopStatusBarLayer} from "@/client/hud/TopStatusBarLayer.js";
import {BottomActionBarLayer} from "@/client/hud/BottomActionBarLayer.js";
import {SettingsButtonLayer} from "@/client/hud/SettingsButtonLayer.js";
import {FriendsButtonLayer} from "@/client/hud/FriendsButtonLayer.js";
import {ProductionButtonLayer} from "@/client/hud/ProductionButtonLayer.js";
import {ArtButtonLayer} from "@/client/hud/ArtButtonLayer.js";
import {TerrainButtonLayer} from "@/client/hud/TerrainButtonLayer.js";
import {ProductionPanelLayer} from "@/client/hud/ProductionPanelLayer.js";
import {FriendsPanelLayer} from "@/client/hud/FriendsPanelLayer.js";
import {ChunkActionsLayer} from "@/client/hud/ChunkActionsLayer.js";
import {MapButtonsLayer} from "@/client/hud/MapButtonsLayer.js";
import {InspectTooltipLayer} from "@/client/hud/InspectTooltipLayer.js";
import {drawClaimIcon, drawHomeIcon} from "@/client/hud/icons.js";
import {onUiScaleChange} from "@/client/hud/UiScale.js";
import {onThemeChange} from "@/client/Theme.js";
import SafeArea from "@/client/SafeArea.js";
import {ClaimChunkMessage, UnclaimChunkMessage, SetChunkPermissionMessage} from "@/common/ClaimMessages.js";
import {AddFriendMessage, AddFriendByCodeMessage, RemoveFriendMessage} from "@/common/PlayerMessages.js";
import {MetricsSubscribeMessage, MetricsUnsubscribeMessage} from "@/common/MetricsMessages.js";
import {METRICS_FACT_TYPE_ITEM_PRODUCED, METRICS_QUERY_SCOPE_OWN} from "@/common/MetricsFact.js";
import {ViewMode, FRIENDS_PANEL_REFRESH_THROTTLE_MS} from "@/client/constants.js";

/**
 * The toolbar is up only in world view with at least one claimed chunk: placement tools are inert
 * while zoomed to map/overworld (EffectiveToolController nulls the effective tool there), and
 * irrelevant with nothing to build on.
 * @param {boolean} hasClaims
 * @param {ViewMode} viewMode
 * @returns {boolean}
 */
export function toolbarVisible(hasClaims, viewMode) {
    return hasClaims && viewMode === ViewMode.WORLD;
}

/**
 * Where the counter list starts: under the status message, itself under whichever of the top bar
 * and the safe-area inset reaches further down.
 * @param {number} topBarHeight
 * @param {number} statusHeight
 * @param {number} safeAreaTop
 * @returns {number}
 */
export function counterListTop(topBarHeight, statusHeight, safeAreaTop) {
    return Math.max(topBarHeight, safeAreaTop) + statusHeight;
}

/**
 * @param {number} now
 * @param {number} lastRefreshMs
 * @returns {boolean} whether the throttled friend-roster rebuild is due
 */
export function friendsPanelRefreshDue(now, lastRefreshMs) {
    return now - lastRefreshMs >= FRIENDS_PANEL_REFRESH_THROTTLE_MS;
}

// pixi's default: a layer that named no band of its own.
const NO_HUD_BAND = 0;

/**
 * Where a mod's HUD layer mounts. A panel layer carries no band and takes the panel host's, ranked
 * against the other panels by press; a layer that brought its own {@link HudLayer} band (a tooltip)
 * wants that band, so it mounts on the stage beside the core layer of the same kind.
 * @param {Container} layer
 * @returns {boolean}
 */
export function mountsInPanelHost(layer) {
    return layer.zIndex === NO_HUD_BAND;
}

/**
 * Every screen-space layer: the bars, buttons, panels and overlays, their layout against each
 * other, and the repaints a theme or UI-scale change triggers.
 */
export class Hud {

    /**
     * @param {Client} client
     */
    constructor(client) {
        this._client = client;
        // Mod HUD layers, handed over once the mods have set themselves up.
        this._modLayers = [];
        this._lastFriendsPanelRefreshMs = 0;
        this._buildTools();
        this._buildStatus();
        this._buildTopBar();
        this._buildOverlays();
        this._buildChunkActions();
        this._collectThemedLayers();
        onThemeChange(() => this._restyle());
        onUiScaleChange(() => this._rescale());
    }

    /**
     * The tool-facing HUD: machine menus, rotate controls, and the tool bar.
     * @private
     * @returns {void}
     */
    _buildTools() {
        const {app, viewport, cache} = this._client;
        // Screen-space panels for open machine menus; fed by the inspect heartbeat state.
        this.inspectPanelLayer = new InspectPanelLayer(app, cache);
        // Rotate controls, toggled with the active tool by the host.
        this.rotateButtonsLayer = new RotateButtonsLayer(app, viewport);
        // Bottom-center tool bar; the host feeds it the tool list and reacts to selection.
        this.toolbarLayer = new ToolbarLayer(app, viewport);
        this.toolbarLayer.onReorder(tools => this._client.setModToolOrder(tools));
    }

    /**
     * The top-left status message and counter stack.
     * @private
     * @returns {void}
     */
    _buildStatus() {
        const {app} = this._client;
        // Top-left connection/chunk-loading status overlay. A static screen-space HUD on
        // app.stage (sibling of the viewport), so it never pans or zooms with the world.
        this.statusLayer = new StatusMessageLayer(app);
        this.statusLayer.setConnecting();
        // The top bar's height, so the counter list knows whether the bar owns the top-left corner.
        this._topBarHeight = 0;
        // The status message's height, so the counter list stacks under it rather than behind it.
        this._statusHeight = 0;
        // The hovered counter's label and exact amount.
        this.counterTooltip = new HoverTooltip(app, TooltipSide.RIGHT, HudLayer.TOOLTIP);
        // Top-left running counts (currency balance, and whatever else contributes a counter),
        // stacked under the status message and hidden while the top bar owns the edge.
        this.counterListLayer = new CounterListLayer(app, this.counterTooltip);
        this.statusLayer.onChange((height) => {
            this._statusHeight = height;
            this._layoutTopLeft();
        });
    }

    /**
     * The top bar, its corner buttons, and the panels they open.
     * @private
     * @returns {void}
     */
    _buildTopBar() {
        const {app, cache, modRegistry} = this._client;
        // Full-width top status bar: core systems and mods each own a section by id (text +
        // buttons), e.g. claim mode's claim count and exit button.
        this.topStatusBar = new TopStatusBarLayer(app);
        // Full-width bottom bar holding the active mode's forward action (its text + Confirm).
        this.bottomActionBar = new BottomActionBarLayer(app);
        // Always-visible top-right settings button; stays clear of the bar above via its height.
        this.settingsButtonLayer = new SettingsButtonLayer(app);
        // Friend management (account-wide, not gated behind claim mode); sits left of settings.
        this.friendsButtonLayer = new FriendsButtonLayer(app);
        this.friendsPanelLayer = new FriendsPanelLayer(app, cache);
        this.friendsButtonLayer.onPress(() => this.friendsPanelLayer.toggle());
        // Opens the production metrics panel; sits left of friends.
        this.productionButtonLayer = new ProductionButtonLayer(app);
        this.productionPanelLayer = new ProductionPanelLayer(
            app,
            cache,
            METRICS_FACT_TYPE_ITEM_PRODUCED,
            METRICS_QUERY_SCOPE_OWN,
            modRegistry.items,
        );
        this.productionButtonLayer.onPress(() => this.productionPanelLayer.toggle());
        // Opens the sprite editor (Game.vue owns it); sits left of production.
        this.artButtonLayer = new ArtButtonLayer(app);
        // Opens the terrain tuner (Game.vue owns it); sits left of art.
        this.terrainButtonLayer = new TerrainButtonLayer(app);
        this.productionPanelLayer.onSubscribe((metricsType, scope, tier, windowTicks) => this._client.sendMessage(
            new MetricsSubscribeMessage(metricsType, scope, tier, windowTicks),
        ));
        this.productionPanelLayer.onUnsubscribe((metricsType, scope) => this._client.sendMessage(
            new MetricsUnsubscribeMessage(metricsType, scope),
        ));
        this.friendsPanelLayer.onAddByCode(
            code => this._client.sendMessage(new AddFriendByCodeMessage(code)),
        );
        this.friendsPanelLayer.onAddFriend(playerId => this._client.sendMessage(new AddFriendMessage(playerId)));
        this.friendsPanelLayer.onUnfriend(playerId => this._client.sendMessage(new RemoveFriendMessage(playerId)));
        this.friendsPanelLayer.onError(message => this.notify(message));
        this.topStatusBar.onChange((height) => {
            // The bar's height already covers the safe area; the inset only matters while it is hidden.
            const offset = Math.max(height, SafeArea.insets().top);
            this.settingsButtonLayer.setTopOffset(offset);
            this.friendsButtonLayer.setTopOffset(offset);
            this.productionButtonLayer.setTopOffset(offset);
            this.artButtonLayer.setTopOffset(offset);
            this.terrainButtonLayer.setTopOffset(offset);
            this.statusLayer.setTopOffset(offset);
            for (const layer of this._modLayers) {
                if (layer.setTopOffset !== undefined) {
                    layer.setTopOffset(offset);
                }
            }
            this._topBarHeight = height;
            this._layoutTopLeft();
        });
    }

    /**
     * The watermark, toast, dialog, hosts, item tooltip, and map buttons.
     * @private
     * @returns {void}
     */
    _buildOverlays() {
        const {app, modRegistry, itemInspectLayer} = this._client;
        // Bottom-left build watermark (desktop only).
        this.versionWatermarkLayer = new VersionWatermarkLayer(app);
        // Bottom-center toast (claim rejections, session disconnects).
        this.noticeLayer = new NoticeLayer(app);
        // Centered confirm/cancel dialog, currently only the destructive unclaim confirm.
        this.confirmDialogLayer = new ConfirmDialogLayer(app);
        // The single host every panel's dropdowns and pickers open into.
        this.popoverHost = new PopoverHost(app);
        // The single host every panel layer mounts into, which raises the pressed one.
        this.panelHost = new PanelHost();
        // The bracketed item's name, docked above its bracket.
        this.inspectTooltipLayer = new InspectTooltipLayer(app, itemInspectLayer, modRegistry.items);
        // Contextual map-mode buttons (bottom-right): chunk administration entry and home.
        this.mapButtonsLayer = new MapButtonsLayer(app);
        this.mapButtonsLayer.addButton("claimSelection", drawClaimIcon, () => this._client.claimSelection.toggle());
        this.mapButtonsLayer.addButton("home", drawHomeIcon, () => this._client.camera.glideHome());
    }

    /**
     * The selected chunk's action stack, anchored beside the chunk (map mode).
     * @private
     * @returns {void}
     */
    _buildChunkActions() {
        const {app, viewport, cache} = this._client;
        this.chunkActionsLayer = new ChunkActionsLayer(app, viewport, cache.view("chunkClaims"), cache.view("players"));
        this.chunkActionsLayer.onClaim(chunk => this._client.sendMessage(new ClaimChunkMessage(chunk)));
        this.chunkActionsLayer.onUnclaim(chunk => this._client.sendMessage(new UnclaimChunkMessage(chunk)));
        this.chunkActionsLayer.onAddFriend(playerId => this._client.sendMessage(new AddFriendMessage(playerId)));
        this.chunkActionsLayer.onUnfriend(playerId => this._client.sendMessage(new RemoveFriendMessage(playerId)));
        this.chunkActionsLayer.onSetPermission(
            (chunk, permission) => this._client.sendMessage(new SetChunkPermissionMessage(chunk, permission)),
        );
        this.chunkActionsLayer.onPlayerActions(playerId => this._client.modPlayerActions(playerId));
    }

    /**
     * Collects the layers that repaint on a theme change.
     * @private
     * @returns {void}
     */
    _collectThemedLayers() {
        // Layers holding themed pixels; world layers draw from the non-themed placement palette.
        // A mod HUD layer opts in by defining restyle.
        this._themedLayers = [
            this.inspectPanelLayer,
            this.rotateButtonsLayer,
            this.toolbarLayer,
            this.statusLayer,
            this.counterListLayer,
            this.topStatusBar,
            this.bottomActionBar,
            this.settingsButtonLayer,
            this.friendsButtonLayer,
            this.friendsPanelLayer,
            this.productionButtonLayer,
            this.productionPanelLayer,
            this.artButtonLayer,
            this.terrainButtonLayer,
            this.noticeLayer,
            this.confirmDialogLayer,
            this.mapButtonsLayer,
            this.chunkActionsLayer,
            this.inspectTooltipLayer,
            this.counterTooltip,
        ];
    }

    /**
     * Adopts the client mods' own HUD layers, which mount and repaint with the rest.
     * @param {HudLayer[]} layers
     * @returns {void}
     */
    addModLayers(layers) {
        this._modLayers = layers;
        this._themedLayers.push(...layers.filter(layer => layer.restyle !== undefined));
    }

    /**
     * Shows a toast notice (claim rejections, session disconnects).
     * @param {string} text
     * @returns {void}
     */
    notify(text) {
        this.noticeLayer.notify(text);
    }

    /**
     * Shows the toolbar only in world view with at least one claimed chunk: placement tools are
     * inert while zoomed to map/overworld (EffectiveToolController nulls the effective tool
     * there), and irrelevant with nothing to build on.
     * @returns {void}
     */
    refreshToolbarVisibility() {
        const hasClaims = this._client.cache.view("chunkClaims").hasOwnClaims();
        this.toolbarLayer.visible = toolbarVisible(hasClaims, this._client.viewMode.current);
    }

    /**
     * Rebuilds the nearby-in-view friend roster, which reads the viewport directly: the claims
     * mirror it draws from may already hold every chunk in the new view, so no cache event would
     * otherwise tell it to recompute. Throttled because "moved" fires on every step of a drag, and
     * a rebuild tears down and recreates the add-by-name field's real DOM input.
     * @returns {void}
     */
    viewportMoved() {
        const now = Date.now();
        if (friendsPanelRefreshDue(now, this._lastFriendsPanelRefreshMs)) {
            this._lastFriendsPanelRefreshMs = now;
            this.friendsPanelLayer.refresh();
        }
    }

    /**
     * Hands every layer its textures, then stacks them onto the stage in painting order.
     * @returns {void}
     */
    mount() {
        const {app, viewport, textureRegistry, modRegistry} = this._client;
        this.toolbarLayer.textureRegistry = textureRegistry;
        this.inspectPanelLayer.textureRegistry = textureRegistry;
        this.inspectPanelLayer.items = modRegistry.items;
        this.inspectPanelLayer.viewport = viewport;
        this.inspectPanelLayer.onClose(objectId => this._client.unInspectObject(objectId));
        this.statusLayer.textureRegistry = textureRegistry;
        this.statusLayer.refreshBackground();
        this._layoutTopLeft();
        this.topStatusBar.textureRegistry = textureRegistry;
        this.topStatusBar.refreshBackground();
        this.bottomActionBar.textureRegistry = textureRegistry;
        this.bottomActionBar.refreshBackground();
        this.noticeLayer.textureRegistry = textureRegistry;
        this.confirmDialogLayer.textureRegistry = textureRegistry;
        this.chunkActionsLayer.textureRegistry = textureRegistry;
        // A chunk can be selected before the textures land, which skips the stack's build.
        this.chunkActionsLayer.refresh();
        this.friendsPanelLayer.textureRegistry = textureRegistry;
        this.friendsPanelLayer.viewport = viewport;
        this.friendsPanelLayer.anchorButton = this.friendsButtonLayer;
        this.productionPanelLayer.textureRegistry = textureRegistry;
        this.productionPanelLayer.anchorButton = this.productionButtonLayer;
        app.stage.addChild(this.versionWatermarkLayer);
        app.stage.addChild(this._client.centerLock.markerLayer);
        app.stage.addChild(this.mapButtonsLayer);
        app.stage.addChild(this.rotateButtonsLayer);
        app.stage.addChild(this.toolbarLayer);
        app.stage.addChild(this.statusLayer);
        app.stage.addChild(this.counterListLayer);
        app.stage.addChild(this.counterTooltip);
        app.stage.addChild(this.topStatusBar);
        app.stage.addChild(this.bottomActionBar);
        this.inspectTooltipLayer.viewport = viewport;
        app.stage.addChild(this.inspectTooltipLayer);
        app.stage.addChild(this.settingsButtonLayer);
        app.stage.addChild(this.friendsButtonLayer);
        app.stage.addChild(this.productionButtonLayer);
        app.stage.addChild(this.artButtonLayer);
        app.stage.addChild(this.terrainButtonLayer);
        // Panels sit above every other HUD layer, and are ranked against each other by the host.
        this.panelHost.add(this.chunkActionsLayer);
        this.panelHost.add(this.inspectPanelLayer);
        this.panelHost.add(this.friendsPanelLayer);
        this.panelHost.add(this.productionPanelLayer);
        for (const layer of this._modLayers) {
            layer.textureRegistry = textureRegistry;
            layer.viewport = viewport;
            layer.popovers = this.popoverHost;
            if (mountsInPanelHost(layer)) {
                this.panelHost.add(layer);
            } else {
                app.stage.addChild(layer);
            }
        }
        app.stage.addChild(this.panelHost);
        // Popovers clear the panels that open them; toast and confirm dialog clear everything.
        app.stage.addChild(this.popoverHost);
        app.stage.addChild(this.noticeLayer);
        app.stage.addChild(this.confirmDialogLayer);
    }

    /**
     * Stacks the counter list under the status message, and stands it down while the top bar
     * owns the top edge.
     * @private
     * @returns {void}
     */
    _layoutTopLeft() {
        const top = counterListTop(this._topBarHeight, this._statusHeight, SafeArea.insets().top);
        this.counterListLayer.setTopOffset(top, this._topBarHeight > 0);
    }

    /**
     * Repaints every themed layer after a palette swap.
     * @private
     * @returns {void}
     */
    _restyle() {
        for (const layer of this._themedLayers) {
            layer.restyle();
        }
    }

    /**
     * Repaints and relays out the HUD at a new UI scale. The sizes every layer lays out against
     * changed, which is what a resize means to them.
     * @private
     * @returns {void}
     */
    _rescale() {
        const {app} = this._client;
        this._restyle();
        app.renderer.emit("resize", app.screen.width, app.screen.height);
    }

}
