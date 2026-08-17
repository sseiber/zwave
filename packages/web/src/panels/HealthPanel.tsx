import { useState } from 'react';
import type { IHealthSample, IHealthSweep, INetworkHealth, INodeHealth } from '@zwave-service/contracts';
import { HealthState, NodeHealthState } from '@zwave-service/contracts';
import { relativeTime, absoluteTime, clockTime } from '../format.ts';

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

            <HealthChart samples={health.samples} />
            <Legend latest={health.samples.at(-1)} />

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

// Compact summary for the dashboard: the conclusion, and a way through to the detail
export function HealthSummaryCard({ health }: { health: INetworkHealth | null }) {
    return (
        <div className={`card dash-card health-summary${health ? ` ${toneFor(health.state)}` : ''}`}>
            <div className="dash-card-head">
                <h3>Health</h3>
            </div>

            {health
                ? (
                    <div className="health-summary-body">
                        <span className={`health-state ${toneFor(health.state)}`}>
                            <span className="state-dot" aria-hidden="true" />
                            {stateLabel(health.state)}
                        </span>
                        <span className="muted">{health.devices.responding}/{health.devices.total} devices responding</span>
                    </div>
                )
                : <p className="muted">Taking the first reading…</p>}
        </div>
    );
}

//
// Chart
//

interface SeriesSpec {
    key: string;
    className: string;
    // Value for a sample, or undefined where the series has no reading
    value: (sample: IHealthSample) => number | undefined;
    // Map a value into 0 (bottom) - 1 (top)
    scale: (value: number) => number;
    area?: boolean;
}

const Series: SeriesSpec[] = [
    {
        key: 'noise',
        className: 'noise',
        value: sample => sample.noise,
        scale: value => (value - NoiseFloorDbm) / (NoiseCeilingDbm - NoiseFloorDbm),
        area: true
    },
    {
        key: 'errors',
        className: 'errors',
        value: sample => sample.errorRate,
        scale: value => value / ErrorCeiling
    },
    {
        key: 'response',
        className: 'response',
        value: sample => sample.responseMs,
        scale: value => value / ResponseCeilingMs
    }
];

// Noise floor, errors and response time over the retained window. Drawn by hand in SVG
// — three series, no library: the shape is the point, and the legend carries the value.
function HealthChart({ samples }: { samples: IHealthSample[] }) {
    if (samples.length < 2) {
        return <div className="health-chart empty muted">Collecting readings…</div>;
    }

    const width = 300;
    const height = 110;

    const x = (index: number): number => (index / (samples.length - 1)) * width;
    const y = (unit: number): number => height - Math.max(0, Math.min(1, unit)) * height;

    const paths = Series.map((series) => {
        // Gaps matter: a series with no reading yet should not draw a line along zero
        const points = samples
            .map((sample, index) => {
                const value = series.value(sample);

                return value === undefined ? undefined : `${round2(x(index))},${round2(y(series.scale(value)))}`;
            })
            .filter((point): point is string => point !== undefined);

        return { series, points };
    }).filter(entry => entry.points.length > 1);

    const first = samples[0];
    const middle = samples[Math.floor(samples.length / 2)];

    return (
        <div className="health-chart">
            <div className="chart-body">
                {/* Noise reads against the left scale, response against the right; the
                    error line has no axis of its own — its range is in the legend. */}
                <div className="chart-scale left" aria-hidden="true">
                    <span>{NoiseCeilingDbm}</span>
                    <span>{(NoiseCeilingDbm + NoiseFloorDbm) / 2}</span>
                    <span>{NoiseFloorDbm}</span>
                </div>

                <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
                {[0.25, 0.5, 0.75].map(fraction => (
                    <line key={fraction} className="chart-grid" x1={0} x2={width} y1={height * fraction} y2={height * fraction} />
                ))}

                {paths.filter(({ series }) => series.area).map(({ series, points }) => (
                    <polygon
                        key={`${series.key}-area`}
                        className={`chart-area ${series.className}`}
                        points={`0,${height} ${points.join(' ')} ${width},${height}`}
                    />
                ))}

                {paths.map(({ series, points }) => (
                    <polyline key={series.key} className={`chart-line ${series.className}`} points={points.join(' ')} />
                ))}
                </svg>

                <div className="chart-scale right" aria-hidden="true">
                    <span>{ResponseCeilingMs}</span>
                    <span>{ResponseCeilingMs / 2}</span>
                    <span>0</span>
                </div>
            </div>

            <div className="chart-units muted">
                <span>Noise dBm</span>
                <span>Response ms</span>
            </div>

            <div className="chart-axis muted">
                <span>{clockTime(new Date(first.at).getTime())}</span>
                <span>{clockTime(new Date(middle.at).getTime())}</span>
                <span>Now</span>
            </div>
        </div>
    );
}

// Current value of each series, colour-matched to its line
function Legend({ latest }: { latest: IHealthSample | undefined }) {
    if (!latest) {
        return null;
    }

    return (
        <ul className="chart-legend">
            <li className="noise">
                <span className="swatch" aria-hidden="true" />
                Noise <strong>{latest.noise !== undefined ? `${latest.noise} dBm` : '—'}</strong>
            </li>
            <li className="errors" title={`Plotted against a 0-${Math.round(ErrorCeiling * 100)}% range`}>
                <span className="swatch" aria-hidden="true" />
                Errors <strong>{Math.round(latest.errorRate * 100)}%</strong>
                <span className="muted legend-range">of 0-{Math.round(ErrorCeiling * 100)}%</span>
            </li>
            <li className="response">
                <span className="swatch" aria-hidden="true" />
                Response <strong>{latest.responseMs !== undefined ? `${latest.responseMs} ms` : '—'}</strong>
            </li>
        </ul>
    );
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
                                {factor.suggestion && <span className="muted health-factor-detail">{factor.suggestion}</span>}
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

function toneFor(state: HealthState): string {
    return state === HealthState.Good ? 'good' : state === HealthState.Fair ? 'warn' : 'bad';
}

// Phrased as a conclusion the user can act on, not a grade they have to interpret
function stateLabel(state: HealthState): string {
    switch (state) {
        case HealthState.Good:
            return 'Working normally';
        case HealthState.Fair:
            return 'One thing to check';
        default:
            return 'Action needed';
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
