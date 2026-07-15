# Multi-arch Dockerfile (linux/amd64, linux/arm64) for the Z-Wave monorepo.
# Builds all workspaces (contracts, service, web) and produces a single runtime
# image where the Fastify service serves both the REST API and the web client.
#
# node:22-bookworm is multi-arch, so buildx selects the right base per platform.
# The only native dependency (@serialport/bindings-cpp, via zwave-js) ships prebuilt
# linux-x64 / linux-arm64 N-API binaries via node-gyp-build, so no toolchain is
# needed on either glibc target.

# Stage 1: Build stage
FROM node:22-bookworm AS buildstage

ENV WORKINGDIR=/app
WORKDIR ${WORKINGDIR}

# Install deps first (workspace manifests + lockfile) for better layer caching
COPY package.json package-lock.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/service/package.json ./packages/service/
COPY packages/web/package.json ./packages/web/
RUN npm ci --verbose

# Copy sources and build every workspace (contracts -> schemas -> service, + web)
COPY eslint.config.mjs ./
COPY packages ./packages
RUN npm run build
RUN npm run lint

# Drop dev dependencies from the hoisted node_modules
RUN npm prune --production

# Stage 2: Runtime stage - minimal image
FROM node:22-bookworm-slim AS runtime

# Non-root user, in dialout for serial access
RUN useradd -m -s /bin/bash zwaveuser && \
    usermod -aG dialout zwaveuser

# Pre-create the storage dir owned by the app user so a fresh named volume inherits
# writable ownership (security keys, network cache, rooms/scenes)
RUN mkdir -p /rpi-zwave/data && chown -R zwaveuser:zwaveuser /rpi-zwave

ENV WORKINGDIR=/app
WORKDIR ${WORKINGDIR}

# Copy the pruned dependency tree (keeps the @zwave-service/contracts workspace symlink)
COPY --from=buildstage --chown=zwaveuser:zwaveuser ${WORKINGDIR}/package.json ${WORKINGDIR}/
COPY --from=buildstage --chown=zwaveuser:zwaveuser ${WORKINGDIR}/node_modules ${WORKINGDIR}/node_modules

# Contracts (resolved via the node_modules symlink at runtime)
COPY --from=buildstage --chown=zwaveuser:zwaveuser ${WORKINGDIR}/packages/contracts/package.json ${WORKINGDIR}/packages/contracts/
COPY --from=buildstage --chown=zwaveuser:zwaveuser ${WORKINGDIR}/packages/contracts/dist ${WORKINGDIR}/packages/contracts/dist

# Service (built app + its env config dir)
COPY --from=buildstage --chown=zwaveuser:zwaveuser ${WORKINGDIR}/packages/service/package.json ${WORKINGDIR}/packages/service/
COPY --from=buildstage --chown=zwaveuser:zwaveuser ${WORKINGDIR}/packages/service/dist ${WORKINGDIR}/packages/service/dist
COPY --from=buildstage --chown=zwaveuser:zwaveuser ${WORKINGDIR}/packages/service/configs ${WORKINGDIR}/packages/service/configs

# Web client build, served by the service from webClientRoot (default /app/web)
COPY --from=buildstage --chown=zwaveuser:zwaveuser ${WORKINGDIR}/packages/web/dist ${WORKINGDIR}/web

USER zwaveuser

EXPOSE 9094

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
    CMD node -e "require('http').get('http://localhost:9094/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

ENV NODE_ENV=production
ENV webClientRoot=/app/web

ENTRYPOINT ["node", "/app/packages/service/dist/index.js"]
