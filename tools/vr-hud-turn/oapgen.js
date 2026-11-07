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

const APPMGMT = '/usr/lib/oap-mainapp/src/AppManagement/AppManagement.js';

/* Light only: CDS2.statusIndicate, the other candidate, sent nothing on the car (2026-11-07) */
const MANIFEST = {
    proxies: {
        'de.bmw.body.Light': { attributes: { StatusFunctionsIndicators: 's', StatusFunctionsIndicators2: 's' }, instances: '1' },
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

/* writes outDir/<interface>.json for every proxy of MANIFEST; returns how many */
function generate(catalogPath, outDir, deps) {
    const db = JSON.parse(deps.readFileSync(catalogPath, 'utf8'));
    const ifs = deps.generator.generate(db, MANIFEST);
    if (!deps.existsSync(outDir)) deps.mkdirSync(outDir);
    const ids = Object.keys(ifs);
    ids.forEach((id) => deps.writeFileSync(path.join(outDir, id.replace(/\./g, '_') + '.json'), JSON.stringify(ifs[id])));
    return ids.length;
}

module.exports = { APPMGMT, MANIFEST, loadGenerator, generate };
