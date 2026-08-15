import { useCallback, useEffect, useRef, useState } from 'react';
import type { IDeviceInfo, IRebuildRoutesStatus, IConfigDbStatus } from '@zwave-service/contracts';
import type { RunFn } from '../types.ts';
import { api } from '../api.ts';

//
// Mesh maintenance — occasional, deliberate operations (route rebuild, device-database
// update, re-interviewing unidentified nodes).
//
// These are exposed as menu actions rather than a block of buttons: the work is rare,
// but while it is running it needs to be visible, so anything in flight surfaces in a
// status strip under the panel header. (A dedicated settings screen is the eventual
// home for the two that aren't really about devices.)
//

// Gap between re-interviews, so a struggling mesh isn't flooded with them at once
const ReinterviewSpacingMs = 1500;

interface MaintenanceState {
    rebuild: IRebuildRoutesStatus | null;
    rebuilding: boolean;
    // Set once a rebuild finishes during this session, until dismissed
    rebuildSummary: string | null;
    configDb: IConfigDbStatus | null;
    configBusy: 'check' | 'install' | null;
    reinterviewing: number;
}

export interface MaintenanceActions {
    startRebuild: () => void;
    checkConfigDb: () => void;
    installConfigDb: () => void;
    reinterviewUnidentified: () => void;
    dismissRebuildSummary: () => void;
}

interface UseMaintenanceOptions {
    devices: IDeviceInfo[];
    run: RunFn;
    refresh: () => Promise<void>;
}

export function useMaintenance({ devices, run, refresh }: UseMaintenanceOptions): [MaintenanceState, MaintenanceActions] {
    const [rebuild, setRebuild] = useState<IRebuildRoutesStatus | null>(null);
    const [rebuilding, setRebuilding] = useState(false);
    const [rebuildSummary, setRebuildSummary] = useState<string | null>(null);
    const [configDb, setConfigDb] = useState<IConfigDbStatus | null>(null);
    const [configBusy, setConfigBusy] = useState<'check' | 'install' | null>(null);
    const [reinterviewing, setReinterviewing] = useState(0);

    // Devices without a manufacturer/model — usually a timed-out interview
    const unidentified = devices.filter(d => !d.manufacturer);
    const unidentifiedRef = useRef(unidentified);
    unidentifiedRef.current = unidentified;

    // Reflect a rebuild that was already running (e.g. after a page reload)
    useEffect(() => {
        let alive = true;

        void api.getRebuildRoutesStatus().then(status => {
            if (alive) {
                setRebuild(status);
                setRebuilding(status.active);
            }
        }).catch(() => { /* ignore */ });

        return () => { alive = false; };
    }, []);

    useEffect(() => {
        if (!rebuilding) {
            return;
        }

        let alive = true;

        const tick = async (): Promise<void> => {
            try {
                const status = await api.getRebuildRoutesStatus();
                if (!alive) {
                    return;
                }

                setRebuild(status);

                if (!status.active) {
                    setRebuilding(false);
                    setRebuildSummary(`Route rebuild finished — ${status.done} ok · ${status.failed} failed · ${status.skipped} skipped`);
                }
            }
            catch { /* ignore transient errors */ }
        };

        const id = setInterval(() => void tick(), 3000);

        return () => { alive = false; clearInterval(id); };
    }, [rebuilding]);

    const startRebuild = useCallback(() => {
        void (async () => {
            setRebuildSummary(null);

            if (await run(() => api.rebuildAllRoutes())) {
                setRebuilding(true);
            }
        })();
    }, [run]);

    const checkConfigDb = useCallback(() => {
        void (async () => {
            setConfigBusy('check');

            try {
                let result: IConfigDbStatus | null = null;

                await run(async () => {
                    result = await api.checkConfigDbUpdate();

                    return { message: result.updateAvailable ? `Device-database update available (${result.version})` : 'Device database is up to date' };
                });

                if (result) {
                    setConfigDb(result);
                }
            }
            finally {
                setConfigBusy(null);
            }
        })();
    }, [run]);

    const installConfigDb = useCallback(() => {
        void (async () => {
            setConfigBusy('install');

            try {
                if (await run(() => api.installConfigDbUpdate())) {
                    setConfigDb({ updateAvailable: false });
                }
            }
            finally {
                setConfigBusy(null);
            }
        })();
    }, [run]);

    const reinterviewUnidentified = useCallback(() => {
        void (async () => {
            const targets = [...unidentifiedRef.current];

            setReinterviewing(targets.length);

            try {
                for (const device of targets) {
                    await run(() => api.refreshDevice(device.nodeId));
                    await new Promise(resolve => setTimeout(resolve, ReinterviewSpacingMs));

                    setReinterviewing(remaining => remaining - 1);
                }

                await refresh();
            }
            finally {
                setReinterviewing(0);
            }
        })();
    }, [run, refresh]);

    const dismissRebuildSummary = useCallback(() => setRebuildSummary(null), []);

    return [
        { rebuild, rebuilding, rebuildSummary, configDb, configBusy, reinterviewing },
        { startRebuild, checkConfigDb, installConfigDb, reinterviewUnidentified, dismissRebuildSummary }
    ];
}

