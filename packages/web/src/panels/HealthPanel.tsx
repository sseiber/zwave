import { useState } from 'react';
import type { IHealthSample, IHealthSweep, INetworkHealth, INodeHealth } from '@zwave-service/contracts';
import { NodeHealthState } from '@zwave-service/contracts';
import { relativeTime, absoluteTime } from '../format.ts';
import { toneFor, stateLabel, nodeTone, nodeRank } from '../health.ts';

//
// Health — a dedicated view rather than a card squeezed onto the dashboard.
//
// Read top to bottom it is: what state the mesh is in, what it has been doing (chart),
// every device at a glance (dots — the one being swept is ringed, tap any to inspect
// it), then that device's readings as meters. Everything advisory sits below that,
// labelled, so the working surface stays a set of instruments and the words are out of
// the way without being hidden.
//

// Each series is drawn against its own range, so shapes are comparable even though the
// units are not. The legend carries the real value with its unit.
const NoiseFloorDbm = -100;
const NoiseCeilingDbm = -40;
const ErrorCeiling = 0.2;
const ResponseCeilingMs = 1000;

// Z-Wave receivers work to roughly -95 dBm; -50 is about as good as it gets indoors
const SignalFloorDbm = -95;
const SignalCeilingDbm = -50;

// The rates a Z-Wave route can run at
const RouteRates = [9.6, 40, 100];

export function HealthPanel({ health }: { health: INetworkHealth | null }) {
    // Which device's readings are on show. Defaults to whichever needs attention most;
    // tapping a dot pins a different one.
    const [selectedId, setSelectedId] = useState<number | null>(null);

    if (!health) {
        return (
            <section>
                <div className="panel-head"><h2>Health</h2></div>
                <p className="muted">Taking the first reading…</p>
            </section>
        );
    }

    const tone = toneFor(health.state);
    const ranked = [...health.nodes].sort((a, b) => nodeRank(a.state) - nodeRank(b.state));
    const selected = ranked.find(node => node.nodeId === selectedId) ?? ranked[0];
    const median = medianRssi(health.nodes);

    return (
        <section className="health-view">
            <div className="panel-head">
                <h2>Health</h2>
                <span className={`health-state ${tone}`}>
                    <span className="state-dot" aria-hidden="true" />
                    {stateLabel(health.state)}
                </span>
            </div>

            <Trend samples={health.samples} />

            {/* One resting point for the eye between the trends and the devices; without
                it the dots, the sweep line and a card suddenly named "Patio" read as
                three unrelated things rather than one instrument you tap. */}
            <h3 className="health-section-head">Devices</h3>

            <DeviceStrip
                nodes={ranked}
                sweep={health.sweep}
                selectedId={selected?.nodeId}
                onSelect={setSelectedId}
            />

            <SweepLine sweep={health.sweep} />

            {selected && <DeviceMeter node={selected} median={median} />}

            <Notes health={health} />
        </section>
    );
}

//
// Trends
//
// Three sparklines, one per series, rather than one plot carrying all three against two
// different axes. Sharing a plot meant noise (dBm), errors (%) and response time (ms)
// were drawn on scales that have nothing to do with each other, and they all bunched
// along the bottom on top of one another — the old chart had a left axis, a right axis,
// a units row and a colour legend and still could not be read at a glance.
//
// Split apart they need none of that machinery: each row is `label - instrument -
// value`, the same grammar as the device meters below, so the whole view reads as one
// instrument panel instead of a chart followed by some meters.
//

interface TrendSpec {
    key: string;
    label: string;
    // Value for a sample, or undefined where the series has no reading
    value: (sample: IHealthSample) => number | undefined;
    // Map a value into 0 (bottom of the row) - 1 (top)
    scale: (value: number) => number;
    // The current value, written out with its unit
    format: (value: number) => string;
}

// Ranges are fixed rather than fitted to what has been seen. A series that auto-scaled
// would make a quiet mesh's noise wander dramatically across the row; against a fixed
// range, a flat line low down means "almost nothing", which is the truth worth showing.
const Trends: TrendSpec[] = [
    {
        key: 'noise',
        label: 'Noise',
        value: sample => sample.noise,
        scale: value => (value - NoiseFloorDbm) / (NoiseCeilingDbm - NoiseFloorDbm),
        format: value => `${Math.round(value)} dBm`
    },
    {
        key: 'errors',
        label: 'Errors',
        value: sample => sample.errorRate,
        scale: value => value / ErrorCeiling,
        format: value => `${Math.round(value * 100)}%`
    },
    {
        key: 'response',
        label: 'Reply',
        value: sample => sample.responseMs,
        scale: value => value / ResponseCeilingMs,
        format: value => `${Math.round(value)} ms`
    }
];

