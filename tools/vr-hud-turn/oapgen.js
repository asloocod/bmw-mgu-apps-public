'use strict';
/*
 * oapgen.js - the SOME/IP interface configs this tool's proxies need, made the way MainApp's installer makes an
 * app's someipInterfaces/: by BMW's own IFConfigGenerator, loaded from MainApp's AppManagement bundle on the unit,
 * against the unit's catalog /etc/oap/someip/someip-interfaces.json. Nothing of BMW's is shipped with the tool.
 *
 * The loader follows fromFirmware() in kit/tools/oapgen/gen.js of idrive7-apps (MIT, see LICENSE.idrive7-apps):
 * the bundle is evaluated with its entry list emptied, so only the module asked for runs.
 */
const path = require('path');

const MUST = 'de.bmw.body.Light';
const APPMGMT = '/usr/lib/oap-mainapp/src/AppManagement/AppManagement.js';

/* Light for the indicators (CDS2.statusIndicate, the other candidate, sent nothing on the car, 2026-11-07); FES for the
 * driving mode, Vehicle2 for the speed (as vr-start-sound) */
const MANIFEST = {
    proxies: {
        'de.bmw.body.Light': { attributes: { StatusFunctionsIndicators: 's', StatusFunctionsIndicators2: 's' }, instances: '1' },
        'de.bmw.infotainment.drivingexcitement.FES': { attributes: { statusFESVehicleDynamicSwitchHMI: 'rs' }, instances: '1' },
        'de.bmw.infotainment.vehicle.Vehicle2': { attributes: { statusCarSpeed2: 'rs' }, instances: '1' },
    },
};

/* IFConfigGenerator's exports ({ generate(db, manifest) }) out of the bundle at bundlePath */
function loadGenerator(bundlePath, readFileSync) {
    const text = readFileSync(bundlePath, 'utf8');
    const m = /"someip-interfaces-generator\/IFConfigGenerator(?:\.js)?":(\d+)/.exec(text);
    if (!m) throw new Error('IFConfigGenerator not found in ' + bundlePath);
    const tail = /,\{\},\[\d+\]\)\s*;?\s*$/;
    if (!tail.test(text)) throw new Error('unexpected AppManagement bundle format in ' + bundlePath);
    const bundleRequire = new Function('require', 'return ' + text.replace(tail, ',{},[])'))(require);
    return bundleRequire(m[1]);
}

/* writes outDir/<interface>.json for every proxy of MANIFEST, one at a time: an interface this unit's catalog lacks
 * (deps.log says which) leaves the others working; only Light, the reason for the tool, is a must. Returns how many. */
function generate(catalogPath, outDir, deps) {
    const db = JSON.parse(deps.readFileSync(catalogPath, 'utf8'));
    if (!deps.existsSync(outDir)) deps.mkdirSync(outDir);
    let n = 0;
    Object.keys(MANIFEST.proxies).forEach((iface) => {
        let ifs;
        try {
            const one = {};
            one[iface] = MANIFEST.proxies[iface];
            ifs = deps.generator.generate(db, { proxies: one });
        } catch (e) {
            if (iface === MUST) throw e;
            if (deps.log) deps.log('oapgen: ' + iface + ' left out: ' + String(e && e.message ? e.message : e).split('\n')[0]);
            return;
        }
        Object.keys(ifs).forEach((id) => {
            deps.writeFileSync(path.join(outDir, id.replace(/\./g, '_') + '.json'), JSON.stringify(ifs[id]));
            n++;
        });
    });
    return n;
}

module.exports = { APPMGMT, MANIFEST, loadGenerator, generate };
