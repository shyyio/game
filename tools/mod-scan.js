// Free-variable scan of a built mod bundle. The factory format has zero imports, so a legitimate
// bundle's only free references are whitelisted intrinsics — everything else (fetch, document,
// eval, WebSocket) is a capability the mod has no business reaching, and fails the build.
//
//   node tools/mod-scan.js <mod.js>

import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {parse} from "acorn";

// Pure computation plus the debug channel. Anything with reach into the page, the network, the
// clock's environment, or dynamic evaluation stays off this list on purpose.
export const ALLOWED_GLOBALS = new Set([
    "Array", "ArrayBuffer", "BigInt", "Boolean", "DataView", "Date", "Error", "EvalError",
    "Float32Array", "Float64Array", "Infinity", "Int8Array", "Int16Array", "Int32Array", "Intl",
    "JSON", "Map", "Math", "NaN", "Number", "Object", "Promise", "RangeError", "ReferenceError",
    "Reflect", "RegExp", "Set", "String", "Symbol", "SyntaxError", "TextDecoder", "TextEncoder",
    "TypeError", "URIError", "URL", "URLSearchParams", "Uint8Array", "Uint8ClampedArray",
    "Uint16Array", "Uint32Array", "WeakMap", "WeakSet", "console", "decodeURIComponent",
    "encodeURIComponent", "isFinite", "isNaN", "parseFloat", "parseInt", "structuredClone",
    "undefined",
]);

/**
 * One lexical scope: the names declared in it, and the scope it nests in.
 */
class Scope {

    /**
     * @param {Scope|null} parent
     * @param {boolean} isFunctionScope whether `var` declarations land here
     */
    constructor(
        parent,
        isFunctionScope,
    ) {
        this.parent = parent;
        this.isFunctionScope = isFunctionScope;
        this.names = new Set();
    }

    /**
     * @param {string} name
     * @returns {void}
     */
    declare(name) {
        this.names.add(name);
    }

    /**
     * The nearest scope `var` declarations belong to.
     * @returns {Scope}
     */
    functionScope() {
        if (this.isFunctionScope || this.parent === null) {
            return this;
        }
        return this.parent.functionScope();
    }

    /**
     * @param {string} name
     * @returns {boolean}
     */
    has(name) {
        if (this.names.has(name)) {
            return true;
        }
        if (this.parent === null) {
            return false;
        }
        return this.parent.has(name);
    }
}

/**
 * Every name a binding pattern introduces.
 * @param {object} node
 * @param {string[]} into
 * @returns {void}
 */
function patternNames(node, into) {
    if (node === null || node === undefined) {
        return;
    }
    if (node.type === "Identifier") {
        into.push(node.name);
    } else if (node.type === "ObjectPattern") {
        for (const property of node.properties) {
            patternNames(property.type === "RestElement" ? property.argument : property.value, into);
        }
    } else if (node.type === "ArrayPattern") {
        for (const element of node.elements) {
            patternNames(element, into);
        }
    } else if (node.type === "AssignmentPattern") {
        patternNames(node.left, into);
    } else if (node.type === "RestElement") {
        patternNames(node.argument, into);
    }
}

/**
 * The child nodes of an AST node, in no particular order.
 * @param {object} node
 * @returns {object[]}
 */
function children(node) {
    const found = [];
    for (const key of Object.keys(node)) {
        if (key === "type" || key === "start" || key === "end" || key === "loc") {
            continue;
        }
        const value = node[key];
        if (Array.isArray(value)) {
            for (const item of value) {
                if (item !== null && typeof item === "object" && typeof item.type === "string") {
                    found.push(item);
                }
            }
        } else if (value !== null && typeof value === "object" && typeof value.type === "string") {
            found.push(value);
        }
    }
    return found;
}

/**
 * Declares everything a statement list hoists into `scope` (function declarations and `var` reach
 * the whole function; `let`/`const`/`class` and imports stay in this block).
 * @param {object[]} body
 * @param {Scope} scope
 * @returns {void}
 */
