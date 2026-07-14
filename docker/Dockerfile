# Multi-arch Dockerfile (linux/amd64, linux/arm64) for the Z-Wave controller service.
#
# node:22-bookworm is a multi-arch image, so buildx selects the correct base for
# each target platform. The only native dependency (@serialport/bindings-cpp, via
# zwave-js) ships prebuilt linux-x64 and linux-arm64 N-API binaries and installs
# with node-gyp-build, so no compiler/python toolchain is required on either
# glibc target.

# Stage 1: Build stage
FROM node:22-bookworm AS buildstage

ENV WORKINGDIR=/app
WORKDIR ${WORKINGDIR}

# Copy package files first for better caching
COPY package*.json ${WORKINGDIR}/

# Install all dependencies (including dev dependencies for building)
RUN npm ci --verbose

# Copy source files
COPY eslint.config.mjs ${WORKINGDIR}/
COPY tsconfig.json ${WORKINGDIR}/
COPY .scripts ${WORKINGDIR}/.scripts
COPY src ${WORKINGDIR}/src

# Generate JSON schemas from the TypeScript types, then build
RUN npm run build:schemas
RUN npm run build

# Run linting
RUN npm run lint

# Remove dev dependencies, keeping only production
RUN npm prune --production

# Clean up source files after build
RUN rm -rf src tsconfig.json eslint.config.mjs .scripts

# Stage 2: Runtime stage - minimal image for running
FROM node:22-bookworm-slim AS runtime

# Create non-root user for running the application, add to dialout for serial access
RUN useradd -m -s /bin/bash zwaveuser && \
    usermod -aG dialout zwaveuser

# Pre-create the default storage directory owned by the app user. A fresh named
# volume mounted here inherits this ownership, so the service can write its
# security keys, network cache, and rooms/scenes as the non-root user.
RUN mkdir -p /rpi-zwave/data && chown -R zwaveuser:zwaveuser /rpi-zwave

ENV WORKINGDIR=/app
WORKDIR ${WORKINGDIR}

# Copy built application from build stage
COPY --from=buildstage --chown=zwaveuser:zwaveuser ${WORKINGDIR}/package*.json ${WORKINGDIR}/
COPY --from=buildstage --chown=zwaveuser:zwaveuser ${WORKINGDIR}/node_modules ${WORKINGDIR}/node_modules
COPY --from=buildstage --chown=zwaveuser:zwaveuser ${WORKINGDIR}/dist ${WORKINGDIR}/dist

# Switch to non-root user
USER zwaveuser

# Expose application port
EXPOSE 9094

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
    CMD node -e "require('http').get('http://localhost:9094/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Set Node.js production environment
ENV NODE_ENV=production

# Start the application
ENTRYPOINT ["node", "/app/dist/index.js"]
