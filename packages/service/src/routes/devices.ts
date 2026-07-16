import {
    FastifyInstance,
    FastifyPluginAsync
} from 'fastify';
import fp from 'fastify-plugin';
import {
    IServiceReply,
    IServiceResponseSchema,
    IServiceErrorMessageSchema,
    IInclusionRequest,
    IInclusionRequestSchema,
    IDeviceParams,
    IDeviceParamsSchema,
    IDeviceControlRequest,
    IDeviceControlRequestSchema
} from '../models/index.js';
import { exMessage } from '../utils/index.js';
import { ServiceName as ZWaveServiceName } from '../services/zwave.js';

const RouteName = 'devicesRouter';

const responseSchema = {
    '2xx': IServiceResponseSchema,
    '4xx': IServiceErrorMessageSchema,
    '5xx': IServiceErrorMessageSchema
};

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IDevicesRouterOptions { }

const devicesRouterPlugin: FastifyPluginAsync<IDevicesRouterOptions> = async (server: FastifyInstance, options: IDevicesRouterOptions): Promise<void> => {
    server.log.info({ tags: [RouteName] }, `registering...`);

    await server.register(async (serverRoute, _routeOptions) => {
        try {
            //
            // Inclusion
            //
            serverRoute.route<{ Body: IInclusionRequest; Reply: IServiceReply }>({
                method: 'POST',
                url: '/inclusion/start',
                schema: {
                    body: IInclusionRequestSchema,
                    response: responseSchema
                },
                handler: async (request, response) => {
                    serverRoute.log.info({ tags: [RouteName] }, `${request.method} ${request.url}`);

                    const result = await serverRoute.zwaveService.startInclusion(request.body ?? {});

                    return response.status(result.statusCode as 200).send(result);
                }
            });

            serverRoute.route<{ Reply: IServiceReply }>({
                method: 'POST',
                url: '/inclusion/stop',
                schema: {
                    response: responseSchema
                },
                handler: async (request, response) => {
                    serverRoute.log.info({ tags: [RouteName] }, `${request.method} ${request.url}`);

                    const result = await serverRoute.zwaveService.stopInclusion();

                    return response.status(result.statusCode as 200).send(result);
                }
            });

            //
            // Exclusion
            //
            serverRoute.route<{ Reply: IServiceReply }>({
                method: 'POST',
                url: '/exclusion/start',
                schema: {
                    response: responseSchema
                },
                handler: async (request, response) => {
                    serverRoute.log.info({ tags: [RouteName] }, `${request.method} ${request.url}`);

                    const result = await serverRoute.zwaveService.startExclusion();

                    return response.status(result.statusCode as 200).send(result);
                }
            });

            serverRoute.route<{ Reply: IServiceReply }>({
                method: 'POST',
                url: '/exclusion/stop',
                schema: {
                    response: responseSchema
                },
                handler: async (request, response) => {
                    serverRoute.log.info({ tags: [RouteName] }, `${request.method} ${request.url}`);

                    const result = await serverRoute.zwaveService.stopExclusion();

                    return response.status(result.statusCode as 200).send(result);
                }
            });

            //
            // Devices
            //
            serverRoute.route<{ Reply: IServiceReply }>({
                method: 'GET',
                url: '/devices',
                schema: {
                    response: responseSchema
                },
                handler: async (request, response) => {
                    serverRoute.log.info({ tags: [RouteName] }, `${request.method} ${request.url}`);

                    const result = serverRoute.zwaveService.listDevices();

                    return response.status(result.statusCode as 200).send(result);
                }
            });

            serverRoute.route<{ Params: IDeviceParams; Reply: IServiceReply }>({
                method: 'GET',
                url: '/devices/:nodeId',
                schema: {
                    params: IDeviceParamsSchema,
                    response: responseSchema
                },
                handler: async (request, response) => {
                    serverRoute.log.info({ tags: [RouteName] }, `${request.method} ${request.url}`);

                    const result = serverRoute.zwaveService.getDevice(request.params.nodeId);

                    return response.status(result.statusCode as 200).send(result);
                }
            });

            serverRoute.route<{ Params: IDeviceParams; Body: IDeviceControlRequest; Reply: IServiceReply }>({
                method: 'POST',
                url: '/devices/:nodeId/control',
                schema: {
                    params: IDeviceParamsSchema,
                    body: IDeviceControlRequestSchema,
                    response: responseSchema
                },
                handler: async (request, response) => {
                    serverRoute.log.info({ tags: [RouteName] }, `${request.method} ${request.url}`);

                    const result = await serverRoute.zwaveService.controlDevice(request.params.nodeId, request.body.action, request.body.level);

                    return response.status(result.statusCode as 200).send(result);
                }
            });

            // On-demand mesh health check — actively pings the device, so it is a POST
            serverRoute.route<{ Params: IDeviceParams; Reply: IServiceReply }>({
                method: 'POST',
                url: '/devices/:nodeId/health-check',
                schema: {
                    params: IDeviceParamsSchema,
                    response: responseSchema
                },
                handler: async (request, response) => {
                    serverRoute.log.info({ tags: [RouteName] }, `${request.method} ${request.url}`);

                    const result = await serverRoute.zwaveService.checkDeviceHealth(request.params.nodeId);

                    return response.status(result.statusCode as 200).send(result);
                }
            });
        }
        catch (ex) {
            serverRoute.log.error({ tags: [RouteName] }, `registering routes failed: ${exMessage(ex)}`);

            throw new Error(`Failed to register ${RouteName} ${exMessage(ex)}`);
        }

        return Promise.resolve();
    }, options);
};

export default fp(devicesRouterPlugin, {
    fastify: '5.x',
    name: RouteName,
    dependencies: [
        ZWaveServiceName
    ]
});
