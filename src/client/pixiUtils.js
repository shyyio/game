import {Container, Graphics, NineSliceSprite, Point, Text} from "pixi.js";
import {GAME_FONT} from "@/client/constants.js";
import {DEBUG_OUTLINE_COLOR} from "@/client/Theme.js";

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
 * A Container of 1px outlines around each leaf under `roots`, for layout debugging. Bounds are
 * mapped into `localTarget`'s space so the outlines ride with it.
 * @param {Container[]} roots
 * @param {Container} localTarget
 * @returns {Container}
 */
export function debugOutlines(roots, localTarget) {
    const outlines = new Container();
    const visit = (node) => {
        if (node.children !== undefined && node.children.length > 0) {
            node.children.slice().forEach(visit);
            return;
        }
        const bounds = node.getBounds();
        const topLeft = localTarget.toLocal({x: bounds.minX, y: bounds.minY});
        const bottomRight = localTarget.toLocal({x: bounds.maxX, y: bounds.maxY});
        const outline = new Graphics();
        outline.rect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y)
            .stroke({width: 1, color: DEBUG_OUTLINE_COLOR, alignment: 0});
        outlines.addChild(outline);
    };
    roots.slice().forEach(visit);
    return outlines;
}

export function createArrow(x1, y1, x2, y2, color = 0xFF00FF) {
    const g = new Graphics();

    g.moveTo(x1, y1)
        .lineTo(x2, y2)
        .stroke({color: 0xFF00FF, pixelLine: true});

    const arrowSize = 8;

    const angle = Math.atan2(y2 - y1, x2 - x1);

    const p1x = x2 - arrowSize * Math.cos(angle - Math.PI / 6);
    const p1y = y2 - arrowSize * Math.sin(angle - Math.PI / 6);
    const p2x = x2 - arrowSize * Math.cos(angle + Math.PI / 6);
    const p2y = y2 - arrowSize * Math.sin(angle + Math.PI / 6);

    g.poly([
        new Point(x2, y2),
        new Point(p1x, p1y),
        new Point(p2x, p2y)
    ]).fill({color})

    return g;
}

export function createRect(x1, y1, width, height, color = 0xFF00FF) {

    const g = new Graphics();

    g.rect(x1, y1, width, height)
        .stroke({color: color, pixelLine: true});

    return g;
}

export function createText(x, y, text, color = 0xFF00FF) {

    const t = new Text({
        text: text,
        style: {
            fontFamily: GAME_FONT,
            fontSize: 18,
            fill: "#FF00FF",
        }
    });
    t.x = x;
    t.y = y;
    t.anchor = 0.5

    return t;
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
