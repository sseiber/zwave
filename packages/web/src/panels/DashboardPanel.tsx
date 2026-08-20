import { useState } from 'react';
import type { IDeviceInfo, INetworkHealth, INodeHealth, IRoom, IScene, ISceneStatus } from '@zwave-service/contracts';
import { DeviceAction, DeviceStatus } from '@zwave-service/contracts';
import { describeSchedule } from '../schedule.ts';
import { toneFor, stateLabel, nodeTone, nodeRank } from '../health.ts';
import { relativeTime, relativeUpcoming, absoluteTime, round } from '../format.ts';

//
// The home screen. Read top to bottom it answers three questions in order of urgency:
// is anything wrong (the hero verdict), what is on right now (Now), and what happens
// next (Rooms, then Schedule).
//
// It used to be four cards of equal weight, and two of them said the same thing —
// "23/23 devices responding" on the Health card and "Offline: 0" on the Devices card
// are one fact wearing two hats. The verdict is now the page's own headline rather
// than a card competing with the others, and the device roll-up is drawn (a dot per
// device) instead of counted in a sentence.
//
// Still read-only: no navigation off the cards (the bottom bar does that) and no
// controls (the Rooms view switches things).
//

interface DashboardPanelProps {
    devices: IDeviceInfo[];
    health: INetworkHealth | null;
    rooms: IRoom[];
    scenes: IScene[];
    statuses: ISceneStatus[];
}

// A device is treated as offline when the driver has marked it dead.
function isOffline(device: IDeviceInfo): boolean {
    return device.status === DeviceStatus.Dead;
}

export function DashboardPanel({ devices, health, rooms, scenes, statuses }: DashboardPanelProps) {
    const onCount = devices.filter(d => d.on === true).length;
    const offlineCount = devices.filter(isOffline).length;
    const totalWatts = devices.reduce((sum, d) => sum + (d.power?.watts ?? 0), 0);
    const hasPower = devices.some(d => d.power?.watts !== undefined);

    return (
        <section className="dashboard">
            <Verdict health={health} />

            <div className="dash-grid">
                <NowCard
                    total={devices.length}
                    on={onCount}
                    offline={offlineCount}
                    totalWatts={hasPower ? totalWatts : undefined}
                    nodes={health?.nodes}
                />
                <RoomsCard rooms={rooms} devices={devices} />
                <ScheduleCard scenes={scenes} statuses={statuses} devices={devices} />
            </div>
        </section>
    );
}

//
// Verdict — the top of the screen, and the only place on it that changes colour
//
// Deliberately not a card: it is the answer to "is everything alright?", so it reads as
// the page speaking rather than as one more box among boxes.
//

function Verdict({ health }: { health: INetworkHealth | null }) {
    if (!health) {
        return (
            <div className="dash-hero">
                <span className="dash-hero-state muted">Taking the first reading…</span>
            </div>
        );
    }

    const tone = toneFor(health.state);

    return (
        <div className={`dash-hero ${tone}`}>
            <span className={`dash-hero-state ${tone}`}>
                <span className="state-dot" aria-hidden="true" />
                {stateLabel(health.state)}
            </span>
            <p className="dash-hero-headline">{health.headline}</p>
        </div>
    );
}

//
// Now — what the house is doing at this moment
//
// The numbers worth reading from across the room, then every device as a dot. The dots
// are the Health view's instrument shown read-only here: all one colour means there is
// nothing to go and look at, which no sentence conveys as fast.
//

interface NowCardProps {
    total: number;
    on: number;
    offline: number;
    totalWatts: number | undefined;
    nodes: INodeHealth[] | undefined;
}

function NowCard({ total, on, offline, totalWatts, nodes }: NowCardProps) {
    const ranked = nodes ? [...nodes].sort((a, b) => nodeRank(a.state) - nodeRank(b.state)) : [];

    return (
        <div className="card dash-card">
            <div className="dash-card-head">
                <h3>Now</h3>
            </div>
            {total === 0
                ? <p className="muted">No devices yet. Add a switch or dimmer from Devices.</p>
                : (
                    <>
                        <div className="stats">
                            <Stat label="On" value={String(on)} sub={`of ${total}`} tone={on > 0 ? 'on' : undefined} />
                            {totalWatts !== undefined && <Stat label="Drawing" value={round(totalWatts, 0)} sub="watts" tone="accent" />}
                            <Stat label="Offline" value={String(offline)} tone={offline > 0 ? 'bad' : undefined} />
                        </div>

                        {ranked.length > 0 && (
                            <div className="dash-dots" aria-label={`${ranked.length} devices`}>
                                {ranked.map(node => (
                                    <span
                                        key={node.nodeId}
                                        className={`mesh-dot ${nodeTone(node.state)}`}
                                        title={node.name}
                                    />
                                ))}
                            </div>
                        )}
                    </>
                )}
        </div>
    );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'on' | 'bad' | 'accent' }) {
    return (
        <div className={`stat${tone ? ` ${tone}` : ''}`}>
            <span className="stat-label">{label}</span>
            <span className="stat-value">
                {value}
                {sub && <span className="stat-sub">{sub}</span>}
            </span>
        </div>
    );
}

//
// Rooms — one tile per room, reporting what is on in it
//

interface RoomsCardProps {
    rooms: IRoom[];
    devices: IDeviceInfo[];
}

// Status only: the dashboard reports what is on where, and the Rooms view is where
// anything actually gets switched.
function RoomsCard({ rooms, devices }: RoomsCardProps) {

    return (
        <div className="card dash-card">
            <div className="dash-card-head">
                <h3>Rooms</h3>
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
                                    <div className={`room-tile${anyOn ? ' on' : ''}`}>
                                        <span className="room-tile-name" title={room.name}>{room.name}</span>
                                        <span className="room-tile-state">
                                            <span className={`room-tile-dot${anyOn ? ' on' : ''}`} aria-hidden="true" />
                                            {members.length === 0 ? 'no devices' : `${onCount}/${members.length} on`}
                                        </span>
                                    </div>
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
}

function ScheduleCard({ scenes, statuses, devices }: ScheduleCardProps) {
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
                                <span title={absoluteTime(new Date(start).toISOString())}>{span(reach)} back</span>
                                <span className="timeline-now-label">now</span>
                                <span title={absoluteTime(new Date(end).toISOString())}>{span(reach)} ahead</span>
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

// How far the timeline reaches on each side of "now". The window can easily span two
// days, which is what made clock-only end labels read as nonsense — "11:54 AM ... now
// ... 9:54 AM" — so the strip says how far it reaches instead of naming two times.
function span(ms: number): string {
    const hours = Math.round(ms / 3600000);

    return hours < 24 ? `${Math.max(1, hours)}h` : `${Math.round(hours / 24)}d`;
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