function hoist(body, scope) {
    for (const statement of body) {
        hoistStatement(statement, scope);
    }
}

/**
 * @param {object} node
 * @param {Scope} scope
 * @returns {void}
 */
function hoistStatement(node, scope) {
    if (node === null || node === undefined) {
        return;
    }
    if (node.type === "FunctionDeclaration" && node.id !== null) {
        scope.declare(node.id.name);
        return;
    }
    if (node.type === "ClassDeclaration" && node.id !== null) {
        scope.declare(node.id.name);
        return;
    }
    if (node.type === "VariableDeclaration") {
        const names = [];
        for (const declarator of node.declarations) {
            patternNames(declarator.id, names);
        }
        const target = node.kind === "var" ? scope.functionScope() : scope;
        for (const name of names) {
            target.declare(name);
        }
        return;
    }
    if (node.type === "ImportDeclaration") {
        for (const specifier of node.specifiers) {
            scope.declare(specifier.local.name);
        }
        return;
    }
    if (node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration") {
        hoistStatement(node.declaration, scope);
        return;
    }
    // `var` inside nested blocks/loops still belongs to the enclosing function scope.
    if (["BlockStatement", "ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement",
        "DoWhileStatement", "IfStatement", "TryStatement", "SwitchStatement", "LabeledStatement",
        "SwitchCase", "CatchClause", "WithStatement"].includes(node.type)) {
        for (const child of children(node)) {
            hoistVarsOnly(child, scope);
        }
    }
}

/**
 * @param {object} node
 * @param {Scope} scope
 * @returns {void}
 */
function hoistVarsOnly(node, scope) {
    if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression"
        || node.type === "ArrowFunctionExpression" || node.type === "ClassDeclaration"
        || node.type === "ClassExpression") {
        return;
    }
    if (node.type === "VariableDeclaration") {
        if (node.kind === "var") {
            const names = [];
            for (const declarator of node.declarations) {
                patternNames(declarator.id, names);
            }
            for (const name of names) {
                scope.functionScope().declare(name);
            }
        }
        return;
    }
    for (const child of children(node)) {
        hoistVarsOnly(child, scope);
    }
}

/**
 * Walks a node, resolving identifier references against the scope chain.
 * @param {object} node
 * @param {Scope} scope
 * @param {Map<string, number>} free name -> how many unresolved references
 * @returns {void}
 */
