'use strict';
/*
 * signal.js - the car's engine values, decoded. Catalog: /etc/oap/someip/someip-interfaces.json on the unit.
 *
 * Temperatures: CDS.statusEngineTemperature and VehicleInformation.DataPowerTrain2CRC, members
 * temperatureEngineOilDrive / temperatureEngineDrive, UInt8, degrees C = raw - 48, 255 = no data (as idrive7-apps
 * kit/runtime/car.js reads them; on the car 2026-11-07 oil 157 = 109 C after a drive).
 *
 * DataPowerTrain2CRC.statusEngineRunDrive, enum StatusEngineRunDrive: 0 MOTOR_AUS, 1 MOTOR_STARTET, 2 MOTOR_LAEUFT,
 * 3 SIGNAL_UNGUELTIG. The binding hands an enum over by its name (seen on the car) or its number.
 */

const RUN = { MOTOR_AUS: 'off', MOTOR_STARTET: 'running', MOTOR_LAEUFT: 'running', 0: 'off', 1: 'running', 2: 'running' };

/* degrees C, or null when the raw value says nothing */
function temp(raw) {
    if (!Number.isInteger(raw) || raw < 0 || raw > 254) return null;
    return raw - 48;
}

/* 'running' | 'off', or null (invalid, unknown) */
function engine(v) {
    if (typeof v !== 'string' && typeof v !== 'number') return null;
    return Object.prototype.hasOwnProperty.call(RUN, v) ? RUN[v] : null;
}

module.exports = { temp, engine };
