import { FastifyInstance } from 'fastify';
import { exMessage } from '../utils/index.js';

// Replaces Fastify's default JSON body parser with one that tolerates an empty body.
//
// Fastify rejects `content-type: application/json` with an empty body outright
// ("Body cannot be empty when content-type is set to 'application/json'"), which trips
// up clients that always set the header (Postman, Thunder Client, `curl -H`) when
// calling the bodyless POSTs (inclusion/exclusion start/stop). An empty body parses to
// `{}` so route schemas still decide what is valid; malformed JSON is still a 400.
//
// Named export only, so @fastify/autoload never treats this as a plugin.
export function registerJsonBodyParser(server: FastifyInstance): void {
    server.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body: string, done) => {
        if (typeof body !== 'string' || body.trim() === '') {
            done(null, {});

            return;
        }

        try {
            done(null, JSON.parse(body));
        }
        catch (ex) {
            const error = new Error(`Invalid JSON body: ${exMessage(ex)}`) as Error & { statusCode?: number };
            error.statusCode = 400;

            done(error);
        }
    });
}
