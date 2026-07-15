import {
    FastifyInstance,
    FastifyPluginAsync
} from 'fastify';
import fp from 'fastify-plugin';
import fastifyStatic from '@fastify/static';
import { resolve as pathResolve } from 'node:path';
import fse from 'fs-extra';
import { exMessage } from '../utils/index.js';
import { PluginName as ConfigPluginName } from './config.js';

const PluginName = 'webClient';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IWebClientPluginOptions { }

const webClientPlugin: FastifyPluginAsync<IWebClientPluginOptions> = async (server: FastifyInstance, _options: IWebClientPluginOptions): Promise<void> => {
    server.log.info({ tags: [PluginName] }, `Registering...`);

    try {
        const root = pathResolve(server.config.env.webClientRoot);

        // Serve the built SPA only if the client bundle is present. In local dev the
        // web client runs from the Vite dev server, so this is skipped and the
        // service stays API-only.
        if (!(await fse.pathExists(pathResolve(root, 'index.html')))) {
            server.log.info({ tags: [PluginName] }, `No web client found at ${root}; serving API only`);

            return;
        }

        server.log.info({ tags: [PluginName] }, `Serving web client from ${root}`);

        await server.register(fastifyStatic, {
            root,
            prefix: '/'
        });

        // SPA fallback: non-API GETs that don't match a file return index.html so
        // client-side routing works; everything else keeps the JSON 404 behavior.
        server.setNotFoundHandler((request, reply) => {
            if (request.method !== 'GET' || request.url.startsWith('/api')) {
                return reply.status(404).send({ message: `Route ${request.method}:${request.url} not found` });
            }

            return reply.type('text/html').sendFile('index.html');
        });
    }
    catch (ex) {
        server.log.error({ tags: [PluginName] }, `registering failed: ${exMessage(ex)}`);

        throw ex;
    }
};

export default fp(webClientPlugin, {
    fastify: '5.x',
    name: PluginName,
    dependencies: [
        ConfigPluginName
    ]
});
