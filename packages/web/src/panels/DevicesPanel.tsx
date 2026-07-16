import { useEffect, useState } from 'react';
import type { IDeviceInfo, IHealthCheckResult } from '@zwave-service/contracts';
import { DeviceAction, DeviceType } from '@zwave-service/contracts';
import type { RunFn } from '../types.ts';
import { api } from '../api.ts';
import { relativeTime, signal, round } from '../format.ts';

interface DevicesPanelProps {
    devices: IDeviceInfo[];
    run: RunFn;
    refresh: () => Promise<void>;
}

export function DevicesPanel({ devices, run, refresh }: DevicesPanelProps) {
    const [including, setIncluding] = useState(false);

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
                    : <button className="primary" onClick={() => void startInclusion()}>Add device (insecure)</button>}
            </div>

            {including && <div className="banner status">Inclusion is active — activate pairing on the physical device now.</div>}

            {devices.length === 0
                ? <p className="muted">No devices yet. Use “Add device” and pair a switch or dimmer.</p>
                : (
                    <ul className="cards">
                        {devices.map(device => (
                            <DeviceCard key={device.nodeId} device={device} onControl={control} run={run} />
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
}

function DeviceCard({ device, onControl, run }: DeviceCardProps) {
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
                <span>#{device.nodeId}</span>
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

            {open && <DeviceDetail device={device} run={run} />}
        </li>
    );
}

interface DeviceDetailProps {
    device: IDeviceInfo;
    run: RunFn;
}

function DeviceDetail({ device, run }: DeviceDetailProps) {
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
            <dl>
                {device.manufacturer && <Row label="Manufacturer" value={device.manufacturer} />}
                {device.product && <Row label="Product" value={device.product} />}
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
