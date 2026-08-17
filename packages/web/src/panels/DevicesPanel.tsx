import { useEffect, useState } from 'react';
import type { IDeviceInfo, IHealthCheckResult, IDeviceConfigParam } from '@zwave-service/contracts';
import { DeviceAction, DeviceStatus, DeviceType } from '@zwave-service/contracts';
import type { RunFn } from '../types.ts';
import { api } from '../api.ts';
import { relativeTime, signal, round } from '../format.ts';
import { ActionMenu } from './ActionMenu.tsx';
import { MaintenanceStatus, maintenanceMenuItems, useMaintenance } from './Maintenance.tsx';

interface DevicesPanelProps {
    devices: IDeviceInfo[];
    run: RunFn;
    refresh: () => Promise<void>;
}

//
// Filters. Each one only appears when at least one device matches it, so the row stays
// short on a small network and grows only where it earns its place — a mesh with no
// battery or metered devices never shows those chips.
//
interface DeviceFilter {
    key: string;
    label: string;
    matches: (device: IDeviceInfo) => boolean;
}

const DeviceFilters: DeviceFilter[] = [
    { key: 'on', label: 'On', matches: device => device.on === true },
    { key: 'off', label: 'Off', matches: device => device.on === false },
    { key: 'online', label: 'Online', matches: device => device.status !== DeviceStatus.Dead },
    { key: 'offline', label: 'Offline', matches: device => device.status === DeviceStatus.Dead },
    { key: 'dimmer', label: 'Dimmers', matches: device => device.type === DeviceType.Dimmer },
    { key: 'switch', label: 'Switches', matches: device => device.type === DeviceType.Switch },
    { key: 'metered', label: 'Metered', matches: device => device.power?.watts !== undefined },
    { key: 'battery', label: 'Battery', matches: device => device.battery !== undefined },
    { key: 'unidentified', label: 'Unidentified', matches: device => !device.manufacturer }
];

export function DevicesPanel({ devices, run, refresh }: DevicesPanelProps) {
    const [including, setIncluding] = useState(false);
    const [filter, setFilter] = useState<string | null>(null);
    const [maintState, maintActions] = useMaintenance({ devices, run, refresh });
    const unidentifiedCount = devices.filter(d => !d.manufacturer).length;

    // Only offer a filter that would actually select something, and drop a filter that
    // stops matching (e.g. the last offline device came back) rather than showing none
    const available = DeviceFilters
        .map(entry => ({ ...entry, count: devices.filter(entry.matches).length }))
        .filter(entry => entry.count > 0 && entry.count < devices.length);

    const active = available.find(entry => entry.key === filter);
    const shown = active ? devices.filter(active.matches) : devices;

    const control = async (nodeId: number, action: DeviceAction, level?: number): Promise<void> => {
        if (await run(() => api.controlDevice(nodeId, { action, level }))) {
            await refresh();
        }
    };

    const startInclusion = async (): Promise<void> => {
        if (await run(() => api.startInclusion({ secure: false }))) {
            setIncluding(true);
        }
    };

    const stopInclusion = async (): Promise<void> => {
        if (await run(() => api.stopInclusion())) {
            setIncluding(false);
            await refresh();
        }
    };

    return (
        <section>
            <div className="panel-head">
                <h2>Devices</h2>
                {including
                    ? <button className="warn" onClick={() => void stopInclusion()}>Stop inclusion</button>
                    : (
                        <ActionMenu
                            label="Device actions"
                            items={[
                                { label: 'Add device', onSelect: () => void startInclusion(), hint: 'insecure inclusion' },
                                ...maintenanceMenuItems(maintState, maintActions, unidentifiedCount)
                            ]}
                        />
                    )}
            </div>

            {including && <div className="banner status">Inclusion is active — activate pairing on the physical device now.</div>}

            <MaintenanceStatus state={maintState} actions={maintActions} />

            {available.length > 1 && (
                <div className="filters" role="group" aria-label="Filter devices">
                    <button
                        className={filter === null ? 'chip active' : 'chip'}
                        onClick={() => setFilter(null)}
                    >
                        All <span className="chip-count">{devices.length}</span>
                    </button>
                    {available.map(entry => (
                        <button
                            key={entry.key}
                            className={filter === entry.key ? 'chip active' : 'chip'}
                            onClick={() => setFilter(current => (current === entry.key ? null : entry.key))}
                        >
                            {entry.label} <span className="chip-count">{entry.count}</span>
                        </button>
                    ))}
                </div>
            )}

            {devices.length === 0
                ? <p className="muted">No devices yet. Use “Add device” and pair a switch or dimmer.</p>
                : (
                    <ul className="cards">
                        {shown.map(device => (
                            <DeviceCard key={device.nodeId} device={device} onControl={control} run={run} refresh={refresh} />
                        ))}
                    </ul>
                )}
        </section>
    );
}

