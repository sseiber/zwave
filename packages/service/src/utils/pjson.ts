import { getDirname } from './dirname.js';
import fse from 'fs-extra';
import nodePath from 'node:path';

export function pjson(): any {
    let result = {};

    try {
        const packagePath = nodePath.resolve(getDirname(import.meta.url), '..', '..', 'package.json');
        result = fse.readJsonSync(packagePath);
    }
    catch {
        // eat exception
    }

    return result;
}
