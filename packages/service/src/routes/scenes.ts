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
    ISceneParams,
    ISceneParamsSchema,
    ICreateSceneRequest,
    ICreateSceneRequestSchema,
    IUpdateSceneRequest,
    IUpdateSceneRequestSchema
} from '../models/index.js';
import { exMessage } from '../utils/index.js';
import { ServiceName as StoreServiceName } from '../services/store.js';
import { ServiceName as ZWaveServiceName } from '../services/zwave.js';

const RouteName = 'scenesRouter';

const responseSchema = {
    '2xx': IServiceResponseSchema,
    '4xx': IServiceErrorMessageSchema,
    '5xx': IServiceErrorMessageSchema
};

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IScenesRouterOptions { }

const scenesRouterPlugin: FastifyPluginAsync<IScenesRouterOptions> = async (server: FastifyInstance, options: IScenesRouterOptions): Promise<void> => {
    server.log.info({ tags: [RouteName] }, `registering...`);

    await server.register(async (serverRoute, _routeOptions) => {
        try {
            serverRoute.route<{ Reply: IServiceReply }>({
                method: 'GET',
                url: '/scenes',
                schema: {
                    response: responseSchema
                },
                handler: async (request, response) => {
                    serverRoute.log.info({ tags: [RouteName] }, `${request.method} ${request.url}`);

                    const scenes = serverRoute.store.listScenes();

                    const result: IServiceResponse = {
                        succeeded: true,
                        statusCode: 200,
                        message: `Found ${scenes.length} scene(s)`,
                        data: scenes
                    };

                    return response.status(result.statusCode as 200).send(result);
                }
            });

            serverRoute.route<{ Body: ICreateSceneRequest; Reply: IServiceReply }>({
                method: 'POST',
                url: '/scenes',
                schema: {
                    body: ICreateSceneRequestSchema,
                    response: responseSchema
                },
                handler: async (request, response) => {
                    serverRoute.log.info({ tags: [RouteName] }, `${request.method} ${request.url}`);

                    const scene = await serverRoute.store.createScene(request.body);

                    const result: IServiceResponse = {
                        succeeded: true,
                        statusCode: 201,
                        message: `Scene '${scene.name}' created`,
                        data: scene
                    };

                    return response.status(result.statusCode as 200).send(result);
                }
            });

            serverRoute.route<{ Params: ISceneParams; Reply: IServiceReply }>({
                method: 'GET',
                url: '/scenes/:sceneId',
                schema: {
                    params: ISceneParamsSchema,
                    response: responseSchema
                },
                handler: async (request, response) => {
                    serverRoute.log.info({ tags: [RouteName] }, `${request.method} ${request.url}`);

                    const scene = serverRoute.store.getScene(request.params.sceneId);
                    if (!scene) {
                        throw serverRoute.httpErrors.notFound(`No scene found with id ${request.params.sceneId}`);
                    }

                    const result: IServiceResponse = {
                        succeeded: true,
                        statusCode: 200,
                        message: `Scene '${scene.name}' found`,
                        data: scene
                    };

                    return response.status(result.statusCode as 200).send(result);
                }
            });

            serverRoute.route<{ Params: ISceneParams; Body: IUpdateSceneRequest; Reply: IServiceReply }>({
                method: 'PUT',
                url: '/scenes/:sceneId',
                schema: {
                    params: ISceneParamsSchema,
                    body: IUpdateSceneRequestSchema,
                    response: responseSchema
                },
                handler: async (request, response) => {
                    serverRoute.log.info({ tags: [RouteName] }, `${request.method} ${request.url}`);

                    const scene = await serverRoute.store.updateScene(request.params.sceneId, request.body);
                    if (!scene) {
                        throw serverRoute.httpErrors.notFound(`No scene found with id ${request.params.sceneId}`);
                    }

                    const result: IServiceResponse = {
                        succeeded: true,
                        statusCode: 200,
                        message: `Scene '${scene.name}' updated`,
                        data: scene
                    };

                    return response.status(result.statusCode as 200).send(result);
                }
            });

            serverRoute.route<{ Params: ISceneParams; Reply: IServiceReply }>({
                method: 'DELETE',
                url: '/scenes/:sceneId',
                schema: {
                    params: ISceneParamsSchema,
                    response: responseSchema
                },
                handler: async (request, response) => {
                    serverRoute.log.info({ tags: [RouteName] }, `${request.method} ${request.url}`);

                    const deleted = await serverRoute.store.deleteScene(request.params.sceneId);
                    if (!deleted) {
                        throw serverRoute.httpErrors.notFound(`No scene found with id ${request.params.sceneId}`);
                    }

                    const result: IServiceResponse = {
                        succeeded: true,
                        statusCode: 200,
                        message: `Scene ${request.params.sceneId} deleted`
                    };

                    return response.status(result.statusCode as 200).send(result);
                }
            });

            serverRoute.route<{ Params: ISceneParams; Reply: IServiceReply }>({
                method: 'POST',
                url: '/scenes/:sceneId/activate',
                schema: {
                    params: ISceneParamsSchema,
                    response: responseSchema
                },
                handler: async (request, response) => {
                    serverRoute.log.info({ tags: [RouteName] }, `${request.method} ${request.url}`);

                    const scene = serverRoute.store.getScene(request.params.sceneId);
                    if (!scene) {
                        throw serverRoute.httpErrors.notFound(`No scene found with id ${request.params.sceneId}`);
                    }

                    const result = await serverRoute.zwaveService.applyScene(scene.devices);

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

export default fp(scenesRouterPlugin, {
    fastify: '5.x',
    name: RouteName,
    dependencies: [
        StoreServiceName,
        ZWaveServiceName
    ]
});
