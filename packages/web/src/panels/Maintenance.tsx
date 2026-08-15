import { useEffect, useState } from 'react';
import type { IDeviceInfo, IRebuildRoutesStatus, IConfigDbStatus } from '@zwave-service/contracts';
import type { RunFn } from '../types.ts';
import { api } from '../api.ts';

//
// Mesh maintenance — occasional, deliberate operations (route rebuild, device-database
// update, re-interviewing unidentified nodes). These used to sit on the Dashboard,
// where they took up more room than the health summary they were attached to. They
// live with the device list now, collapsed by default.
//

interface MaintenanceProps {
    devices: IDeviceInfo[];
    run: RunFn;
    refresh: () => Promise<void>;
}

export function Maintenance({ devices, run, refresh }: MaintenanceProps) {
    const unidentified = devices.filter(d => !d.manufacturer);

    return (
        <details className="maint">
            <summary>Mesh maintenance</summary>

            <div className="maint-body">
                <RebuildControl run={run} />
                {unidentified.length > 0 && (
                    <ReinterviewUnidentified devices={unidentified} run={run} refresh={refresh} />
                )}
                <ConfigDbControl run={run} />
            </div>
        </details>
    );
}

// Start + track a network-wide route rebuild. Useful after relocating the controller,
// when devices are still routing through stale (slow) paths.
function RebuildControl({ run }: { run: RunFn }) {
    const [status, setStatus] = useState<IRebuildRoutesStatus | null>(null);
    const [polling, setPolling] = useState(false);

    // Reflect an already-running rebuild on mount
    useEffect(() => {
        let alive = true;
        void api.getRebuildRoutesStatus().then(st => {
            if (alive) {
                setStatus(st);
                if (st.active) {
                    setPolling(true);
                }
            }
        }).catch(() => { /* ignore */ });
        return () => { alive = false; };
    }, []);

    useEffect(() => {
        if (!polling) {
            return;
        }
        let alive = true;
        const tick = async (): Promise<void> => {
            try {
                const st = await api.getRebuildRoutesStatus();
                if (!alive) {
                    return;
                }
                setStatus(st);
                if (!st.active) {
                    setPolling(false);
                }
            }
            catch { /* ignore transient errors */ }
        };
        const id = setInterval(() => void tick(), 3000);
        return () => { alive = false; clearInterval(id); };
    }, [polling]);

    const start = async (): Promise<void> => {
        if (await run(() => api.rebuildAllRoutes())) {
            setPolling(true);
        }
    };

    return (
        <div className="maint-line">
            <button onClick={() => void start()} disabled={polling}>
                {polling ? 'Rebuilding routes…' : 'Rebuild all routes'}
            </button>
            {status && (status.active
                ? <span className="muted">Rebuilding {status.done + status.failed + status.skipped}/{status.total}</span>
                : status.total > 0 && <span className="muted">Last: {status.done} ok · {status.failed} failed · {status.skipped} skipped</span>)}
        </div>
    );
}

// Check/install a zwave-js device-config-database update. A newer DB can identify
// devices (and give them named config params) whose model wasn't in the bundled one.
function ConfigDbControl({ run }: { run: RunFn }) {
    const [status, setStatus] = useState<IConfigDbStatus | null>(null);
    const [busy, setBusy] = useState<'check' | 'install' | null>(null);

    const check = async (): Promise<void> => {
        setBusy('check');
        try {
            let result: IConfigDbStatus | null = null;
            await run(async () => {
                result = await api.checkConfigDbUpdate();
                return { message: result.updateAvailable ? `Device-database update available (${result.version})` : 'Device database is up to date' };
            });
            if (result) {
                setStatus(result);
            }
        }
        finally {
            setBusy(null);
        }
    };

    const install = async (): Promise<void> => {
        setBusy('install');
        try {
            if (await run(() => api.installConfigDbUpdate())) {
                setStatus({ updateAvailable: false });
            }
        }
        finally {
            setBusy(null);
        }
    };

    return (
        <div className="maint-line">
            <button onClick={() => void check()} disabled={busy !== null}>
                {busy === 'check' ? 'Checking…' : 'Check device-DB update'}
            </button>
            {status?.updateAvailable && (
                <button onClick={() => void install()} disabled={busy !== null}>
                    {busy === 'install' ? 'Installing…' : `Install ${status.version ?? 'update'}`}
                </button>
            )}
            <span className="muted">refreshes named device parameters; re-interview a device after installing</span>
        </div>
    );
}

// Sequentially re-interview the unidentified nodes (spaced out so their interviews
// don't all start at once and flood a struggling mesh).
function ReinterviewUnidentified({ devices, run, refresh }: { devices: IDeviceInfo[]; run: RunFn; refresh: () => Promise<void> }) {
    const [running, setRunning] = useState(false);

    const start = async (): Promise<void> => {
        setRunning(true);
        try {
            for (const device of devices) {
                await run(() => api.refreshDevice(device.nodeId));
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
            await refresh();
        }
        finally {
            setRunning(false);
        }
    };

    return (
        <div className="maint-line">
            <button onClick={() => void start()} disabled={running}>
                {running ? 'Re-interviewing…' : `Re-interview ${devices.length} unidentified`}
            </button>
            <span className="muted">devices with no manufacturer/model — often a timed-out interview</span>
        </div>
    );
}
