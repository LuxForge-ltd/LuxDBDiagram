/**
 * Starts the LuxDBDiag GitHub service.
 *
 * Purpose: an HTTP server for the routes in `routes.ts`, reached by the app through its nginx at
 * `/api/github/`. Settings come from the environment (see `config.ts`); missing ones are logged
 * by name, never with their values.
 */
import { createServer } from 'node:http';
import { readConfig } from './config.ts';
import { createHandler } from './routes.ts';

const config = readConfig(process.env);
if (config.accessDisabled) {
    console.warn(
        'Cloudflare Access checks are OFF (ALLOW_WITHOUT_ACCESS=true). Use this only for local development.'
    );
}
if (config.problems.length > 0) {
    console.warn(`Settings missing or invalid: ${config.problems.join(', ')}`);
}

const handler = createHandler({ config });
const server = createServer((req, res) => {
    void handler(req, res);
});
server.requestTimeout = 60_000;
server.headersTimeout = 20_000;

server.listen(config.port, () => {
    console.log(`LuxDBDiag GitHub service listening on port ${config.port}`);
});

const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
