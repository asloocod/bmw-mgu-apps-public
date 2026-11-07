'use strict';
/*
 * signal.js - the car's turn-indicator values, decoded.
 *
 * de.bmw.body.Light StatusFunctionsIndicators(2).controlIndicateDirection, enum ControlIndicateDirection of the
 * unit's catalog (/etc/oap/someip/someip-interfaces.json): 0 BLINKEN_AUS, 1 TIPP_BLINKEN_LINKS_EIN,
 * 2 TIPP_BLINKEN_RECHTS_EIN, 3 DAUER_BLINKEN_LINKS_EIN, 4 DAUER_BLINKEN_RECHTS_EIN, 8 BEIDSEITIGES_BLINKEN_EIN,
 * 13/14/15 not available / error / unfilled. The binding hands an enum over by its name (seen on the car,
 * 2026-11-07) or its number. A value that says nothing about the indicators (13/14/15, unknown, missing) is null:
 * the caller keeps what it had, and its timeout ends a turn whose events stopped.
 *
 * activeFunctionIndicateDirection BLINKEN_AUS (0) beside a requested direction: the flasher has already stopped
 * (stalk going back, a side switch). On the car it comes 120-320 ms before the direction does, never at a start
 * (journal 2026-11-07): 'none' then.
 *
 * The car flashing by itself with the stalk at rest (controlIndicateDirection BLINKEN_AUS, or a value that says
 * nothing): the active function gives the side for driver assistance (FAS_RICHTUNGSBLINKEN_*), both for hazard
 * flashing it starts (after emergency braking, rear-end warning, crash, FAS, RCP). Flashing while parked (lock,
 * alarm, announcement, remote start) and the stalk's own functions are left to controlIndicateDirection.
 */

const DIRECTION = { 1: 'left', 2: 'right', 3: 'left', 4: 'right', 8: 'both' };
const NAMES = {
    BLINKEN_AUS: 0, TIPP_BLINKEN_LINKS_EIN: 1, TIPP_BLINKEN_RECHTS_EIN: 2,
    DAUER_BLINKEN_LINKS_EIN: 3, DAUER_BLINKEN_RECHTS_EIN: 4, BEIDSEITIGES_BLINKEN_EIN: 8,
};

/* ActiveFunctionIndicateDirection: the car's own flashing -> the arrows it lights */
const CAR_FLASHING = {
    1: 'both',      // CRASH_BLINKEN
    12: 'both',     // FAS_WARNBLINKEN_AUSPRAEGUNG_1
    13: 'both',     // AUFFAHRWARNBLINKEN
    16: 'both',     // WARNBLINKEN_NACH_GEFAHRENBREMSUNG
    17: 'both',     // WARNBLINKEN_VON_RCP
    18: 'left', 19: 'right',    // FAS_RICHTUNGSBLINKEN_LOWPRIO_LINKS / _RECHTS
    20: 'left', 21: 'right',    // FAS_RICHTUNGSBLINKEN_MIDPRIO_LINKS / _RECHTS
    22: 'left', 23: 'right',    // FAS_RICHTUNGSBLINKEN_HIGHPRIO_LINKS / _RECHTS
    24: 'both', 25: 'both',     // FAS_WARNBLINKEN_AUSPRAEGUNG_2 / _3
};
const ACTIVE_NAMES = {
    BLINKEN_AUS: 0, CRASH_BLINKEN: 1, REVERSIER_BLINKEN: 2, QUITTIERUNGSBLINKEN_SCHAERFEN: 3, QUITTIERUNGSBLINKEN_ENTSCHAERFEN: 4,
    DWA_BLINKEN: 5, WARNBLINKEN_MANUELL: 6, DAUERBLINKEN_LINKS: 7, DAUERBLINKEN_RECHTS: 8, TIPPBLINKEN_LINKS: 9,
    TIPPBLINKEN_RECHTS: 10, UEBERFALLALARM: 11, FAS_WARNBLINKEN_AUSPRAEGUNG_1: 12, AUFFAHRWARNBLINKEN: 13,
    ANKUENDIGUNGSBLINKEN_OEFFNEN: 14, ANKUENDIGUNGSBLINKEN_SCHLIESSEN: 15, WARNBLINKEN_NACH_GEFAHRENBREMSUNG: 16,
    WARNBLINKEN_VON_RCP: 17, FAS_RICHTUNGSBLINKEN_LOWPRIO_LINKS: 18, FAS_RICHTUNGSBLINKEN_LOWPRIO_RECHTS: 19,
    FAS_RICHTUNGSBLINKEN_MIDPRIO_LINKS: 20, FAS_RICHTUNGSBLINKEN_MIDPRIO_RECHTS: 21, FAS_RICHTUNGSBLINKEN_HIGHPRIO_LINKS: 22,
    FAS_RICHTUNGSBLINKEN_HIGHPRIO_RECHTS: 23, FAS_WARNBLINKEN_AUSPRAEGUNG_2: 24, FAS_WARNBLINKEN_AUSPRAEGUNG_3: 25,
    ANKUENDIGUNGSBLINKEN_REMOTE_MOTORSTART: 26,
};

/* the member of a struct payload, or the payload itself when it is a bare value */
function member(payload, name) {
    if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) return payload[name];
    return payload;
}

/* 'none' | 'left' | 'right' | 'both', or null when the value says nothing */
function decode(payload) {
    let v = member(payload, 'controlIndicateDirection');
    if (typeof v === 'string' && Object.prototype.hasOwnProperty.call(NAMES, v)) v = NAMES[v];
    let a = payload !== null && typeof payload === 'object' ? payload.activeFunctionIndicateDirection : undefined;
    if (typeof a === 'string' && Object.prototype.hasOwnProperty.call(ACTIVE_NAMES, a)) a = ACTIVE_NAMES[a];
    if (Number.isInteger(v) && DIRECTION[v]) return a === 0 ? 'none' : DIRECTION[v];
    if (Number.isInteger(a) && CAR_FLASHING[a]) return CAR_FLASHING[a];
    return v === 0 ? 'none' : null;
}

module.exports = { decode };
