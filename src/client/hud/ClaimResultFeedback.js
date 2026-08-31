import {ClaimResult, ClaimResultEvent} from "@/common/ClaimEvents.js";
import {UnclaimChunkMessage} from "@/common/ClaimMessages.js";

// Rejection notices per ClaimResult; OK stays silent (the border appearing is the feedback).
const CLAIM_RESULT_NOTICES = {
    [ClaimResult.CLAIM_RESULT_OWNED]: "That chunk is already claimed",
    [ClaimResult.CLAIM_RESULT_LIMIT]: "Chunk limit reached",
    [ClaimResult.CLAIM_RESULT_NOT_ADJACENT]: "New chunks must touch one of your claimed chunks",
    [ClaimResult.CLAIM_RESULT_NOT_OWNER]: "Not your chunk",
    [ClaimResult.CLAIM_RESULT_WOULD_SPLIT]: "Unclaiming this would split your claimed chunks",
};

/**
 * Routes a rejected claim/unclaim to a toast notice, except a non-empty unclaim, which opens
 * the destructive confirm dialog instead.
 */
export class ClaimResultFeedback {

    /**
     * @param {Client} client
     */
    constructor(client) {
        this.client = client;
    }

    /**
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (!(event instanceof ClaimResultEvent)) {
            return;
        }
        if (event.result === ClaimResult.CLAIM_RESULT_NOT_EMPTY) {
            this.client.hud.confirmDialogLayer.open({
                title: "Unclaim chunk?",
                message: "This chunk still contains buildings. Unclaiming will permanently delete everything in it.",
                confirmLabel: "Delete and unclaim",
                onConfirm: () => this.client.sendMessage(new UnclaimChunkMessage(event.chunk, true)),
            });
            return;
        }
        const notice = CLAIM_RESULT_NOTICES[event.result];
        if (notice !== undefined) {
            this.client.hud.notify(notice);
        }
    }
}
