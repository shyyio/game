/**
 * One button a mod offers on another player, wherever the HUD shows that player (a selected
 * chunk's owner).
 */
export class PlayerAction {

    /**
     * @param {string} label
     * @param {function(): void} onPress
     */
    constructor(label, onPress) {
        this.label = label;
        this.onPress = onPress;
    }
}
