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