interface DeviceCardProps {
    device: IDeviceInfo;
    onControl: (nodeId: number, action: DeviceAction, level?: number) => Promise<void>;
    run: RunFn;
    refresh: () => Promise<void>;
}

function DeviceCard({ device, onControl, run, refresh }: DeviceCardProps) {
    const isDimmer = device.type === DeviceType.Dimmer;
    const [level, setLevel] = useState(device.level ?? 0);
    const [open, setOpen] = useState(false);

    // Keep the slider in sync when polling brings new state
    useEffect(() => {
        setLevel(device.level ?? 0);
    }, [device.level]);

    const ramping = device.targetLevel !== undefined && device.targetLevel !== device.level;

    return (
        <li className={`card device ${device.on ? 'on' : 'off'}`}>
            <div className="card-head">
                <span className="name">{device.name || `Node ${device.nodeId}`}</span>
                <span className={`pill ${device.status}`}>{device.status}</span>
            </div>
            <div className="meta">
                <span>node {device.nodeId}</span>
                <span>{device.type}</span>
                {device.on !== undefined && (
                    <span>{device.on ? 'on' : 'off'}{isDimmer && device.level !== undefined ? ` · ${device.level}%` : ''}</span>
                )}
                {ramping && <span className="muted">→ {device.targetLevel}%</span>}
                {device.power?.watts !== undefined && <span className="power-badge">{round(device.power.watts)} W</span>}
                {device.link?.rssi !== undefined && <span className={`signal s${signal(device.link.rssi).level}`}>{signal(device.link.rssi).label}</span>}
            </div>
            <div className="controls">
                <button onClick={() => void onControl(device.nodeId, DeviceAction.On)}>On</button>
                <button onClick={() => void onControl(device.nodeId, DeviceAction.Off)}>Off</button>
                {isDimmer && (
                    <input
                        type="range"
                        min={0}
                        max={100}
                        value={level}
                        onChange={e => setLevel(Number(e.target.value))}
                        onPointerUp={() => void onControl(device.nodeId, DeviceAction.Dim, level)}
                        onKeyUp={() => void onControl(device.nodeId, DeviceAction.Dim, level)}
                        aria-label={`Dim ${device.name || device.nodeId}`}
                    />
                )}
                <span className="spacer" />
                <button className="link-btn" onClick={() => setOpen(v => !v)} aria-expanded={open}>
                    {open ? 'Hide' : 'Details'}
                </button>
            </div>

            {open && <DeviceDetail device={device} run={run} refresh={refresh} />}
        </li>
    );
}

// Inline device rename. The name lives in the zwave-js cache, so an empty value
// clears it and the card falls back to "Node <id>".
function RenameRow({ device, run, refresh }: { device: IDeviceInfo; run: RunFn; refresh: () => Promise<void> }) {
    const [name, setName] = useState(device.name ?? '');
    const [saving, setSaving] = useState(false);

    // Keep the field in sync if polling brings a name changed elsewhere
    useEffect(() => {
        setName(device.name ?? '');
    }, [device.name]);

    const dirty = name.trim() !== (device.name ?? '').trim();

    const save = async (): Promise<void> => {
        if (!dirty || saving) {
            return;
        }
        setSaving(true);
        try {
            const trimmed = name.trim();
            if (await run(() => api.renameDevice(device.nodeId, trimmed), trimmed ? `Renamed to “${trimmed}”` : 'Name cleared')) {
                await refresh();
            }
        }
        finally {
            setSaving(false);
        }
    };

    return (
        <form
            className="rename"
            onSubmit={e => { e.preventDefault(); void save(); }}
        >
            <label>
                <span>Name</span>
                <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder={`Node ${device.nodeId}`}
                    aria-label={`Name for node ${device.nodeId}`}
                    maxLength={62}
                />
            </label>
            <button type="submit" disabled={!dirty || saving}>{saving ? 'Saving…' : 'Rename'}</button>
        </form>
    );
}

interface DeviceDetailProps {
    device: IDeviceInfo;
    run: RunFn;
    refresh: () => Promise<void>;
}

