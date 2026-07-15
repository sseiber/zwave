import type {
    IServiceResponse,
    IDeviceInfo,
    IDeviceControlRequest,
    IInclusionRequest
} from '@zwave-service/contracts';

const BASE = '/api/v1';

async function request<T = unknown>(path: string, init?: RequestInit): Promise<IServiceResponse & { data?: T }> {
    const res = await fetch(`${BASE}${path}`, {
        headers: { 'content-type': 'application/json' },
        ...init
    });

    let body: IServiceResponse;
    try {
        body = await res.json() as IServiceResponse;
    }
    catch {
        throw new Error(`${res.status} ${res.statusText}`);
    }

    if (!res.ok || body.succeeded === false) {
        throw new Error(body?.message ?? `${res.status} ${res.statusText}`);
    }

    return body as IServiceResponse & { data?: T };
}

export const api = {
    async listDevices(): Promise<IDeviceInfo[]> {
        const res = await request<IDeviceInfo[]>('/devices');
        return res.data ?? [];
    },

    controlDevice(nodeId: number, body: IDeviceControlRequest): Promise<IServiceResponse> {
        return request(`/devices/${nodeId}/control`, { method: 'POST', body: JSON.stringify(body) });
    },

    startInclusion(body: IInclusionRequest): Promise<IServiceResponse> {
        return request('/inclusion/start', { method: 'POST', body: JSON.stringify(body) });
    },

    stopInclusion(): Promise<IServiceResponse> {
        return request('/inclusion/stop', { method: 'POST' });
    },

    startExclusion(): Promise<IServiceResponse> {
        return request('/exclusion/start', { method: 'POST' });
    },

    stopExclusion(): Promise<IServiceResponse> {
        return request('/exclusion/stop', { method: 'POST' });
    }
};
