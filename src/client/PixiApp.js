import {Application, Graphics, Container, FillGradient} from "pixi.js";
import {ClientViewport} from "@/client/ClientViewport.js";
import Mouse from "@/client/input/Mouse.js";
import Fullscreen from "@/client/Fullscreen.js";
import WindowFocus from "@/client/WindowFocus.js";
import Mobile from "@/client/Mobile.js";
import {MobileTouchInput} from "@/client/input/MobileTouchInput.js";
import {GAME_FONT, MIN_VIEWPORT_SCALE} from "@/client/constants.js";

const gameWidth = () => window.innerWidth;
const gameHeight = () => window.innerHeight + 64;

function createShadowOverlay(width, height) {
    const container = new Container();
    // Decorative only; an "auto" full-screen overlay would swallow viewport hits.
    container.eventMode = "none";

    const leftGradient = new FillGradient({
        type: "linear",
        start: {x: 0, y: 0},
        end: {x: 1, y: 0},
        colorStops: [
            {offset: 0, color: "0x00000011"},
            {offset: 0.9, color: "0x00000000"},
        ],
    });

    const rightGradient = new FillGradient({
        type: "linear",
        start: {x: 0, y: 0},
        end: {x: 1, y: 0},
        colorStops: [
            {offset: 0.9, color: "0x00000000"},
            {offset: 1, color: "0x00000011"},
        ],
    });

    container.addChild(
        new Graphics()
            .rect(0, 0, width, height)
            .fill(leftGradient)
    );

    container.addChild(
        new Graphics()
            .rect(0, 0, width, height)
            .fill(rightGradient)
    );

    return container;
}

/**
 * Boots the pixi Application and world viewport: canvas mount, resize handling, drag/wheel/zoom,
 * and live touch-input toggling off the "Touchscreen input" device setting.
 * @returns {Promise<{app: Application, viewport: ClientViewport, syncMobileTouchInput: function(): void, destroy: function(): void}>}
 */
export async function createPixiApp() {
    const app = new Application();

    await app.init({
        background: "#f5f0e6",
        resolution: window.devicePixelRatio,
        resizeTo: window,
        autoDensity: true,
        roundPixels: true
    });

    // The whole game runs at a fixed 24fps, so one ticker tick is exactly one
    // animation frame (see animation.js).
    app.ticker.maxFPS = 24;

    // Load the game font before pixi rasterizes any text; a Text drawn before the face
    // is ready caches at the fallback and never re-rasterizes on its own.
    await document.fonts.load(`1em ${GAME_FONT}`);

    const viewport = new ClientViewport({
        screenWidth: gameWidth(),
        screenHeight: gameHeight(),
        worldWidth: gameWidth(),
        worldHeight: gameHeight(),
        events: app.renderer.events,
        threshold: 20,
        // Drags ride globalpointermove: crossing the HUD or leaving the canvas keeps the pan alive.
        allowPreserveDragOutside: true,
    });

    // The world's transform is the one thing that changes every pan and zoom frame. As a render
    // group the viewport carries it as a group matrix applied on the GPU, instead of pixi walking
    // every layer and sprite under it to re-derive world transforms.
    viewport.enableRenderGroup();

    app.stage.addChild(viewport);

    let overlay = createShadowOverlay(gameWidth(), gameHeight());
    app.stage.addChild(overlay);

    function handleResize() {
        viewport.resize(gameWidth(), gameHeight(), gameWidth(), gameHeight());

        app.stage.removeChild(overlay);
        overlay.destroy();
        overlay = createShadowOverlay(gameWidth(), gameHeight());
        app.stage.addChild(overlay);
    }

    const onWindowResize = () => {
        handleResize();
    };
    window.addEventListener("resize", onWindowResize);
    // Window resize fires before fullscreen dimensions are real; the visual-viewport resize
    // re-runs the sizing afterward.
    const onVisualViewportResize = () => {
        app.resize();
        handleResize();
    };
    if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", onVisualViewportResize);
    }

    viewport
        // wheel: false — drag's wheel-pan fallback would pan the world while freezeZoom pauses
        // the wheel plugin over a scrollable HUD list.
        .drag({wheel: false})
        .wheel()
        .clampZoom({
            maxScale: 2,
            minScale: MIN_VIEWPORT_SCALE
        });

    // Live-toggled by the "Touchscreen input" device setting: adds/removes the pinch plugin and the
    // HUD-touch routing glue instead of only reading Mobile.enabled once at mount.
    let touchInput = null;
    const syncMobileTouchInput = () => {
        if (Mobile.enabled) {
            if (touchInput === null) {
                viewport.pinch();
                touchInput = new MobileTouchInput(app, viewport);
                touchInput.install();
            }
            return;
        }
        if (touchInput !== null) {
            viewport.plugins.remove("pinch");
            touchInput.uninstall();
            touchInput = null;
        }
    };
    syncMobileTouchInput();

    Fullscreen.install();

    Mouse.init(app, viewport);
    WindowFocus.init();

    document.getElementById("game").appendChild(app.canvas);

    /**
     * Reverses everything above: touch-input glue, window listeners, and the pixi Application
     * itself (which recursively destroys the viewport, its plugins, and every HUD layer mounted
     * under app.stage).
     * @returns {void}
     */
    function destroy() {
        if (touchInput !== null) {
            touchInput.uninstall();
            touchInput = null;
        }
        window.removeEventListener("resize", onWindowResize);
        if (window.visualViewport) {
            window.visualViewport.removeEventListener("resize", onVisualViewportResize);
        }
        Mouse.reset();
        app.destroy({removeView: true}, {children: true});
    }

    return {app, viewport, syncMobileTouchInput, destroy};
}
