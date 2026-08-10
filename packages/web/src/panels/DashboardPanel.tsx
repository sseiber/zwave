import { useEffect, useState } from 'react';
import type { IDeviceInfo, IRoom, IScene, ISceneStatus, IRebuildRoutesStatus } from '@zwave-service/contracts';
import { DeviceAction, DeviceStatus } from '@zwave-service/contracts';
import type { RunFn } from '../types.ts';
import { api } from '../api.ts';
import { relativeTime, relativeUpcoming, absoluteTime, signal, round } from '../format.ts';

interface DashboardPanelProps {
    devices: IDeviceInfo[];
    rooms: IRoom[];
    scenes: IScene[];
    statuses: ISceneStatus[];
    run: RunFn;
    refresh: () => Promise<void>;
    onNavigate: (tab: 'devices' | 'rooms' | 'scenes') => void;
}

// A device is treated as offline when the driver has marked it dead.
function isOffline(device: IDeviceInfo): boolean {
    return device.status === DeviceStatus.Dead;
}

export function DashboardPanel({ devices, rooms, scenes, statuses, run, refresh, onNavigate }: DashboardPanelProps) {
    const onCount = devices.filter(d => d.on === true).length;
    const offlineCount = devices.filter(isOffline).length;
    const totalWatts = devices.reduce((sum, d) => sum + (d.power?.watts ?? 0), 0);
    const hasPower = devices.some(d => d.power?.watts !== undefined);

    return (
        <section className="dashboard">
            <div className="dash-grid">
                <GlanceCard
                    total={devices.length}
                    on={onCount}
                    offline={offlineCount}
                    totalWatts={hasPower ? totalWatts : undefined}
                    onNavigate={onNavigate}
                />
                <MeshCard devices={devices} run={run} refresh={refresh} onNavigate={onNavigate} />
                <RoomsCard rooms={rooms} devices={devices} run={run} refresh={refresh} onNavigate={onNavigate} />
                <ScheduleCard scenes={scenes} statuses={statuses} onNavigate={onNavigate} />
            </div>
        </section>
    );
}

interface GlanceCardProps {
    total: number;
    on: number;
    offline: number;
    totalWatts: number | undefined;
    onNavigate: (tab: 'devices') => void;
}

function GlanceCard({ total, on, offline, totalWatts, onNavigate }: GlanceCardProps) {
    return (
        <div className="card dash-card">
            <div className="dash-card-head">
                <h3>Devices</h3>
                <button className="link-btn" onClick={() => onNavigate('devices')}>View all</button>
            </div>
            {total === 0
                ? <p className="muted">No devices yet. Add a switch or dimmer from the Devices tab.</p>
                : (
                    <div className="stats">
                        <Stat label="Total" value={String(total)} />
                        <Stat label="On" value={String(on)} tone="on" />
                        <Stat label="Offline" value={String(offline)} tone={offline > 0 ? 'bad' : undefined} />
                        {totalWatts !== undefined && <Stat label="Power" value={`${round(totalWatts)} W`} tone="accent" />}
                    </div>
                )}
        </div>
    );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'on' | 'bad' | 'accent' }) {
    return (
        <div className={`stat${tone ? ` ${tone}` : ''}`}>
            <span className="stat-value">{value}</span>
            <span className="stat-label">{label}</span>
        </div>
    );
}

interface MeshCardProps {
    devices: IDeviceInfo[];
    run: RunFn;
    refresh: () => Promise<void>;
    onNavigate: (tab: 'devices') => void;
}

// Weakest / most-troubled nodes first, so the diagnostic ones surface at the top:
// dead before alive, then by ascending RSSI (missing RSSI sorts last).
function meshRank(device: IDeviceInfo): [number, number] {
    const deadness = isOffline(device) ? 0 : 1;
    const rssi = device.link?.rssi ?? Infinity;
    return [deadness, rssi];
}

