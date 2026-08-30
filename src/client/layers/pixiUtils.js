import {CanvasTextMetrics, Container, Graphics, NineSliceSprite} from "pixi.js";
import {PANEL_FILL, PANEL_FILL_ALPHA, PANEL_BORDER, PANEL_HOVER_FILL} from "@/client/Theme.js";
import {TapRecognizer} from "@/client/input/TapRecognizer.js";

/**
 * A NineSliceSprite of `name` at the given on-screen size, with equal edge insets per axis.
 * @param {TextureRegistry} textureRegistry
 * @param {string} name
 * @param {number} insetX
 * @param {number} insetY
 * @param {number} width
 * @param {number} height
 * @returns {NineSliceSprite}
 */
export function nineSlice(textureRegistry, name, insetX, insetY, width, height) {
    const sprite = new NineSliceSprite({
        texture: textureRegistry.get(name),
        leftWidth: insetX,
        rightWidth: insetX,
        topHeight: insetY,
        bottomHeight: insetY,
    });
    sprite.width = width;
    sprite.height = height;
    return sprite;
}

/**
 * Scales `icon` to fit a square of `size` inset by `inset` on every side, centered in it; the
 * limiting dimension fills the box and the other keeps its aspect ratio.
 * @param {Sprite} icon
 * @param {number} size - the square the icon sits in, measured from its own (0, 0)
 * @param {number} inset
 * @returns {void}
 */
export function fitIcon(icon, size, inset) {
    const box = size - inset * 2;
    icon.anchor = 0.5;
    icon.scale = Math.min(box / icon.texture.width, box / icon.texture.height);
    icon.position.set(size / 2, size / 2);
}

/**
 * Centers a single-glyph Text's drawn ink on (0, 0), instead of its text box.
 * The box carries the font's full ascent/descent, which for a glyph the game font lacks (drawn
 * from an unknown system fallback) sits visibly off-center.
 * @param {Text} text
 * @returns {void}
 */
export function centerGlyph(text) {
    const style = text.style;
    const font = `${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
    const context = document.createElement("canvas").getContext("2d");
    context.font = font;
    const ink = context.measureText(text.text);
    // The text box's top is the baseline less the font ascent; the ink's center is offset from
    // that same baseline by its own half-height.
    const baseline = CanvasTextMetrics.measureFont(font).ascent;
    const inkCenter = (ink.actualBoundingBoxDescent - ink.actualBoundingBoxAscent) / 2;
    text.anchor.set(0.5, 0);
    text.y = -baseline - inkCenter;
}

/**
 * Draws a circular button's idle/hover face — filled circle with a border stroke, centered on (0, 0).
 * @param {Graphics} face
 * @param {number} radius
 * @param {boolean} hovered
 * @returns {void}
 */
export function drawCircleButtonFace(face, radius, hovered) {
    let fill = PANEL_FILL;
    if (hovered) {
        fill = PANEL_HOVER_FILL;
    }
    face
        .circle(0, 0, radius)
        .fill({color: fill, alpha: PANEL_FILL_ALPHA})
        .stroke({color: PANEL_BORDER, width: 1});
}

/**
 * Stops a background/panel container from passing its presses through to whatever sits behind it.
 * @param {Container} target
 * @param {{pixi: boolean, native: boolean}} [options] - pixi: stop bubbling to pixi ancestors; native: stop bubbling to window-level listeners
 * @returns {void}
 */
export function swallowClicks(target, {pixi = true, native = false} = {}) {
    target.eventMode = "static";
    target.on("pointerdown", (e) => {
        if (pixi) {
            e.stopPropagation();
        }
        if (native) {
            e.nativeEvent.stopPropagation();
        }
    });
}

/**
 * Wires a tap gesture on `target`: only a release matching the primary-button press that began
 * here, and that did not travel far enough to be a drag, counts.
 * @param {Container} target
 * @param {function(): void} onTap
 * @param {{suppressTouchGhostClick: boolean, stopNativePropagation: boolean, stopPropagation: boolean}} [options] -
 *     blocks touch ghost click / window-level listeners; stopPropagation false leaves a press
 *     reaching an ancestor, so a scrolling container above still gets its drag
 * @returns {void}
 */
export function trackTap(target, onTap, {
    suppressTouchGhostClick = false,
    stopNativePropagation = false,
    stopPropagation = true,
} = {}) {
    const recognizer = new TapRecognizer();
    target.eventMode = "static";
    const onMove = (e) => recognizer.move(e.pointerId, e.global.x, e.global.y);
    const detachIfIdle = () => {
        if (!recognizer.pressed) {
            target.off("globalpointermove", onMove);
        }
    };
    target.on("pointerdown", (e) => {
        if (stopPropagation) {
            e.stopPropagation();
        }
        if (stopNativePropagation) {
            e.nativeEvent.stopPropagation();
        }
        if (suppressTouchGhostClick && e.pointerType !== "mouse") {
            e.nativeEvent.preventDefault();
        }
        // Travel is watched only while pressed, so an idle target costs nothing per move.
        if (recognizer.press(e.pointerId, e.button, e.global.x, e.global.y)) {
            target.on("globalpointermove", onMove);
        }
    });
    target.on("pointerup", (e) => {
        const tapped = recognizer.release(e.pointerId);
        detachIfIdle();
        if (tapped) {
            onTap();
        }
    });
    target.on("pointerupoutside", (e) => {
        recognizer.cancel(e.pointerId);
        detachIfIdle();
    });
    target.on("pointercancel", (e) => {
        recognizer.cancel(e.pointerId);
        detachIfIdle();
    });
}

/**
 * Whether `target` is what a pointer at (x, y) would reach, rather than something drawn over it.
 * Lets a DOM widget overlaid on the canvas defer to pixi's own stacking order, which it otherwise
 * floats above regardless of z-index.
 * @param {EventBoundary} boundary
 * @param {Container} target
 * @param {number} x - canvas space
 * @param {number} y
 * @returns {boolean}
 */
export function isTopmostAt(boundary, target, x, y) {
    if (boundary.rootTarget === null || boundary.rootTarget === undefined) {
        return false;
    }
    const hit = boundary.hitTest(x, y);
    if (hit === null || hit === undefined) {
        return false;
    }
    for (let node = hit; node !== null; node = node.parent) {
        if (node === target) {
            return true;
        }
    }
    return false;
}

/**
 * Tracks a native pointer drag through window-level pointermove/pointerup, from `startEvent`'s position.
 * @param {PointerEvent} startEvent
 * @param {function(deltaX: number, deltaY: number): void} onMove
 * @param {function(): void} [onEnd]
 * @returns {function(): void} detaches the listeners without firing `onEnd`; safe to call again after a real pointerup
 */
export function trackWindowDrag(startEvent, onMove, onEnd = () => {}) {
    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    const onPointerMove = (event) => onMove(event.clientX - startX, event.clientY - startY);
    const detach = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
    };
    const onPointerUp = () => {
        detach();
        onEnd();
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return detach;
}

export function drawLine(g, x1, y1, x2, y2, color = 0xFF00FF) {

    g.moveTo(x1, y1)
        .lineTo(x2, y2)
        .stroke({color: color, width: 2});

    return g;
}

export function drawCircle(g, x, y, r, color = 0xFF00FF) {

    g.moveTo(x, y)
        .circle(x, y, r)
        .stroke({color: color, width: 2});

    return g;
}

export function drawRect(g, x, y, w, h, color = 0xFF00FF) {

    g.moveTo(x, y)
        .rect(x, y, w, h)
        .stroke({color: color, width: 2});

    return g;
}
