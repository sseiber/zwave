import { useCallback, useEffect, useState } from 'react';
import type { IDeviceInfo } from '@zwave-service/contracts';
import { DeviceAction, DeviceType } from '@zwave-service/contracts';
import { api } from './api.ts';

export function App() {
    const [devices, setDevices] = useState<IDeviceInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<string | null>(null);
    const [including, setIncluding] = useState(false);

    const refresh = useCallback(async (): Promise<void> => {
        try {
            setDevices(await api.listDevices());
            setError(null);
        }
        catch (ex) {
            setError(ex instanceof Error ? ex.message : String(ex));
        }
        finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
        const id = setInterval(() => void refresh(), 5000);
        return () => clearInterval(id);
    }, [refresh]);

    const run = useCallback(async (action: () => Promise<{ message: string }>): Promise<void> => {
        try {
            const res = await action();
            setStatus(res.message);
            setError(null);
            await refresh();
        }
        catch (ex) {
            setError(ex instanceof Error ? ex.message : String(ex));
        }
    }, [refresh]);

    const control = (nodeId: number, action: DeviceAction, level?: number): Promise<void> =>
        run(() => api.controlDevice(nodeId, { action, level }));

    const startInclusion = async (): Promise<void> => {
        setIncluding(true);
        await run(() => api.startInclusion({ secure: false }));
    };
    const stopInclusion = async (): Promise<void> => {
        setIncluding(false);
        await run(() => api.stopInclusion());
    };

    return (
        <div className="app">
            <header>
                <h1>Z-Wave Control</h1>
                <div className="actions">
                    <button onClick={() => void refresh()}>Refresh</button>
                    {including
                        ? <button className="warn" onClick={() => void stopInclusion()}>Stop inclusion</button>
                        : <button className="primary" onClick={() => void startInclusion()}>Add device (insecure)</button>}
                </div>
            </header>

            {error && <div className="banner error">{error}</div>}
            {status && !error && <div className="banner status">{status}</div>}
            {including && <div className="banner status">Inclusion is active — activate pairing on the physical device now.</div>}

            {loading
                ? <p className="muted">Loading devices…</p>
                : devices.length === 0
                    ? <p className="muted">No devices yet. Use “Add device” and pair a switch or dimmer.</p>
                    : (
                        <ul className="devices">
                            {devices.map(device => (
                                <DeviceCard key={device.nodeId} device={device} onControl={control} />
                            ))}
                        </ul>
                    )}
        </div>
    );
}

interface DeviceCardProps {
    device: IDeviceInfo;
    onControl: (nodeId: number, action: DeviceAction, level?: number) => Promise<void>;
}

function DeviceCard({ device, onControl }: DeviceCardProps) {
    const isDimmer = device.type === DeviceType.Dimmer;
    const [level, setLevel] = useState(device.level ?? 0);

    // Keep the slider in sync when a refresh brings new state
    useEffect(() => {
        setLevel(device.level ?? 0);
    }, [device.level]);

    return (
        <li className={`device ${device.on ? 'on' : 'off'}`}>
            <div className="device-head">
                <span className="name">{device.name || `Node ${device.nodeId}`}</span>
                <span className={`pill ${device.status}`}>{device.status}</span>
            </div>
            <div className="meta">
                <span>#{device.nodeId}</span>
                <span>{device.type}</span>
                {device.product && <span>{device.product}</span>}
                {device.on !== undefined && <span>{device.on ? 'on' : 'off'}{isDimmer && device.level !== undefined ? ` · ${device.level}%` : ''}</span>}
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
