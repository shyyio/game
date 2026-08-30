/**
 * Reorders `tools` to match `orderedIds` (a player's stored preference): known ids sort by their
 * stored position, unknown/new tools (a mod update, or a first-ever sync) append at the end in
 * default order — never dropped. Throws on an id collision among `tools`.
 * @param {AbstractTool[]} tools
 * @param {number[]} orderedIds
 * @returns {AbstractTool[]}
 */
export function applyToolOrder(tools, orderedIds) {
    const byId = new Map();
    for (const tool of tools) {
        if (byId.has(tool.id)) {
            throw new Error(`Tool id collision on ${tool.id}`);
        }
        byId.set(tool.id, tool);
    }

    const ordered = [];
    for (const id of orderedIds) {
        const tool = byId.get(id);
        if (tool !== undefined) {
            ordered.push(tool);
            byId.delete(id);
        }
    }
    ordered.push(...byId.values());
    return ordered;
}

/**
 * Moves `item` to `toIndex` within `order`, in place, closing the gap it left. Throws if the item
 * is not in the order.
 * @param {*[]} order
 * @param {*} item
 * @param {number} toIndex
 * @returns {void}
 */
export function moveWithin(order, item, toIndex) {
    const from = order.indexOf(item);
    if (from < 0) {
        throw new Error("Cannot move an item that is not in the order");
    }
    if (toIndex < 0 || toIndex >= order.length) {
        throw new Error(`Move target ${toIndex} is outside the order`);
    }
    order.splice(from, 1);
    order.splice(toIndex, 0, item);
}
