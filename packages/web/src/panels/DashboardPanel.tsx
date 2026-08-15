import type { IDeviceInfo, IRoom, IScene, ISceneStatus } from '@zwave-service/contracts';
import { DeviceAction, DeviceStatus } from '@zwave-service/contracts';
import type { RunFn } from '../types.ts';
import { api } from '../api.ts';
import { relativeTime, relativeUpcoming, absoluteTime, clockTime, signal, round } from '../format.ts';

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
                <MeshCard devices={devices} onNavigate={onNavigate} />
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
                ? <p className="muted">No devices yet. Add a switch or dimmer from Devices.</p>
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

//
// Mesh health
//
// Every device is represented, but as a dot rather than a row — a 24-node mesh reads
// as two rows of dots instead of 24 lines. Only the nodes worth acting on are spelled
// out underneath; healthy ones stay a count.
//

type MeshTone = 'good' | 'warn' | 'bad' | 'unknown';

function meshTone(device: IDeviceInfo): MeshTone {
    if (isOffline(device)) {
        return 'bad';
    }
    if (device.link?.rssi === undefined) {
        return 'unknown';
    }

    return signal(device.link.rssi).level >= 2 ? 'good' : 'warn';
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

function deviceName(device: IDeviceInfo): string {
    return device.name || `Node ${device.nodeId}`;
}

// Weakest / most-troubled nodes first: dead before alive, then by ascending RSSI
// (missing RSSI sorts last).
function meshRank(device: IDeviceInfo): [number, number] {
    return [isOffline(device) ? 0 : 1, device.link?.rssi ?? Infinity];
}

// How many flagged nodes to name before collapsing the rest into a count
const MaxFlagged = 3;

interface MeshCardProps {
    devices: IDeviceInfo[];
    onNavigate: (tab: 'devices') => void;
}

function MeshCard({ devices, onNavigate }: MeshCardProps) {
    const sorted = [...devices].sort((a, b) => {
        const [ad, ar] = meshRank(a);
        const [bd, br] = meshRank(b);
        return ad - bd || ar - br;
    });

    const tones = sorted.map(meshTone);
    const count = (tone: MeshTone): number => tones.filter(t => t === tone).length;

    // Offline and weak nodes are the ones a person can actually act on; "no reading"
    // is normal for a node that simply hasn't been talked to yet.
    const flagged = sorted.filter(d => meshTone(d) === 'bad' || meshTone(d) === 'warn');

    const summary = [
        count('good') > 0 ? `${count('good')} strong` : undefined,
        count('warn') > 0 ? `${count('warn')} weak` : undefined,
        count('bad') > 0 ? `${count('bad')} offline` : undefined,
        count('unknown') > 0 ? `${count('unknown')} no reading` : undefined
    ].filter(Boolean).join(' · ');

    return (
        <div className="card dash-card">
            <div className="dash-card-head">
                <h3>Mesh health</h3>
                {flagged.length > 0
                    ? <span className="pill dead">{flagged.length} to watch</span>
                    : devices.length > 0 && <span className="pill ok">all healthy</span>}
            </div>

            {devices.length === 0
                ? <p className="muted">No devices to report on yet.</p>
                : (
                    <>
                        <div className="mesh-dots" role="img" aria-label={`Mesh health: ${summary}`}>
                            {sorted.map((device, index) => (
                                <span
                                    key={device.nodeId}
                                    className={`mesh-dot ${tones[index]}`}
                                    title={`${deviceName(device)} — ${meshLabel(device)}`}
                                />
                            ))}
                        </div>

                        <p className="mesh-summary muted">{summary}</p>

                        {flagged.length > 0 && (
                            <ul className="mesh-flags">
                                {flagged.slice(0, MaxFlagged).map(device => (
                                    <li key={device.nodeId} className="mesh-flag">
                                        <span className={`mesh-dot ${meshTone(device)}`} aria-hidden="true" />
                                        <span className="mesh-flag-name">{deviceName(device)}</span>
                                        <span className="mesh-flag-state">{meshLabel(device)}</span>
                                        <span className="mesh-flag-seen muted" title={absoluteTime(device.link?.lastSeen)}>
                                            {relativeTime(device.link?.lastSeen)}
                                        </span>
                                    </li>
                                ))}
                                {flagged.length > MaxFlagged && (
                                    <li className="mesh-flag more muted">
                                        +{flagged.length - MaxFlagged} more —{' '}
                                        <button className="link-btn" onClick={() => onNavigate('devices')}>see all devices</button>
                                    </li>
                                )}
                            </ul>
                        )}
                    </>
                )}
        </div>
    );
}

//
// Rooms — one tile per room, tapped to toggle the whole room
//

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
                ? <p className="muted">No rooms yet. Group devices from Rooms.</p>
                : (
                    <ul className="room-tiles">
                        {rooms.map(room => {
                            const members = devices.filter(d => room.deviceIds.includes(d.nodeId));
                            const onCount = members.filter(d => d.on === true).length;
                            const anyOn = onCount > 0;

                            return (
                                <li key={room.id}>
                                    {/* One tap toggles the room: everything off if anything is on, else all on */}
                                    <button
                                        className={`room-tile${anyOn ? ' on' : ''}`}
                                        disabled={members.length === 0}
                                        title={anyOn ? `Turn ${room.name} off` : `Turn ${room.name} on`}
                                        onClick={() => void control(room, anyOn ? DeviceAction.Off : DeviceAction.On)}
                                    >
                                        <span className="room-tile-name">{room.name}</span>
                                        <span className="room-tile-state">
                                            <span className={`room-tile-dot${anyOn ? ' on' : ''}`} aria-hidden="true" />
                                            {members.length === 0 ? 'no devices' : `${onCount}/${members.length} on`}
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
        </div>
    );
}

//
// Schedule — a timeline strip instead of two lists
//
// Runs are plotted on one track around a "now" marker: filled dots behind it are recent
// activations, hollow dots ahead are planned ones. The window stretches to fit whatever
// is plotted, so the strip is a fixed height no matter how many scenes exist.
//

// How many runs to plot on each side of "now"
const MaxPlotted = 4;

// Smallest window half-width, so a single run a few minutes away doesn't sit on the edge
const MinWindowMs = 60 * 60 * 1000;

interface PlottedRun {
    key: string;
    name: string;
    at: number;
    upcoming: boolean;
    failed: boolean;
}

interface ScheduleCardProps {
    scenes: IScene[];
    statuses: ISceneStatus[];
    onNavigate: (tab: 'scenes') => void;
}

function ScheduleCard({ scenes, statuses, onNavigate }: ScheduleCardProps) {
    const nameById = new Map(scenes.map(s => [s.id, s.name]));
    const named = (id: string): string => nameById.get(id) ?? 'Unknown scene';

    const now = Date.now();

    const past: PlottedRun[] = statuses
        .filter(s => s.lastRun)
        .map(s => ({
            key: `p${s.sceneId}`,
            name: named(s.sceneId),
            at: new Date(s.lastRun as string).getTime(),
            upcoming: false,
            failed: s.lastResult ? !s.lastResult.succeeded : false
        }))
        .filter(r => Number.isFinite(r.at))
        .sort((a, b) => b.at - a.at)
        .slice(0, MaxPlotted);

    const future: PlottedRun[] = statuses
        .filter(s => s.nextRun)
        .map(s => ({
            key: `n${s.sceneId}`,
            name: named(s.sceneId),
            at: new Date(s.nextRun as string).getTime(),
            upcoming: true,
            failed: false
        }))
        .filter(r => Number.isFinite(r.at))
        .sort((a, b) => a.at - b.at)
        .slice(0, MaxPlotted);

    const runs = [...past, ...future];

    // Symmetric window so "now" sits in the middle and both sides stay readable, with
    // a little headroom so the outermost run doesn't sit on the very edge
    const reach = Math.max(
        MinWindowMs,
        ...runs.map(r => Math.abs(r.at - now) * 1.15)
    );
    const start = now - reach;
    const end = now + reach;
    const position = (at: number): number => ((at - start) / (end - start)) * 100;

    const lastRun = past[0];
    const nextRun = future[0];

    return (
        <div className="card dash-card">
            <div className="dash-card-head">
                <h3>Schedule</h3>
                <button className="link-btn" onClick={() => onNavigate('scenes')}>Scenes</button>
            </div>

            {runs.length === 0
                ? <p className="muted">No scheduled or recent scene runs yet.</p>
                : (
                    <>
                        <div className="timeline">
                            <div className="timeline-track" />
                            {runs.map(run => (
                                <span
                                    key={run.key}
                                    className={`timeline-dot${run.upcoming ? ' next' : ' past'}${run.failed ? ' failed' : ''}`}
                                    style={{ left: `${position(run.at)}%` }}
                                    title={`${run.name} — ${run.upcoming ? relativeUpcoming(new Date(run.at).toISOString()) : relativeTime(new Date(run.at).toISOString())}`}
                                />
                            ))}
                            <span className="timeline-now" style={{ left: '50%' }} aria-hidden="true" />
                            <div className="timeline-scale">
                                <span>{clockTime(start)}</span>
                                <span className="timeline-now-label">now</span>
                                <span>{clockTime(end)}</span>
                            </div>
                        </div>

                        <dl className="sched-lines">
                            {nextRun && (
                                <div className="sched-line">
                                    <dt className="k">Next</dt>
                                    <dd className="v">{nextRun.name}</dd>
                                    <dd className="t" title={absoluteTime(new Date(nextRun.at).toISOString())}>
                                        {relativeUpcoming(new Date(nextRun.at).toISOString())}
                                    </dd>
                                </div>
                            )}
                            {lastRun && (
                                <div className="sched-line">
                                    <dt className="k">Last</dt>
                                    <dd className="v">
                                        {lastRun.name}
                                        {lastRun.failed && <span className="run-failed"> · failed</span>}
                                    </dd>
                                    <dd className="t" title={absoluteTime(new Date(lastRun.at).toISOString())}>
                                        {relativeTime(new Date(lastRun.at).toISOString())}
                                    </dd>
                                </div>
                            )}
                        </dl>
                    </>
                )}
        </div>
    );
}
