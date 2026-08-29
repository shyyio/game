/**
 * One value of a stated (on/off style) logic key, with its player-visible phrasings: `verb`
 * labels the action ("Close"), `state` the condition ("is closed"). Declare the permissive state
 * first: retargeting a rule to another device keeps the state position, not the key.
 */
export class LogicKeyState {

    /**
     * @param {number} value
     * @param {string|null} verb - null on a read-only key, which no action dropdown ever lists
     * @param {string} state
     */
    constructor(value, verb, state) {
        this.value = value;
        this.verb = verb;
        this.state = state;
    }
}

/**
 * A logic key's UI metadata: its name, its states when the key is an on/off style toggle
 * (null states = numeric, edited with comparator + value), and the label its condition type
 * shows in rule editors.
 */
export class LogicKeyEntry {

    /**
     * @param {string} name
     * @param {LogicKeyState[]|null} states
     * @param {string|null} stateLabel - condition-type label; defaults to "<name> state"
     */
    constructor(name, states = null, stateLabel = null) {
        this.name = name;
        this.states = states;
        if (stateLabel === null) {
            this.stateLabel = `${name} state`;
        } else {
            this.stateLabel = stateLabel;
        }
    }
}