function Trend({ samples }: { samples: IHealthSample[] }) {
    if (samples.length < 2) {
        return <div className="health-chart empty muted">Collecting readings…</div>;
    }

    return (
        <div className="health-chart">
            {Trends.map(trend => <TrendRow key={trend.key} trend={trend} samples={samples} />)}

            <div className="trend-axis muted">
                <span>{spanLabel(samples)} ago</span>
                <span>now</span>
            </div>
        </div>
    );
}

function TrendRow({ trend, samples }: { trend: TrendSpec; samples: IHealthSample[] }) {
    const width = 100;
    const height = 24;

    // Gaps matter: a series with no reading yet must not draw a line along zero
    const points = samples
        .map((sample, index) => {
            const value = trend.value(sample);
            if (value === undefined) {
                return undefined;
            }

            const x = (index / (samples.length - 1)) * width;
            const y = height - clamp01(trend.scale(value)) * height;

            return `${round2(x)},${round2(y)}`;
        })
        .filter((point): point is string => point !== undefined);

    const latest = [...samples].reverse().map(trend.value).find(value => value !== undefined);

    return (
        <div className="trend-row">
            <span className="meter-label">{trend.label}</span>
            <span className={`trend-spark ${trend.key}`}>
                {points.length > 1 && (
                    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
                        <polygon className="trend-area" points={`0,${height} ${points.join(' ')} ${width},${height}`} />
                        <polyline className="trend-line" points={points.join(' ')} />
                    </svg>
                )}
            </span>
            <span className="meter-value">{latest === undefined ? '—' : trend.format(latest)}</span>
        </div>
    );
}

// How far back the retained samples reach
function spanLabel(samples: IHealthSample[]): string {
    const ms = new Date(samples[samples.length - 1].at).getTime() - new Date(samples[0].at).getTime();
    const minutes = Math.round(ms / 60000);

    return minutes < 90 ? `${Math.max(1, minutes)}m` : `${Math.round(minutes / 60)}h`;
}

//
// Devices
//

interface DeviceStripProps {
    nodes: INodeHealth[];
    sweep: IHealthSweep | undefined;
    selectedId: number | undefined;
    onSelect: (nodeId: number) => void;
}

// Every device as a dot, worst first. The device the sweep is measuring is ringed (and
// pulses while the ping is in flight), so the row visibly works its way around the mesh.
function DeviceStrip({ nodes, sweep, selectedId, onSelect }: DeviceStripProps) {
    if (nodes.length === 0) {
        return null;
    }

    return (
        <div className="device-strip">
            {nodes.map((node) => {
                const sweeping = sweep?.nodeId === node.nodeId;

                return (
                    <button
                        key={node.nodeId}
                        className={`dot-hit${sweeping ? ' sweeping' : ''}${sweeping && sweep?.active ? ' active' : ''}${selectedId === node.nodeId ? ' selected' : ''}`}
                        onClick={() => onSelect(node.nodeId)}
                        aria-pressed={selectedId === node.nodeId}
                        aria-label={`${node.name} — ${nodeSummary(node)}`}
                        title={`${node.name} — ${nodeSummary(node)}`}
                    >
                        <span className={`mesh-dot ${nodeTone(node.state)}`} />
                    </button>
                );
            })}
        </div>
    );
}

// One short line naming what the sweep last measured
function SweepLine({ sweep }: { sweep: IHealthSweep | undefined }) {
    if (!sweep) {
        return null;
    }

    if (sweep.active) {
        return <p className="sweep-line active">Checking {sweep.name}…</p>;
    }

    return (
        <p className="sweep-line muted" title={absoluteTime(sweep.at)}>
            {sweep.name} · {sweep.ok && sweep.rtt !== undefined ? `${sweep.rtt} ms` : 'no answer'} · {relativeTime(sweep.at)}
        </p>
    );
}

