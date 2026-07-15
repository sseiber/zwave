import {
    FastifyInstance,
    FastifyPluginCallback,
    HookHandlerDoneFunction
} from 'fastify';
import fp from 'fastify-plugin';
import { exMessage } from '../utils/index.js';

const RouteName = 'appHealthRouter';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IAppHealthRouterPluginOptions { }

const appHealthRouterPlugin: FastifyPluginCallback<IAppHealthRouterPluginOptions> = (serverRoute: FastifyInstance, _options: IAppHealthRouterPluginOptions, done: HookHandlerDoneFunction): void => {
    serverRoute.log.info({ tags: [RouteName] }, `registering...`);

    try {
        serverRoute.get('/health', async (_request, response) => {
            serverRoute.log.info({ tags: [RouteName] }, `getHealthCheck`);

            try {
                return response.status(200).send(`Healthy`);
            }
            catch (ex) {
                return response.status(500).send(`Unhealthy: ${exMessage(ex)}`);
            }
        });
    }
    catch (ex) {
        serverRoute.log.error({ tags: [RouteName] }, `registering routes failed: ${exMessage(ex)}`);

        return done(ex as Error);
    }

    return done();
};

export default fp(appHealthRouterPlugin, {
    fastify: '5.x',
    name: RouteName,
    dependencies: []
});
