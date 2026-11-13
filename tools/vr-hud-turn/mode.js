'use strict';
/*
 * mode.js - the driving mode, for the arrows' height: in Sport / Sport+ the HUD shows a rev counter on the left.
 *
 * de.bmw.infotainment.drivingexcitement.FES statusFESVehicleDynamicSwitchHMI.actualValueModeDrivingExperience, as
 * idrive7-apps' live_data reads it: by name (SPORT_DYNAMIC, SPORT_EXPERT, COMFORT_*, ECO_PRO_*, ADAPTIVE) or by
 * number (1-3 Sport, Sport+, Sport individual; 4-6 Comfort; 7-9 Eco Pro; 10 Adaptive). Anything else says nothing.
 */

/* 'sport' | 'normal', or null when the value says nothing (the caller keeps what it had) */
function decode(payload) {
    const v = payload !== null && typeof payload === 'object' ? payload.actualValueModeDrivingExperience : payload;
    if (typeof v === 'string') {
        if (/^SPORT/.test(v)) return 'sport';
        if (/^(COMFORT|ECO|ADAPTIVE)/.test(v)) return 'normal';
        return null;
    }
    if (Number.isInteger(v) && v >= 1 && v <= 3) return 'sport';
    if (Number.isInteger(v) && v >= 4 && v <= 10) return 'normal';
    return null;
}

module.exports = { decode };