// The selected device, as meters: signal against the usable range with the mesh median
// marked, route rate as segments, and how many commands it answers.
function DeviceMeter({ node, median }: { node: INodeHealth; median: number | undefined }) {
    const tone = nodeTone(node.state);
    const replies = node.dropRate === undefined ? undefined : 1 - node.dropRate;
    const measured = node.rssi !== undefined || node.dataRate !== undefined || replies !== undefined;

    return (
        <div className={`device-meter ${tone}`}>
            <div className="device-meter-head">
                <DeviceIcon offline={node.state === NodeHealthState.Offline} />
                <span className="device-meter-name">{node.name}</span>
                {node.hops !== undefined && (
                    <span className="muted device-meter-hops">{node.hops === 0 ? 'direct' : `${node.hops} hop${node.hops === 1 ? '' : 's'}`}</span>
                )}
            </div>

            {!measured && <p className="muted meter-empty">Not measured yet — the sweep will reach it shortly.</p>}

            {node.rssi !== undefined && (
                <Meter
                    label="Signal"
                    value={`${node.rssi} dBm`}
                    fill={clamp01((node.rssi - SignalFloorDbm) / (SignalCeilingDbm - SignalFloorDbm))}
                    tone={tone}
                    marker={median === undefined ? undefined : clamp01((median - SignalFloorDbm) / (SignalCeilingDbm - SignalFloorDbm))}
                    markerLabel={median === undefined ? undefined : `Typical for this mesh: ${median} dBm`}
                />
            )}

            {node.dataRate !== undefined && (
                <div className="meter-row">
                    <span className="meter-label">Route</span>
                    <span className="segments" role="img" aria-label={`${node.dataRate} kbps`}>
                        {RouteRates.map(rate => (
                            <span key={rate} className={`segment${(node.dataRate ?? 0) >= rate ? ` on ${tone}` : ''}`} />
                        ))}
                    </span>
                    <span className="meter-value">{node.dataRate} kbps</span>
                </div>
            )}

            {replies !== undefined && (
                <Meter
                    label="Replies"
                    value={`${Math.round(replies * 100)}%`}
                    fill={clamp01(replies)}
                    tone={replies > 0.95 ? 'good' : tone}
                />
            )}
        </div>
    );
}

interface MeterProps {
    label: string;
    value: string;
    fill: number;
    tone: string;
    // Position (0-1) of a comparison mark on the same scale
    marker?: number;
    markerLabel?: string;
}

function Meter({ label, value, fill, tone, marker, markerLabel }: MeterProps) {
    return (
        <div className="meter-row">
            <span className="meter-label">{label}</span>
            <span className="meter-track">
                <span className={`meter-fill ${tone}`} style={{ width: `${Math.round(fill * 100)}%` }} />
                {marker !== undefined && (
                    <span className="meter-marker" style={{ left: `${Math.round(marker * 100)}%` }} title={markerLabel} />
                )}
            </span>
            <span className="meter-value">{value}</span>
        </div>
    );
}

function DeviceIcon({ offline }: { offline: boolean }) {
    return (
        <svg className={`device-icon${offline ? ' offline' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
            <rect x="5" y="3" width="14" height="18" rx="3" />
            <circle cx="12" cy="9" r="2" />
            <path d="M9 16h6" />
        </svg>
    );
}

// Everything advisory, at the bottom where it belongs — below the instruments, but in
// plain sight rather than behind a disclosure. Each block is labelled so the wall of
// numbers above has something naming what it means.
function Notes({ health }: { health: INetworkHealth }) {
    return (
        <div className="health-notes">
            <section className="health-note">
                <h3 className="health-note-head">What to do</h3>
                <p className="health-advice">{health.advice}</p>
            </section>

            {health.factors.length > 0 && (
                <section className="health-note">
                    <h3 className="health-note-head">Why</h3>
                    <ul className="health-factors">
                        {health.factors.map(factor => (
                            <li key={factor.label}>
                                <span className="health-factor-label">{factor.label}</span>
                                {factor.detail && <span className="muted health-factor-detail">{factor.detail}</span>}
                                {factor.suggestion && <span className="health-factor-do">{factor.suggestion}</span>}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <section className="health-note">
                <h3 className="health-note-head">Readings</h3>
                <dl className="health-readings">
                    <Reading label="Score" value={String(health.score)} />
                    <Reading label="Responding" value={`${health.devices.responding}/${health.devices.total}`} />
                    {health.devices.unmeasured > 0 && <Reading label="Unmeasured" value={String(health.devices.unmeasured)} />}
                    <Reading label="Traffic" value={`${health.traffic.messagesPerMinute}/min`} />
                    <Reading label="Updated" value={relativeTime(health.sampledAt)} title={absoluteTime(health.sampledAt)} />
                </dl>
            </section>
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

//
// Shared helpers
//

function round2(value: number): number {
    return Math.round(value * 100) / 100;
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

// What signal looks like across this mesh, so one device can be judged against its peers
function medianRssi(nodes: INodeHealth[]): number | undefined {
    const values = nodes
        .map(node => node.rssi)
        .filter((rssi): rssi is number => typeof rssi === 'number')
        .sort((a, b) => a - b);

    if (values.length === 0) {
        return undefined;
    }

    return values[Math.floor(values.length / 2)];
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}
