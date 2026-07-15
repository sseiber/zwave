import {
    FastifyInstance,
    FastifyPluginAsync
} from 'fastify';
import fp from 'fastify-plugin';
import {
    IServiceReply,
    IServiceResponse,
    IServiceResponseSchema,
    IServiceErrorMessageSchema,
    IRoomParams,
    IRoomParamsSchema,
    ICreateRoomRequest,
    ICreateRoomRequestSchema,
    IUpdateRoomRequest,
    IUpdateRoomRequestSchema,
    IRoomControlRequest,
    IRoomControlRequestSchema
} from '../models/index.js';
import { exMessage } from '../utils/index.js';
import { ServiceName as StoreServiceName } from '../services/store.js';
import { ServiceName as ZWaveServiceName } from '../services/zwave.js';

const RouteName = 'roomsRouter';

const responseSchema = {
    '2xx': IServiceResponseSchema,
    '4xx': IServiceErrorMessageSchema,
    '5xx': IServiceErrorMessageSchema
};

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IRoomsRouterOptions { }

const roomsRouterPlugin: FastifyPluginAsync<IRoomsRouterOptions> = async (server: FastifyInstance, options: IRoomsRouterOptions): Promise<void> => {
    server.log.info({ tags: [RouteName] }, `registering...`);

    await server.register(async (serverRoute, _routeOptions) => {
        try {
            serverRoute.route<{ Reply: IServiceReply }>({
                method: 'GET',
                url: '/rooms',
                schema: {
                    response: responseSchema
                },
                handler: async (request, response) => {
                    serverRoute.log.info({ tags: [RouteName] }, `${request.method} ${request.url}`);

                    const rooms = serverRoute.store.listRooms();

                    const result: IServiceResponse = {
                        succeeded: true,
                        statusCode: 200,
                        message: `Found ${rooms.length} room(s)`,
                        data: rooms
                    };

                    return response.status(result.statusCode as 200).send(result);
                }
            });

            serverRoute.route<{ Body: ICreateRoomRequest; Reply: IServiceReply }>({
                method: 'POST',
                url: '/rooms',
                schema: {
                    body: ICreateRoomRequestSchema,
                    response: responseSchema
                },
                handler: async (request, response) => {
                    serverRoute.log.info({ tags: [RouteName] }, `${request.method} ${request.url}`);

                    const room = await serverRoute.store.createRoom(request.body);

                    const result: IServiceResponse = {
                        succeeded: true,
                        statusCode: 201,
                        message: `Room '${room.name}' created`,
                        data: room
                    };

                    return response.status(result.statusCode as 200).send(result);
                }
            });

            serverRoute.route<{ Params: IRoomParams; Reply: IServiceReply }>({
                method: 'GET',
                url: '/rooms/:roomId',
                schema: {
                    params: IRoomParamsSchema,
                    response: responseSchema
                },
                handler: async (request, response) => {
                    serverRoute.log.info({ tags: [RouteName] }, `${request.method} ${request.url}`);

                    const room = serverRoute.store.getRoom(request.params.roomId);
                    if (!room) {
                        throw serverRoute.httpErrors.notFound(`No room found with id ${request.params.roomId}`);
                    }

                    const result: IServiceResponse = {
                        succeeded: true,
                        statusCode: 200,
                        message: `Room '${room.name}' found`,
                        data: room
                    };

                    return response.status(result.statusCode as 200).send(result);
                }
            });

            serverRoute.route<{ Params: IRoomParams; Body: IUpdateRoomRequest; Reply: IServiceReply }>({
                method: 'PUT',
                url: '/rooms/:roomId',
                schema: {
                    params: IRoomParamsSchema,
                    body: IUpdateRoomRequestSchema,
                    response: responseSchema
                },
                handler: async (request, response) => {
                    serverRoute.log.info({ tags: [RouteName] }, `${request.method} ${request.url}`);

                    const room = await serverRoute.store.updateRoom(request.params.roomId, request.body);
                    if (!room) {
                        throw serverRoute.httpErrors.notFound(`No room found with id ${request.params.roomId}`);
                    }

                    const result: IServiceResponse = {
                        succeeded: true,
                        statusCode: 200,
                        message: `Room '${room.name}' updated`,
                        data: room
                    };

                    return response.status(result.statusCode as 200).send(result);
                }
            });

            serverRoute.route<{ Params: IRoomParams; Reply: IServiceReply }>({
                method: 'DELETE',
                url: '/rooms/:roomId',
                schema: {
                    params: IRoomParamsSchema,
                    response: responseSchema
                },
                handler: async (request, response) => {
                    serverRoute.log.info({ tags: [RouteName] }, `${request.method} ${request.url}`);

                    const deleted = await serverRoute.store.deleteRoom(request.params.roomId);
                    if (!deleted) {
                        throw serverRoute.httpErrors.notFound(`No room found with id ${request.params.roomId}`);
                    }

                    const result: IServiceResponse = {
                        succeeded: true,
                        statusCode: 200,
                        message: `Room ${request.params.roomId} deleted`
                    };

                    return response.status(result.statusCode as 200).send(result);
                }
            });

            serverRoute.route<{ Params: IRoomParams; Body: IRoomControlRequest; Reply: IServiceReply }>({
                method: 'POST',
                url: '/rooms/:roomId/control',
                schema: {
                    params: IRoomParamsSchema,
                    body: IRoomControlRequestSchema,
                    response: responseSchema
                },
                handler: async (request, response) => {
                    serverRoute.log.info({ tags: [RouteName] }, `${request.method} ${request.url}`);

                    const room = serverRoute.store.getRoom(request.params.roomId);
                    if (!room) {
                        throw serverRoute.httpErrors.notFound(`No room found with id ${request.params.roomId}`);
                    }

                    const result = await serverRoute.zwaveService.controlDevices(room.deviceIds, request.body.action, request.body.level);

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

export default fp(roomsRouterPlugin, {
    fastify: '5.x',
    name: RouteName,
    dependencies: [
        StoreServiceName,
        ZWaveServiceName
    ]
});
