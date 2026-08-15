import {
    FastifyInstance,
    FastifyPluginAsync
} from 'fastify';
import fp from 'fastify-plugin';
import {
    IServiceReply,
    IServiceResponse,
    IServiceResponseSchema,
    IServiceErrorMessageSchema
} from '../models/index.js';
import { exMessage } from '../utils/index.js';
import { ServiceName as NetworkHealthServiceName } from '../services/networkHealth.js';

const RouteName = 'networkRouter';

const responseSchema = {
    '2xx': IServiceResponseSchema,
    '4xx': IServiceErrorMessageSchema,
    '5xx': IServiceErrorMessageSchema
};

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface INetworkRouterOptions { }

const networkRouterPlugin: FastifyPluginAsync<INetworkRouterOptions> = async (server: FastifyInstance, options: INetworkRouterOptions): Promise<void> => {
    server.log.info({ tags: [RouteName] }, `registering...`);

    await server.register(async (serverRoute, _routeOptions) => {
        try {
            // Composite health verdict. Read from the health service's latest sample, so
            // this is a cheap read no matter how often the UI polls it.
            serverRoute.route<{ Reply: IServiceReply }>({
                method: 'GET',
                url: '/network/health',
                schema: {
                    response: responseSchema
                },
                handler: async (request, response) => {
                    serverRoute.log.debug({ tags: [RouteName] }, `${request.method} ${request.url}`);

                    const health = serverRoute.networkHealth.getHealth();

                    const result: IServiceResponse = {
                        succeeded: true,
                        statusCode: 200,
                        message: health.headline,
                        data: health
                    };

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

export default fp(networkRouterPlugin, {
    fastify: '5.x',
    name: RouteName,
    dependencies: [
        NetworkHealthServiceName
    ]
});
