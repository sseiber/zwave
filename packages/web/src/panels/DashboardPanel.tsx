import { useEffect, useState } from 'react';
import type { IDeviceInfo, INetworkHealth, INodeHealth, IRoom, IScene, ISceneStatus } from '@zwave-service/contracts';
import { DeviceAction, DeviceStatus, HealthState, NodeHealthState } from '@zwave-service/contracts';
import type { RunFn } from '../types.ts';
import { api } from '../api.ts';
import { describeSchedule } from '../schedule.ts';
import { relativeTime, relativeUpcoming, absoluteTime, clockTime, round } from '../format.ts';

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
                <HealthCard onNavigate={onNavigate} />
                <RoomsCard rooms={rooms} devices={devices} run={run} refresh={refresh} onNavigate={onNavigate} />
                <ScheduleCard scenes={scenes} statuses={statuses} devices={devices} onNavigate={onNavigate} />
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
// Network health
//
// The service folds controller traffic, per-device reliability, latency, signal and the
// RF noise floor into one score. The card shows that as a gauge, a state word and a
// single sentence — three things, one size each. Everything that supports the verdict
// (the reasons, the trend, the raw readings) sits behind the disclosure, so the resting
// state of the card is calm and the numbers are one tap away when they matter.
//

// Health is sampled service-side every 30s; polling faster only re-fetches the same
// verdict, and the background sweep keeps device readings moving underneath it.
const HealthPollMs = 15000;

function HealthCard({ onNavigate }: { onNavigate: (tab: 'devices') => void }) {
    const [health, setHealth] = useState<INetworkHealth | null>(null);
    const [failed, setFailed] = useState(false);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        let alive = true;

        const read = async (): Promise<void> => {
            try {
                const next = await api.getNetworkHealth();

                if (alive) {
                    setHealth(next);
                    setFailed(false);
                }
            }
            catch {
                if (alive) {
                    setFailed(true);
                }
            }
        };

        void read();

        const id = setInterval(() => void read(), HealthPollMs);

        return () => { alive = false; clearInterval(id); };
    }, []);

    if (!health) {
        return (
            <div className="card dash-card">
                <div className="dash-card-head"><h3>Health</h3></div>
                <p className="muted">{failed ? 'Health readings are unavailable.' : 'Taking the first reading…'}</p>
            </div>
        );
    }

    const tone = health.state === HealthState.Good ? 'good' : health.state === HealthState.Fair ? 'warn' : 'bad';
    const problems = health.nodes.filter(node => node.state === NodeHealthState.Offline || node.state === NodeHealthState.Poor);

    return (
        <div className={`card dash-card health ${tone}`}>
            <div className="dash-card-head">
                <h3>Health</h3>
                <button
                    className="scene-details-toggle health-toggle"
                    onClick={() => setOpen(current => !current)}
                    aria-expanded={open}
                    aria-label={open ? 'Hide health details' : 'Show health details'}
                    title="Details"
                >
                    <span className={`chevron${open ? ' open' : ''}`} aria-hidden="true" />
                </button>
            </div>

            {/* The verdict: gauge, state, one sentence. Nothing else at this level. */}
            <div className="health-hero">
                <Gauge score={health.score} tone={tone} />
                <div className="health-verdict">
                    <span className="health-state">{stateLabel(health.state)}</span>
                    <p className="health-headline">{health.headline}</p>
                </div>
            </div>

            <DeviceStrip nodes={health.nodes} problems={problems.length} />

            {open && (
                <div className="health-details">
                    {health.factors.length > 0 && (
                        <ul className="health-factors">
                            {health.factors.slice(0, 3).map(factor => (
                                <li key={factor.label}>
                                    <span className="health-factor-label">{factor.label}</span>
                                    {factor.detail && <span className="muted health-factor-detail">{factor.detail}</span>}
                                </li>
                            ))}
                        </ul>
                    )}

                    <Trend values={health.trend} tone={tone} />

                    <dl className="health-readings">
                        <Reading label="Responding" value={`${health.devices.responding}/${health.devices.total}`} />
                        {health.devices.unmeasured > 0 && <Reading label="Unmeasured" value={String(health.devices.unmeasured)} />}
                        <Reading label="Traffic" value={`${health.traffic.messagesPerMinute}/min`} />
                        <Reading label="Errors" value={`${Math.round(health.traffic.errorRate * 100)}%`} />
                        {health.noise && <Reading label="Noise floor" value={`${health.noise.current} dBm`} />}
                        <Reading label="Updated" value={relativeTime(health.sampledAt)} title={absoluteTime(health.sampledAt)} />
                    </dl>

                    <button className="link-btn" onClick={() => onNavigate('devices')}>Open devices →</button>
                </div>
            )}
        </div>
    );
}

