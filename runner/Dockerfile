FROM node:22-alpine
RUN apk add --no-cache docker-cli
WORKDIR /app
COPY zip-utils.cjs ./zip-utils.cjs
COPY runner/worker.cjs ./runner/worker.cjs
COPY runner/preview.cjs ./runner/preview.cjs
COPY runner/preview-stream.cjs ./runner/preview-stream.cjs
COPY scripts/verify-runner-e2e.cjs ./scripts/verify-runner-e2e.cjs
ENV NODE_ENV=production PORT=4311 ARENA_RUNNER_DATA=/srv/arena-runner
RUN mkdir -p /srv/arena-runner && chmod 700 /srv/arena-runner
EXPOSE 4311
# Docker socket access is highly privileged. Run this service only on a dedicated host/private network.
CMD ["node", "runner/worker.cjs"]
