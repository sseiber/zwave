import {
    FastifyInstance,
    FastifyPluginCallback,
    HookHandlerDoneFunction
} from 'fastify';
import fp from 'fastify-plugin';
import { exMessage } from '../utils/index.js';

const PluginName = 'showRoutesPlugin';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IRoutePluginOptions {
}

const showRoutesPlugin: FastifyPluginCallback<IRoutePluginOptions> = (server: FastifyInstance, _options: IRoutePluginOptions, done: HookHandlerDoneFunction): void => {
    server.log.info({ tags: [PluginName] }, `Registering...`);

    try {
        const routes = new Set();

        server.addHook('onRoute', (routeOptions) => {
            if (routeOptions.routePath !== '' && routeOptions.routePath !== '/*') {
                routes.add(`${String(routeOptions.method)} ${routeOptions.routePath}`);
            }
        });

        server.addHook('onReady', () => {
            const routesArray = Array.from(routes).sort();
            const routesText = routesArray.map(route => `- ${route as string}`).join('\n');

            server.log.info({ tags: [PluginName] }, `Available routes:\n${routesText}`);
        });

        return done();
    }
    catch (ex) {
        server.log.error({ tags: [PluginName] }, `registering failed: ${exMessage(ex)}`);

        return done(ex as Error);
    }
};

export default fp(showRoutesPlugin, {
    fastify: '5.x',
    name: PluginName,
    dependencies: []
});