// Menu entries for the maintenance actions, in the order they belong in the panel menu
export function maintenanceMenuItems(
    state: MaintenanceState,
    actions: MaintenanceActions,
    unidentifiedCount: number
): { label: string; onSelect: () => void; disabled?: boolean; hint?: string }[] {
    const items = [
        {
            label: state.rebuilding ? 'Rebuilding routes…' : 'Rebuild all routes',
            onSelect: actions.startRebuild,
            disabled: state.rebuilding,
            hint: 'long-running; fixes stale routing'
        },
        {
            label: state.configBusy === 'check' ? 'Checking…' : 'Check device-DB update',
            onSelect: actions.checkConfigDb,
            disabled: state.configBusy !== null,
            hint: 'refreshes named device parameters'
        }
    ];

    if (unidentifiedCount > 0) {
        items.push({
            label: `Re-interview ${unidentifiedCount} unidentified`,
            onSelect: actions.reinterviewUnidentified,
            disabled: state.reinterviewing > 0,
            hint: 'devices with no manufacturer/model'
        });
    }

    return items;
}

// Anything in flight (or waiting on a decision) shows here, under the panel header
export function MaintenanceStatus({ state, actions }: { state: MaintenanceState; actions: MaintenanceActions }) {
    const { rebuild, rebuilding, rebuildSummary, configDb, configBusy, reinterviewing } = state;

    const nothingToShow = !rebuilding
        && !rebuildSummary
        && !configDb?.updateAvailable
        && reinterviewing === 0;

    if (nothingToShow) {
        return null;
    }

    return (
        <div className="maint-status">
            {rebuilding && (
                <div className="maint-line">
                    <span className="spinner" aria-hidden="true" />
                    <span>
                        Rebuilding routes
                        {rebuild ? ` ${rebuild.done + rebuild.failed + rebuild.skipped}/${rebuild.total}` : ''}
                    </span>
                </div>
            )}

            {rebuildSummary && (
                <div className="maint-line">
                    <span>{rebuildSummary}</span>
                    <button className="link-btn" onClick={actions.dismissRebuildSummary}>Dismiss</button>
                </div>
            )}

            {configDb?.updateAvailable && (
                <div className="maint-line">
                    <span>Device-database update available ({configDb.version})</span>
                    <button onClick={actions.installConfigDb} disabled={configBusy !== null}>
                        {configBusy === 'install' ? 'Installing…' : 'Install'}
                    </button>
                    <span className="muted">re-interview a device afterwards to apply it</span>
                </div>
            )}

            {reinterviewing > 0 && (
                <div className="maint-line">
                    <span className="spinner" aria-hidden="true" />
                    <span>Re-interviewing {reinterviewing} device{reinterviewing === 1 ? '' : 's'}…</span>
                </div>
            )}
        </div>
    );
}
