import type {
    IServiceResponse,
    IDeviceInfo,
    IDeviceControlRequest,
    IDeviceConfigParam,
    ISetConfigParamRequest,
    IHealthCheckResult,
    IRebuildRoutesStatus,
    IConfigDbStatus,
    IInclusionRequest,
    INetworkHealth,
    IRoom,
    ICreateRoomRequest,
    IUpdateRoomRequest,
    IRoomControlRequest,
    IScene,
    ISceneStatus,
    ICreateSceneRequest,
    IUpdateSceneRequest
} from '@zwave-service/contracts';

const BASE = '/api/v1';

async function request<T = unknown>(path: string, init?: RequestInit): Promise<IServiceResponse & { data?: T }> {
    // Only declare a JSON content-type when a body is actually sent. Fastify rejects
    // `content-type: application/json` with an empty body ("Body cannot be empty..."),
    // which the bodyless POSTs (inclusion/exclusion stop/start) would otherwise hit.
    const headers = init?.body === undefined
        ? undefined
        : { 'content-type': 'application/json' };

    const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers
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

const post = (path: string, body?: unknown): Promise<IServiceResponse> =>
    request(path, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const api = {
    //
    // Devices
    //
    async listDevices(): Promise<IDeviceInfo[]> {
        const res = await request<IDeviceInfo[]>('/devices');
        return res.data ?? [];
    },

    controlDevice(nodeId: number, body: IDeviceControlRequest): Promise<IServiceResponse> {
        return post(`/devices/${nodeId}/control`, body);
    },

    renameDevice(nodeId: number, name: string): Promise<IServiceResponse> {
        return request(`/devices/${nodeId}`, { method: 'PUT', body: JSON.stringify({ name }) });
    },

    async checkDeviceHealth(nodeId: number): Promise<IHealthCheckResult> {
        const res = await request<IHealthCheckResult>(`/devices/${nodeId}/health-check`, { method: 'POST' });
        return res.data as IHealthCheckResult;
    },

    async getDeviceConfig(nodeId: number): Promise<IDeviceConfigParam[]> {
        const res = await request<IDeviceConfigParam[]>(`/devices/${nodeId}/config`);
        return res.data ?? [];
    },

    async setDeviceConfigParam(nodeId: number, body: ISetConfigParamRequest): Promise<IDeviceConfigParam> {
        const res = await request<IDeviceConfigParam>(`/devices/${nodeId}/config`, { method: 'PUT', body: JSON.stringify(body) });
        return res.data as IDeviceConfigParam;
    },

    //
    // Mesh maintenance
    //
    refreshDevice(nodeId: number): Promise<IServiceResponse> {
        return post(`/devices/${nodeId}/refresh`);
    },

    rebuildDeviceRoutes(nodeId: number): Promise<IServiceResponse> {
        return post(`/devices/${nodeId}/rebuild-routes`);
    },

    rebuildAllRoutes(): Promise<IServiceResponse> {
        return post('/rebuild-routes');
    },

    async getNetworkHealth(): Promise<INetworkHealth> {
        const res = await request<INetworkHealth>('/network/health');
        return res.data as INetworkHealth;
    },

    async getRebuildRoutesStatus(): Promise<IRebuildRoutesStatus> {
        const res = await request<IRebuildRoutesStatus>('/rebuild-routes');
        return res.data as IRebuildRoutesStatus;
    },

    async checkConfigDbUpdate(): Promise<IConfigDbStatus> {
        const res = await request<IConfigDbStatus>('/config-db/check', { method: 'POST' });
        return res.data as IConfigDbStatus;
    },

    installConfigDbUpdate(): Promise<IServiceResponse> {
        return post('/config-db/install');
    },

    //
    // Inclusion / Exclusion
    //
    startInclusion(body: IInclusionRequest): Promise<IServiceResponse> {
        return post('/inclusion/start', body);
    },

    stopInclusion(): Promise<IServiceResponse> {
        return post('/inclusion/stop');
    },

    startExclusion(): Promise<IServiceResponse> {
        return post('/exclusion/start');
    },

    stopExclusion(): Promise<IServiceResponse> {
        return post('/exclusion/stop');
    },

    //
    // Rooms
    //
    async listRooms(): Promise<IRoom[]> {
        const res = await request<IRoom[]>('/rooms');
        return res.data ?? [];
    },

    async createRoom(body: ICreateRoomRequest): Promise<IRoom> {
        const res = await request<IRoom>('/rooms', { method: 'POST', body: JSON.stringify(body) });
        return res.data as IRoom;
    },

    async updateRoom(roomId: string, body: IUpdateRoomRequest): Promise<IRoom> {
        const res = await request<IRoom>(`/rooms/${roomId}`, { method: 'PUT', body: JSON.stringify(body) });
        return res.data as IRoom;
    },

    deleteRoom(roomId: string): Promise<IServiceResponse> {
        return request(`/rooms/${roomId}`, { method: 'DELETE' });
    },

    controlRoom(roomId: string, body: IRoomControlRequest): Promise<IServiceResponse> {
        return post(`/rooms/${roomId}/control`, body);
    },

    //
    // Scenes
    //
    async listScenes(): Promise<IScene[]> {
        const res = await request<IScene[]>('/scenes');
        return res.data ?? [];
    },

    async listSceneStatus(): Promise<ISceneStatus[]> {
        const res = await request<ISceneStatus[]>('/scenes/status');
        return res.data ?? [];
    },

    async createScene(body: ICreateSceneRequest): Promise<IScene> {
        const res = await request<IScene>('/scenes', { method: 'POST', body: JSON.stringify(body) });
        return res.data as IScene;
    },

    async updateScene(sceneId: string, body: IUpdateSceneRequest): Promise<IScene> {
        const res = await request<IScene>(`/scenes/${sceneId}`, { method: 'PUT', body: JSON.stringify(body) });
        return res.data as IScene;
    },

    deleteScene(sceneId: string): Promise<IServiceResponse> {
        return request(`/scenes/${sceneId}`, { method: 'DELETE' });
    },

    activateScene(sceneId: string): Promise<IServiceResponse> {
        return post(`/scenes/${sceneId}/activate`);
    }
};
