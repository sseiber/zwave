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

// Relative time for an upcoming instant ("in 45s", "in 5m", "in 2h", "in 3d"), or "—".
export function relativeUpcoming(iso: string | undefined): string {
    if (!iso) {
        return '—';
    }

    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) {
        return '—';
    }

    const seconds = Math.round((then - Date.now()) / 1000);
    if (seconds <= 0) {
        return 'now';
    }
    if (seconds < 60) {
        return `in ${seconds}s`;
    }

    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
        return `in ${minutes}m`;
    }

    const hours = Math.round(minutes / 60);
    if (hours < 24) {
        return `in ${hours}h`;
    }

    return `in ${Math.round(hours / 24)}d`;
}

// Full local timestamp for a tooltip, or '' when absent/invalid.
export function absoluteTime(iso: string | undefined): string {
    if (!iso) {
        return '';
    }

    const date = new Date(iso);

    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
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