function MeshCard({ devices, run, refresh, onNavigate }: MeshCardProps) {
    const unidentified = devices.filter(d => !d.manufacturer);
    const sorted = [...devices].sort((a, b) => {
        const [ad, ar] = meshRank(a);
        const [bd, br] = meshRank(b);
        return ad - bd || ar - br;
    });

    const flagged = sorted.filter(d => isOffline(d) || (d.link?.rssi !== undefined && signal(d.link.rssi).level <= 1)).length;

    return (
        <div className="card dash-card">
            <div className="dash-card-head">
                <h3>Mesh health</h3>
                {flagged > 0 && <span className="pill dead">{flagged} to watch</span>}
            </div>
            {devices.length === 0
                ? <p className="muted">No devices to report on yet.</p>
                : (
                    <ul className="mesh-list">
                        {sorted.map(device => (
                            <li key={device.nodeId} className="mesh-row">
                                <span className={`dot ${meshTone(device)}`} aria-hidden="true" />
                                <span className="mesh-name">{device.name || `Node ${device.nodeId}`}</span>
                                <span className="mesh-signal">{meshLabel(device)}</span>
                                <span className="mesh-seen muted" title={absoluteTime(device.link?.lastSeen)}>
                                    {relativeTime(device.link?.lastSeen)}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            <div className="mesh-maint">
                <RebuildControl run={run} />
                {unidentified.length > 0 && (
                    <ReinterviewUnidentified devices={unidentified} run={run} refresh={refresh} />
                )}
            </div>

            <p className="muted hint">
                Signal accumulates passively; open a device and “Test link” for a fresh reading.
                {' '}
                <button className="link-btn" onClick={() => onNavigate('devices')}>Devices →</button>
            </p>
        </div>
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

function meshTone(device: IDeviceInfo): string {
    if (isOffline(device)) {
        return 'bad';
    }
    if (device.link?.rssi === undefined) {
        return 'unknown';
    }
    const level = signal(device.link.rssi).level;
    return level >= 2 ? 'good' : 'warn';
}

function meshLabel(device: IDeviceInfo): string {
    if (isOffline(device)) {
        return 'Offline';
    }
    if (device.link?.rssi === undefined) {
        return 'No reading';
    }
    return signal(device.link.rssi).label;
}

interface RoomsCardProps {
    rooms: IRoom[];
    devices: IDeviceInfo[];
    run: RunFn;
    refresh: () => Promise<void>;
    onNavigate: (tab: 'rooms') => void;
}

function RoomsCard({ rooms, devices, run, refresh, onNavigate }: RoomsCardProps) {
    const control = async (room: IRoom, action: DeviceAction): Promise<void> => {
        if (await run(() => api.controlRoom(room.id, { action }))) {
            await refresh();
        }
    };

    return (
        <div className="card dash-card">
            <div className="dash-card-head">
                <h3>Rooms</h3>
                <button className="link-btn" onClick={() => onNavigate('rooms')}>Manage</button>
            </div>
            {rooms.length === 0
                ? <p className="muted">No rooms yet. Group devices from the Rooms tab.</p>
                : (
                    <ul className="room-quick">
                        {rooms.map(room => (
                            <li key={room.id} className="room-quick-row">
                                <span className="room-quick-name">
                                    {room.name}
                                    <span className="muted"> · {onlineDeviceCount(room, devices)} device{room.deviceIds.length === 1 ? '' : 's'}</span>
                                </span>
                                <span className="room-quick-controls">
                                    <button onClick={() => void control(room, DeviceAction.On)} disabled={room.deviceIds.length === 0}>All on</button>
                                    <button onClick={() => void control(room, DeviceAction.Off)} disabled={room.deviceIds.length === 0}>All off</button>
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
        </div>
    );
}

function onlineDeviceCount(room: IRoom, devices: IDeviceInfo[]): number {
    return room.deviceIds.filter(id => devices.some(d => d.nodeId === id)).length;
}

interface ScheduleCardProps {
    scenes: IScene[];
    statuses: ISceneStatus[];
    onNavigate: (tab: 'scenes') => void;
}

function ScheduleCard({ scenes, statuses, onNavigate }: ScheduleCardProps) {
    const nameById = new Map(scenes.map(s => [s.id, s.name]));
    const named = (id: string): string => nameById.get(id) ?? 'Unknown scene';

    const upcoming = statuses
        .filter(s => s.nextRun)
        .sort((a, b) => new Date(a.nextRun!).getTime() - new Date(b.nextRun!).getTime())
        .slice(0, 4);

    const recent = statuses
        .filter(s => s.lastRun)
        .sort((a, b) => new Date(b.lastRun!).getTime() - new Date(a.lastRun!).getTime())
        .slice(0, 4);

    return (
        <div className="card dash-card">
            <div className="dash-card-head">
                <h3>Schedule</h3>
                <button className="link-btn" onClick={() => onNavigate('scenes')}>Scenes</button>
            </div>

            {upcoming.length === 0 && recent.length === 0
                ? <p className="muted">No scheduled or recent scene runs yet.</p>
                : (
                    <>
                        {upcoming.length > 0 && (
                            <div className="sched-group">
                                <h4>Upcoming</h4>
                                <ul className="sched-list">
                                    {upcoming.map(s => (
                                        <li key={s.sceneId}>
                                            <span className="sched-name">{named(s.sceneId)}</span>
                                            <span className="sched-when" title={absoluteTime(s.nextRun)}>{relativeUpcoming(s.nextRun)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {recent.length > 0 && (
                            <div className="sched-group">
                                <h4>Recent</h4>
                                <ul className="sched-list">
                                    {recent.map(s => (
                                        <li key={s.sceneId}>
                                            <span className="sched-name">
                                                {named(s.sceneId)}
                                                {s.lastResult && !s.lastResult.succeeded && <span className="run-failed" title={s.lastResult.message}> · failed</span>}
                                            </span>
                                            <span className="sched-when muted" title={absoluteTime(s.lastRun)}>{relativeTime(s.lastRun)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </>
                )}
        </div>
    );
}
