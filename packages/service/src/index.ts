/* eslint-disable no-console */
import { FastifyInstance } from 'fastify';
import { Server, IncomingMessage, ServerResponse } from 'node:http';
import composeServer from './composeServer.js';
import { loggerOptions } from './logging.js';
import { exMessage, forget } from './utils/index.js';

const ModuleName = 'Main';

process.on('unhandledRejection', (err) => {
    console.error(err);
    process.exit(1);
});

async function start() {
    try {
        const server: FastifyInstance<Server, IncomingMessage, ServerResponse> = await composeServer({
            logger: loggerOptions(),
            pluginTimeout: 60_000
        });

        server.log.info({ tags: [ModuleName] }, `🚀 Server instance started`);

        const PORT = (server.config.env.PORT ?? process.env.PORT ?? process.env.port);
        if (!PORT) {
            throw new Error('PORT is not defined');
        }

        await server.listen({
            host: '0.0.0.0',
            port: Number(PORT)
        });

        for (const signal of ['SIGINT', 'SIGTERM']) {
            process.on(signal, () => {
                console.log(`Closing server instance with ${signal}`);

                forget(async () => {
                    try {
                        await server.close();
                        process.exit(0);
                    }
                    catch (ex) {
                        console.error(`Error closing server instance: ${exMessage(ex)}`);
                        process.exit(1);
                    }
                });
            });
        }
    }
    catch (ex) {
        console.error(`Error ${ModuleName}: ${exMessage(ex)}`);
        console.info(`Error ${ModuleName}: ☮︎ Stopping server`);

        process.exit(1);
    }
}

void (async () => {
    await start();
})().catch();
