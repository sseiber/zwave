import fastify, {
    FastifyInstance,
    FastifyServerOptions
} from 'fastify';
import autoload from '@fastify/autoload';
import sensible from '@fastify/sensible';
import { resolve as pathResolve } from 'node:path';
import configPlugin from './plugins/config.js';
import showRoutesPlugin from './plugins/showRoutes.js';
import webClientPlugin from './plugins/webClient.js';
import { registerJsonBodyParser } from './plugins/jsonBodyParser.js';
import { getDirname, exMessage } from './utils/index.js';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface composeOptions extends FastifyServerOptions { }

const ModuleName = 'ComposeServer';

const composeServer = async (options: composeOptions = {}): Promise<FastifyInstance> => {
    try {
        const server = fastify(options);

        registerJsonBodyParser(server);

        server.log.info({ tags: [ModuleName] }, `Registering plugins`);

        await server.register(configPlugin);
        await server.register(sensible);

        await server.register(showRoutesPlugin);

        server.log.info({ tags: [ModuleName] }, `Registering services`);

        await server.register(autoload, {
            dir: pathResolve(getDirname(import.meta.url), 'services')
        });

        server.log.info({ tags: [ModuleName] }, `Registering routes`);

        await server.register(autoload, {
            dir: pathResolve(getDirname(import.meta.url), 'routes'),
            options: {
                prefix: '/api/v1'
            }
        });

        server.log.info({ tags: [ModuleName] }, `Registering web client`);

        await server.register(webClientPlugin);

        await server.ready();

        return server;
    }
    catch (ex) {
        throw new Error(`Failed to compose server instance: ${exMessage(ex)}`);
    }
};

export default composeServer;