function DeviceDetail({ device, run, refresh }: DeviceDetailProps) {
    const [health, setHealth] = useState<IHealthCheckResult | null>(null);
    const [checking, setChecking] = useState(false);

    const testLink = async (): Promise<void> => {
        setChecking(true);
        try {
            let result: IHealthCheckResult | null = null;
            await run(async () => {
                result = await api.checkDeviceHealth(device.nodeId);
                return { message: `Link test: ${result.summary} (${result.rating}/10)` };
            });
            if (result) {
                setHealth(result);
            }
        }
        finally {
            setChecking(false);
        }
    };

    const p = device.power;
    const l = device.link;

    return (
        <div className="detail">
            <RenameRow device={device} run={run} refresh={refresh} />

            <dl>
                {device.manufacturer
                    ? <Row label="Manufacturer" value={device.manufacturer} />
                    : device.manufacturerId && <Row label="Manufacturer" value="Unknown (not in device database)" />}
                {device.product && <Row label="Product" value={device.product} />}
                {device.manufacturerId && (
                    <Row label="Device IDs" value={`${device.manufacturerId} : ${device.productType} : ${device.productId}`} />
                )}
                {device.firmwareVersion && <Row label="Firmware" value={device.firmwareVersion} />}
                {device.securityClass && <Row label="Security" value={device.securityClass} />}
                {device.battery?.level !== undefined && (
                    <Row label="Battery" value={`${device.battery.level}%${device.battery.isLow ? ' (low)' : ''}`} />
                )}
            </dl>

            {p && (p.watts !== undefined || p.kWh !== undefined || p.volts !== undefined || p.amps !== undefined) && (
                <div className="detail-group">
                    <h4>Energy</h4>
                    <dl>
                        {p.watts !== undefined && <Row label="Power" value={`${round(p.watts)} W`} />}
                        {p.kWh !== undefined && <Row label="Energy" value={`${round(p.kWh, 2)} kWh`} />}
                        {p.volts !== undefined && <Row label="Voltage" value={`${round(p.volts)} V`} />}
                        {p.amps !== undefined && <Row label="Current" value={`${round(p.amps, 2)} A`} />}
                    </dl>
                </div>
            )}

            <div className="detail-group">
                <h4>Mesh link</h4>
                <dl>
                    <Row label="Signal" value={l?.rssi !== undefined ? `${signal(l.rssi).label} (${l.rssi} dBm)` : 'No reading yet'} />
                    {l?.hops !== undefined && <Row label="Route" value={l.hops === 0 ? 'Direct' : `${l.hops} hop${l.hops === 1 ? '' : 's'}`} />}
                    {l?.rtt !== undefined && <Row label="Round-trip" value={`${l.rtt} ms`} />}
                    <Row label="Last seen" value={relativeTime(l?.lastSeen)} />
                </dl>

                <div className="controls">
                    <button onClick={() => void testLink()} disabled={checking}>
                        {checking ? 'Testing…' : 'Test link'}
                    </button>
                    {health && (
                        <span className={`health r${Math.round(health.rating / 3.5)}`}>
                            {health.summary} · {health.rating}/10
                            {health.latencyMs !== undefined ? ` · ${health.latencyMs} ms` : ''}
                            {health.rssi !== undefined ? ` · ${health.rssi} dBm` : ''}
                        </span>
                    )}
                </div>
                <p className="muted hint">Signal updates passively as the device is used. “Test link” actively pings it for a fresh reading.</p>
            </div>

            <MaintenanceRow nodeId={device.nodeId} run={run} refresh={refresh} />

            <ConfigSection nodeId={device.nodeId} run={run} />
        </div>
    );
}

// Per-device mesh maintenance: re-interview (fixes "unknown" devices + unlocks config)
// and single-node route rebuild (useful after the controller moves).
export function MaintenanceRow({ nodeId, run, refresh }: { nodeId: number; run: RunFn; refresh: () => Promise<void> }) {
    const [busy, setBusy] = useState<'refresh' | 'routes' | null>(null);

    const reinterview = async (): Promise<void> => {
        setBusy('refresh');
        try {
            await run(() => api.refreshDevice(nodeId));
            await refresh();
        }
        finally {
            setBusy(null);
        }
    };

    const rebuild = async (): Promise<void> => {
        setBusy('routes');
        try {
            await run(() => api.rebuildDeviceRoutes(nodeId));
        }
        finally {
            setBusy(null);
        }
    };

    return (
        <div className="detail-group">
            <h4>Maintenance</h4>
            <div className="controls">
                <button onClick={() => void reinterview()} disabled={busy !== null}>
                    {busy === 'refresh' ? 'Re-interviewing…' : 'Re-interview'}
                </button>
                <button onClick={() => void rebuild()} disabled={busy !== null}>
                    {busy === 'routes' ? 'Rebuilding…' : 'Rebuild routes'}
                </button>
            </div>
            <p className="muted hint">Re-interview re-reads the device (fixes an “unknown” device and its configuration). Rebuild routes recomputes how the controller reaches it — useful after moving the controller.</p>
        </div>
    );
}

