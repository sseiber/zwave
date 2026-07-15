import { getDirname } from './dirname.js';
import fse from 'fs-extra';
import { resolve } from 'node:path';

export function pjson(): any {
    let result = {};

    try {
        const packagePath = resolve(getDirname(import.meta.url), '..', '..', 'package.json');
        result = fse.readJsonSync(packagePath);
    }
    catch (_ex) {
        // eat exception
    }

    return result;
}