// The score as a ring. The arc length is the score, so "how healthy" reads before any
// number does — and a full ring is the resting state of a well-behaved mesh.
function Gauge({ score, tone }: { score: number; tone: string }) {
    const radius = 34;
    const circumference = 2 * Math.PI * radius;
    const arc = (Math.max(0, Math.min(100, score)) / 100) * circumference;

    return (
        <div className={`gauge ${tone}`}>
            <svg viewBox="0 0 80 80" aria-hidden="true">
                <circle className="gauge-track" cx="40" cy="40" r={radius} />
                <circle
                    className="gauge-arc"
                    cx="40"
                    cy="40"
                    r={radius}
                    strokeDasharray={`${round2(arc)} ${round2(circumference - arc)}`}
                    transform="rotate(-90 40 40)"
                />
            </svg>
            <span className="gauge-value">{score}</span>
        </div>
    );
}

// One dot per device, worst first. Healthy devices stay quiet so the eye is caught by
// the exceptions rather than by a wall of green.
function DeviceStrip({ nodes, problems }: { nodes: INodeHealth[]; problems: number }) {
    if (nodes.length === 0) {
        return null;
    }

    const label = problems > 0
        ? `${problems} device${problems === 1 ? '' : 's'} need attention`
        : `${nodes.length} devices`;

    return (
        <div className="device-strip">
            <div className="mesh-dots" role="img" aria-label={label}>
                {[...nodes]
                    .sort((a, b) => nodeRank(a.state) - nodeRank(b.state))
                    .map(node => (
                        <span
                            key={node.nodeId}
                            className={`mesh-dot ${nodeTone(node.state)}`}
                            title={`${node.name} — ${nodeSummary(node)}`}
                        />
                    ))}
            </div>
        </div>
    );
}

function Reading({ label, value, title }: { label: string; value: string; title?: string }) {
    return (
        <div className="reading" title={title}>
            <dt>{label}</dt>
            <dd>{value}</dd>
        </div>
    );
}

