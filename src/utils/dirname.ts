import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function getFilename(metaUrl: string): string {
    return fileURLToPath(metaUrl);
}

export function getDirname(metaUrl: string): string {
    return path.dirname(fileURLToPath(metaUrl));
}
