import {
    FastifyInstance,
    FastifyPluginAsync
} from 'fastify';
import fp from 'fastify-plugin';
import {
    DeviceAction,
    IInclusionRequest,
    IServiceResponse,
    ISceneDevice
} from '../models/index.js';
import { exMessage } from '../utils/index.js';
import { ZWaveController } from './zwaveController.js';
import { PluginName as ConfigPluginName } from '../plugins/config.js';

export const ServiceName = 'zwaveService';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IZWaveServicePluginOptions { }

const zwaveServicePlugin: FastifyPluginAsync<IZWaveServicePluginOptions> = async (server: FastifyInstance, _options: IZWaveServicePluginOptions): Promise<void> => {
    server.log.info({ tags: [ServiceName] }, `Registering...`);

    try {
        const zwaveService = await ZWaveService.createZWaveService(server);

        server.decorate(ServiceName, zwaveService);

        server.addHook('onClose', async () => {
            await zwaveService.shutdown();
        });
    }
    catch (ex) {
        server.log.error({ tags: [ServiceName] }, `registering failed: ${exMessage(ex)}`);

        throw ex;
    }
};

class ZWaveService {
    public static async createZWaveService(server: FastifyInstance): Promise<ZWaveService> {
        const controller = await ZWaveController.createController(server);

        return new ZWaveService(server, controller);
    }

    private server: FastifyInstance;
    private controller: ZWaveController;

    constructor(server: FastifyInstance, controller: ZWaveController) {
        this.server = server;
        this.controller = controller;
    }

    public async shutdown(): Promise<void> {
        await this.controller.destroy();
    }

    //
    // Inclusion / Exclusion
    //
    public async startInclusion(request: IInclusionRequest): Promise<IServiceResponse> {
        return this.run(`start inclusion`, async () => {
            const started = await this.controller.beginInclusion(request.strategy, request.pin, request.secure);

            return started
                ? `Inclusion started - activate inclusion on the device now`
                : `Inclusion could not be started (already in progress?)`;
        });
    }

    public async stopInclusion(): Promise<IServiceResponse> {
        return this.run(`stop inclusion`, async () => {
            await this.controller.stopInclusion();

            return `Inclusion stopped`;
        });
    }

    public async startExclusion(): Promise<IServiceResponse> {
        return this.run(`start exclusion`, async () => {
            const started = await this.controller.beginExclusion();

            return started
                ? `Exclusion started - activate exclusion on the device now`
                : `Exclusion could not be started (already in progress?)`;
        });
    }

    public async stopExclusion(): Promise<IServiceResponse> {
        return this.run(`stop exclusion`, async () => {
            await this.controller.stopExclusion();

            return `Exclusion stopped`;
        });
    }

    //
    // Devices
    //
    public listDevices(): IServiceResponse {
        try {
            const devices = this.controller.listDevices();

            return {
                succeeded: true,
                statusCode: 200,
                message: `Found ${devices.length} device(s)`,
                data: devices
            };
        }
        catch (ex) {
            return this.errorResponse(`list devices`, ex);
        }
    }

    public getDevice(nodeId: number): IServiceResponse {
        try {
            const device = this.controller.getDevice(nodeId);

            return {
                succeeded: true,
                statusCode: 200,
                message: `Device ${nodeId} found`,
                data: device
            };
        }
        catch (ex) {
            return this.errorResponse(`get device ${nodeId}`, ex);
        }
    }

    public async controlDevice(nodeId: number, action: DeviceAction, level?: number): Promise<IServiceResponse> {
        return this.run(`control device ${nodeId} (${action})`, async () => {
            await this.applyAction(nodeId, action, level);

            return `Device ${nodeId} processed action '${action}'`;
        });
    }

    //
    // Room control - apply an action to a set of devices
    //
    public async controlDevices(deviceIds: number[], action: DeviceAction, level?: number): Promise<IServiceResponse> {
        const results = await Promise.all(deviceIds.map(async (nodeId) => {
            try {
                await this.applyAction(nodeId, action, level);

                return { nodeId, succeeded: true, message: `action '${action}' applied` };
            }
            catch (ex) {
                return { nodeId, succeeded: false, message: exMessage(ex) };
            }
        }));

        const failures = results.filter(result => !result.succeeded);

        return {
            succeeded: failures.length === 0,
            statusCode: failures.length === 0 ? 200 : 207,
            message: failures.length === 0
                ? `Action '${action}' applied to ${results.length} device(s)`
                : `Action '${action}' applied with ${failures.length} failure(s)`,
            data: results
        };
    }

    //
    // Scene activation - apply each participating device's configured action
    //
    public async applyScene(devices: ISceneDevice[]): Promise<IServiceResponse> {
        const results = await Promise.all(devices.map(async ({ deviceId, action, level }) => {
            try {
                await this.applyAction(deviceId, action, level);

                return { nodeId: deviceId, succeeded: true, message: `action '${action}' applied` };
            }
            catch (ex) {
                return { nodeId: deviceId, succeeded: false, message: exMessage(ex) };
            }
        }));

        const failures = results.filter(result => !result.succeeded);

        return {
            succeeded: failures.length === 0,
            statusCode: failures.length === 0 ? 200 : 207,
            message: failures.length === 0
                ? `Scene activated across ${results.length} device(s)`
                : `Scene activated with ${failures.length} failure(s)`,
            data: results
        };
    }

    //
    // Internal helpers
    //
    private async applyAction(nodeId: number, action: DeviceAction, level?: number): Promise<void> {
        switch (action) {
            case DeviceAction.On:
                await this.controller.setDevicePower(nodeId, true);
                break;

            case DeviceAction.Off:
                await this.controller.setDevicePower(nodeId, false);
                break;

            case DeviceAction.Dim:
                if (level === undefined) {
                    throw new Error(`A 'level' (0-100) is required for the 'dim' action`);
                }

                await this.controller.setDeviceLevel(nodeId, level);
                break;

            default:
                throw new Error(`Unrecognized action '${String(action)}'`);
        }
    }

    private async run(description: string, action: () => Promise<string>): Promise<IServiceResponse> {
        try {
            const message = await action();

            this.server.log.info({ tags: [ServiceName] }, message);

            return {
                succeeded: true,
                statusCode: 200,
                message
            };
        }
        catch (ex) {
            return this.errorResponse(description, ex);
        }
    }

    private errorResponse(description: string, ex: unknown): IServiceResponse {
        const message = `Failed to ${description}: ${exMessage(ex)}`;

        this.server.log.error({ tags: [ServiceName] }, message);

        return {
            succeeded: false,
            statusCode: 500,
            message
        };
    }
}

declare module 'fastify' {
    interface FastifyInstance {
        [ServiceName]: ZWaveService;
    }
}

export default fp(zwaveServicePlugin, {
    fastify: '5.x',
    name: ServiceName,
    dependencies: [
        ConfigPluginName
    ]
});
