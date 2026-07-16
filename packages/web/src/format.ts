// Human-readable helpers for the richer device state.

export function relativeTime(iso: string | undefined): string {
    if (!iso) {
        return '—';
    }

    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) {
        return '—';
    }

    const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (seconds < 60) {
        return `${seconds}s ago`;
    }

    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
        return `${minutes}m ago`;
    }

    const hours = Math.round(minutes / 60);
    if (hours < 24) {
        return `${hours}h ago`;
    }

    return `${Math.round(hours / 24)}d ago`;
}

// Map RSSI (dBm, negative — closer to 0 is stronger) to a label + a 0-3 strength.
export function signal(rssi: number | undefined): { label: string; level: number } {
    if (typeof rssi !== 'number') {
        return { label: 'Unknown', level: 0 };
    }
    if (rssi >= -60) {
        return { label: 'Strong', level: 3 };
    }
    if (rssi >= -75) {
        return { label: 'Good', level: 2 };
    }
    if (rssi >= -85) {
        return { label: 'Fair', level: 1 };
    }

    return { label: 'Weak', level: 1 };
}

export function round(value: number | undefined, places = 1): string {
    if (typeof value !== 'number') {
        return '—';
    }

    const factor = 10 ** places;
    return String(Math.round(value * factor) / factor);
}
