import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// The web client and the Fastify service share API types via the contracts
// package. Alias it to the source so dev/build don't require a prior build of it.
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@zwave-service/contracts': fileURLToPath(new URL('../contracts/src/index.ts', import.meta.url))
        }
    },
    server: {
        // Proxy API calls to the running service during `npm run dev:web`
        proxy: {
            '/api': 'http://localhost:9094'
        }
    },
    build: {
        outDir: 'dist'
    }
});