// The score's recent movement. Only shown in the details, since a healthy mesh draws a
// flat line that says nothing at a glance.
function Trend({ values, tone }: { values: number[]; tone: string }) {
    if (values.length < 2) {
        return null;
    }

    const width = 100;
    const height = 24;

    // Anchor the scale to a fixed band, so a mesh sitting at 100 draws a flat line at
    // the top rather than having its noise amplified to fill the box
    const min = Math.min(50, ...values);
    const span = Math.max(1, 100 - min);

    const points = values.map((value, index) => {
        const x = (index / (values.length - 1)) * width;
        const y = height - ((value - min) / span) * height;

        return `${round2(x)},${round2(y)}`;
    });

    return (
        <svg className={`trend ${tone}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
            <polyline points={points.join(' ')} />
        </svg>
    );
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

function stateLabel(state: HealthState): string {
    switch (state) {
        case HealthState.Good:
            return 'Healthy';
        case HealthState.Fair:
            return 'Needs a look';
        default:
            return 'Degraded';
    }
}

function nodeTone(state: NodeHealthState): string {
    switch (state) {
        case NodeHealthState.Good:
            return 'good';
        case NodeHealthState.Fair:
        case NodeHealthState.Poor:
            return 'warn';
        case NodeHealthState.Offline:
            return 'bad';
        default:
            return 'unknown';
    }
}

// Worst first, so the strip reads left-to-right as problems then healthy devices
function nodeRank(state: NodeHealthState): number {
    switch (state) {
        case NodeHealthState.Offline:
            return 0;
        case NodeHealthState.Poor:
            return 1;
        case NodeHealthState.Fair:
            return 2;
        case NodeHealthState.Good:
            return 3;
        default:
            return 4;
    }
}

// Tooltip for a device dot: whatever has actually been measured about it
function nodeSummary(node: INodeHealth): string {
    if (node.state === NodeHealthState.Offline) {
        return 'offline';
    }

    const parts: string[] = [];

    if (node.rssi !== undefined) {
        parts.push(`${node.rssi} dBm`);
    }
    if (node.rtt !== undefined) {
        parts.push(`${node.rtt} ms`);
    }
    if (node.dropRate !== undefined && node.dropRate > 0) {
        parts.push(`${Math.round(node.dropRate * 100)}% failed`);
    }
    if (node.hops !== undefined) {
        parts.push(node.hops === 0 ? 'direct' : `${node.hops} hop${node.hops === 1 ? '' : 's'}`);
    }

    return parts.length > 0 ? parts.join(' · ') : 'not measured yet';
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
    sceneId: string;
    name: string;
    at: number;
    upcoming: boolean;
    failed: boolean;
    // Result message from the last activation (present on past runs)
    message?: string;
}

interface ScheduleCardProps {
    scenes: IScene[];
    statuses: ISceneStatus[];
    devices: IDeviceInfo[];
    onNavigate: (tab: 'scenes') => void;
}

function ScheduleCard({ scenes, statuses, devices, onNavigate }: ScheduleCardProps) {
    // Which dot the user tapped, if any — tapping it again clears the detail
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const nameById = new Map(scenes.map(s => [s.id, s.name]));
    const named = (id: string): string => nameById.get(id) ?? 'Unknown scene';

    const now = Date.now();

    const past: PlottedRun[] = statuses
        .filter(s => s.lastRun)
        .map(s => ({
            key: `p${s.sceneId}`,
            sceneId: s.sceneId,
            name: named(s.sceneId),
            at: new Date(s.lastRun as string).getTime(),
            upcoming: false,
            failed: s.lastResult ? !s.lastResult.succeeded : false,
            message: s.lastResult?.message
        }))
        .filter(r => Number.isFinite(r.at))
        .sort((a, b) => b.at - a.at)
        .slice(0, MaxPlotted);

    const future: PlottedRun[] = statuses
        .filter(s => s.nextRun)
        .map(s => ({
            key: `n${s.sceneId}`,
            sceneId: s.sceneId,
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
    const selected = runs.find(r => r.key === selectedKey);

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
                                <button
                                    key={run.key}
                                    className={`timeline-hit${selectedKey === run.key ? ' selected' : ''}`}
                                    style={{ left: `${position(run.at)}%` }}
                                    aria-label={`${run.name} — ${runWhen(run)}`}
                                    title={`${run.name} — ${runWhen(run)}`}
                                    onClick={() => setSelectedKey(current => (current === run.key ? null : run.key))}
                                >
                                    <span className={`timeline-dot${run.upcoming ? ' next' : ' past'}${run.failed ? ' failed' : ''}`} />
                                </button>
                            ))}
                            <span className="timeline-now" style={{ left: '50%' }} aria-hidden="true" />
                            <div className="timeline-scale">
                                <span>{clockTime(start)}</span>
                                <span className="timeline-now-label">now</span>
                                <span>{clockTime(end)}</span>
                            </div>
                        </div>

                        {/* The summary lines give way to the details of a tapped dot */}
                        {selected
                            ? (
                                <RunDetail
                                    run={selected}
                                    scene={scenes.find(sc => sc.id === selected.sceneId)}
                                    devices={devices}
                                    onClose={() => setSelectedKey(null)}
                                />
                            )
                            : (
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
                            )}
                    </>
                )}
        </div>
    );
}

// When a run happened / will happen, phrased for its direction
function runWhen(run: PlottedRun): string {
    const iso = new Date(run.at).toISOString();

    return run.upcoming ? relativeUpcoming(iso) : relativeTime(iso);
}

// Details for the dot the user tapped: when it ran (or will run), how it went, what
// rule triggers it, and which devices it sets.
function RunDetail({ run, scene, devices, onClose }: { run: PlottedRun; scene: IScene | undefined; devices: IDeviceInfo[]; onClose: () => void }) {
    const iso = new Date(run.at).toISOString();
    const named = (nodeId: number): string => {
        const device = devices.find(d => d.nodeId === nodeId);

        return device ? (device.name || `Node ${device.nodeId}`) : `Node ${nodeId}`;
    };

    return (
        <div className="run-detail">
            <div className="run-detail-head">
                <span className="name">{run.name}</span>
                <button className="link-btn" onClick={onClose} aria-label="Close details">Close</button>
            </div>

            <p className="run-detail-when">
                <span className={`timeline-dot${run.upcoming ? ' next' : ' past'}${run.failed ? ' failed' : ''}`} aria-hidden="true" />
                {run.upcoming ? 'Runs' : 'Ran'} <strong>{runWhen(run)}</strong>
                <span className="muted"> · {absoluteTime(iso)}</span>
            </p>

            {!run.upcoming && run.message && (
                <p className={`run-detail-result${run.failed ? ' run-failed' : ''}`}>{run.message}</p>
            )}

            {run.upcoming && scene?.schedules && scene.schedules.length > 0 && (
                <p className="muted run-detail-rule">{scene.schedules.map(describeSchedule).join(' · ')}</p>
            )}

            {scene && scene.devices.length > 0 && (
                <ul className="run-detail-devices">
                    {scene.devices.map(d => (
                        <li key={d.deviceId}>
                            {named(d.deviceId)} → <strong>{d.action === DeviceAction.Dim ? `dim ${d.level ?? 0}%` : d.action}</strong>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