// Device configuration parameters (Configuration CC). Lazy-loaded on demand — some
// devices expose many parameters, and reading them isn't worth doing for every card.
function ConfigSection({ nodeId, run }: { nodeId: number; run: RunFn }) {
    const [params, setParams] = useState<IDeviceConfigParam[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);

    const load = async (): Promise<void> => {
        setLoading(true);
        try {
            setParams(await api.getDeviceConfig(nodeId));
        }
        catch {
            setParams([]);
        }
        finally {
            setLoading(false);
        }
    };

    const onUpdated = (updated: IDeviceConfigParam): void => {
        setParams(current => (current ?? []).map(p =>
            (p.parameter === updated.parameter && p.bitmask === updated.bitmask) ? updated : p));
    };

    return (
        <div className="detail-group">
            <h4>Configuration</h4>

            {params === null
                ? (
                    <div className="controls">
                        <button onClick={() => void load()} disabled={loading}>
                            {loading ? 'Loading…' : 'Load configuration'}
                        </button>
                        <span className="muted hint">Device-specific settings (e.g. dimmer ramp rate) stored on the device.</span>
                    </div>
                )
                : params.length === 0
                    ? <p className="muted">No configurable parameters for this device.</p>
                    : (
                        <>
                            {params.filter(p => showAdvanced || !p.advanced).map(p => (
                                <ConfigRow key={`${p.parameter}:${p.bitmask ?? 0}`} nodeId={nodeId} param={p} run={run} onUpdated={onUpdated} />
                            ))}
                            {params.some(p => p.advanced) && (
                                <button className="link-btn" onClick={() => setShowAdvanced(v => !v)}>
                                    {showAdvanced ? 'Hide advanced' : 'Show advanced'}
                                </button>
                            )}
                        </>
                    )}
        </div>
    );
}

interface ConfigRowProps {
    nodeId: number;
    param: IDeviceConfigParam;
    run: RunFn;
    onUpdated: (param: IDeviceConfigParam) => void;
}

export function ConfigRow({ nodeId, param, run, onUpdated }: ConfigRowProps) {
    const initial = param.value ?? param.default ?? param.min ?? 0;
    const [draft, setDraft] = useState<number>(initial);
    const [saving, setSaving] = useState(false);

    // Re-sync when a fresh value arrives (e.g. after a successful set)
    useEffect(() => {
        setDraft(param.value ?? param.default ?? param.min ?? 0);
    }, [param.value, param.default, param.min]);

    const dirty = draft !== param.value;

    const save = async (): Promise<void> => {
        if (param.readOnly || saving) {
            return;
        }
        setSaving(true);
        try {
            let updated: IDeviceConfigParam | null = null;
            await run(async () => {
                updated = await api.setDeviceConfigParam(nodeId, { parameter: param.parameter, bitmask: param.bitmask, value: draft });
                return { message: `${param.label} set to ${draft}` };
            });
            if (updated) {
                onUpdated(updated);
            }
        }
        finally {
            setSaving(false);
        }
    };

    return (
        <div className="config-row">
            <div className="config-label">
                <span>{param.label} <span className="muted">#{param.parameter}{param.bitmask ? `/0x${param.bitmask.toString(16)}` : ''}</span></span>
                {param.description && <span className="muted hint">{param.description}</span>}
            </div>
            <div className="config-edit">
                {param.options && !param.allowManualEntry
                    ? (
                        <select value={draft} disabled={param.readOnly} onChange={e => setDraft(Number(e.target.value))}>
                            {param.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    )
                    : (
                        <input
                            type="number"
                            value={draft}
                            min={param.min}
                            max={param.max}
                            disabled={param.readOnly}
                            onChange={e => setDraft(Number(e.target.value))}
                        />
                    )}
                {param.unit && <span className="muted">{param.unit}</span>}
                {param.readOnly
                    ? <span className="muted">read-only</span>
                    : <button onClick={() => void save()} disabled={!dirty || saving}>{saving ? '…' : 'Set'}</button>}
            </div>
        </div>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <>
            <dt>{label}</dt>
            <dd>{value}</dd>
        </>
    );
}