function visit(node, scope, free) {
    if (node === null || node === undefined) {
        return;
    }
    switch (node.type) {
        case "Identifier": {
            if (!scope.has(node.name) && !ALLOWED_GLOBALS.has(node.name)) {
                free.set(node.name, (free.get(node.name) === undefined ? 0 : free.get(node.name)) + 1);
            }
            return;
        }
        case "MemberExpression": {
            visit(node.object, scope, free);
            if (node.computed) {
                visit(node.property, scope, free);
            }
            return;
        }
        case "Property": {
            if (node.computed) {
                visit(node.key, scope, free);
            }
            visit(node.value, scope, free);
            return;
        }
        case "PropertyDefinition":
        case "MethodDefinition": {
            if (node.computed) {
                visit(node.key, scope, free);
            }
            visit(node.value, scope, free);
            return;
        }
        case "LabeledStatement": {
            visit(node.body, scope, free);
            return;
        }
        case "BreakStatement":
        case "ContinueStatement": {
            return;
        }
        case "FunctionDeclaration":
        case "FunctionExpression":
        case "ArrowFunctionExpression": {
            const inner = new Scope(scope, true);
            if (node.id !== null && node.id !== undefined) {
                inner.declare(node.id.name);
            }
            const names = [];
            for (const param of node.params) {
                patternNames(param, names);
            }
            for (const name of names) {
                inner.declare(name);
            }
            inner.declare("arguments");
            for (const param of node.params) {
                visitPatternDefaults(param, inner, free);
            }
            if (node.body.type === "BlockStatement") {
                hoist(node.body.body, inner);
                for (const statement of node.body.body) {
                    visit(statement, inner, free);
                }
            } else {
                visit(node.body, inner, free);
            }
            return;
        }
        case "ClassDeclaration":
        case "ClassExpression": {
            const inner = new Scope(scope, false);
            if (node.id !== null && node.id !== undefined) {
                inner.declare(node.id.name);
            }
            visit(node.superClass, inner, free);
            for (const member of node.body.body) {
                visit(member, inner, free);
            }
            return;
        }
        case "BlockStatement": {
            const inner = new Scope(scope, false);
            hoist(node.body, inner);
            for (const statement of node.body) {
                visit(statement, inner, free);
            }
            return;
        }
        case "ForStatement":
        case "ForInStatement":
        case "ForOfStatement": {
            const inner = new Scope(scope, false);
            for (const child of children(node)) {
                hoistStatement(child, inner);
            }
            for (const child of children(node)) {
                visit(child, inner, free);
            }
            return;
        }
        case "CatchClause": {
            const inner = new Scope(scope, false);
            const names = [];
            patternNames(node.param, names);
            for (const name of names) {
                inner.declare(name);
            }
            hoist(node.body.body, inner);
            for (const statement of node.body.body) {
                visit(statement, inner, free);
            }
            return;
        }
        case "VariableDeclarator": {
            visitPatternDefaults(node.id, scope, free);
            visit(node.init, scope, free);
            return;
        }
        default: {
            for (const child of children(node)) {
                visit(child, scope, free);
            }
        }
    }
}

/**
 * Visits the expressions inside a binding pattern (default values, computed keys) without treating
 * the bound names as references.
 * @param {object} node
 * @param {Scope} scope
 * @param {Map<string, number>} free
 * @returns {void}
 */
function visitPatternDefaults(node, scope, free) {
    if (node === null || node === undefined || node.type === "Identifier") {
        return;
    }
    if (node.type === "AssignmentPattern") {
        visitPatternDefaults(node.left, scope, free);
        visit(node.right, scope, free);
        return;
    }
    if (node.type === "ObjectPattern") {
        for (const property of node.properties) {
            if (property.type === "RestElement") {
                visitPatternDefaults(property.argument, scope, free);
                continue;
            }
            if (property.computed) {
                visit(property.key, scope, free);
            }
            visitPatternDefaults(property.value, scope, free);
        }
        return;
    }
    if (node.type === "ArrayPattern") {
        for (const element of node.elements) {
            visitPatternDefaults(element, scope, free);
        }
        return;
    }
    if (node.type === "RestElement") {
        visitPatternDefaults(node.argument, scope, free);
    }
}

/**
 * The global names a module source references but never declares.
 * @param {string} source
 * @returns {Map<string, number>} name -> reference count
 */
export function freeIdentifiers(source) {
    const program = parse(source, {ecmaVersion: "latest", sourceType: "module"});
    const scope = new Scope(null, true);
    hoist(program.body, scope);
    const free = new Map();
    for (const statement of program.body) {
        visit(statement, scope, free);
    }
    return free;
}

/**
 * Scans a built bundle.
 * @param {string} path
 * @returns {string[]} the disallowed globals it reaches, empty when clean
 */
export function scanBundle(path) {
    return [...freeIdentifiers(readFileSync(path, "utf8")).keys()].sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [target] = process.argv.slice(2);
    if (target === undefined) {
        throw new Error("usage: mod-scan.js <mod.js>");
    }
    const found = scanBundle(resolve(target));
    if (found.length > 0) {
        console.error(`${target} reaches disallowed globals: ${found.join(", ")}`);
        process.exitCode = 1;
    } else {
        console.log(`${target}: clean`);
    }
}
