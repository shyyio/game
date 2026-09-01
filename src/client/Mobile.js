import {isMobile} from "pixi.js";
import {AbstractDevicePreference} from "@/client/AbstractDevicePreference.js";

/**
 * Singleton holding the mobile-mode preference, overriding pixi's device detection.
 */
class Mobile extends AbstractDevicePreference {

    devicePrefers() {
        return isMobile.any;
    }
}

export default new Mobile();
