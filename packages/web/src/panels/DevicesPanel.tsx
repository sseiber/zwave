import { useEffect, useState } from 'react';
import type { IDeviceInfo } from '@zwave-service/contracts';
import { DeviceAction, DeviceType } from '@zwave-service/contracts';
import type { RunFn } from '../types.ts';
import { api } from '../api.ts';

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
                            <DeviceCard key={device.nodeId} device={device} onControl={control} />
                        ))}
                    </ul>
                )}
        </section>
    );
}

interface DeviceCardProps {
    device: IDeviceInfo;
    onControl: (nodeId: number, action: DeviceAction, level?: number) => Promise<void>;
}

function DeviceCard({ device, onControl }: DeviceCardProps) {
    const isDimmer = device.type === DeviceType.Dimmer;
    const [level, setLevel] = useState(device.level ?? 0);

    // Keep the slider in sync when polling brings new state
    useEffect(() => {
        setLevel(device.level ?? 0);
    }, [device.level]);

    return (
        <li className={`card device ${device.on ? 'on' : 'off'}`}>
            <div className="card-head">
                <span className="name">{device.name || `Node ${device.nodeId}`}</span>
                <span className={`pill ${device.status}`}>{device.status}</span>
            </div>
            <div className="meta">
                <span>#{device.nodeId}</span>
                <span>{device.type}</span>
                {device.product && <span>{device.product}</span>}
                {device.on !== undefined && (
                    <span>{device.on ? 'on' : 'off'}{isDimmer && device.level !== undefined ? ` · ${device.level}%` : ''}</span>
                )}
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
            </div>
        </li>
    );
}
