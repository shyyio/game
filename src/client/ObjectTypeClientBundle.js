
/**
 * The derived client surface of one object type: its draw layer, placement ghost, and tool. Built by
 * the client for every type with a behavior; each piece comes from the type's create* hook or the
 * derived default.
 */
export class ObjectTypeClientBundle {

    /**
     * @param {ObjectType} type
     * @param {AbstractDrawLayer} drawLayer
     * @param {AbstractDrawLayer} ghostLayer
     * @param {AbstractTool} tool
     */
    constructor(
        type,
        drawLayer,
        ghostLayer,
        tool,
    ) {
        this.type = type;
        this.drawLayer = drawLayer;
        this.ghostLayer = ghostLayer;
        this.tool = tool;
    }
}
