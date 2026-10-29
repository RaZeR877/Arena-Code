FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --chown=node:node package.json ./package.json
COPY --chown=node:node scripts/copy-monaco.cjs ./scripts/copy-monaco.cjs
RUN npm install --omit=dev --no-audit --no-fund
COPY --chown=node:node . .
USER node
EXPOSE 3000
CMD ["node", "server.js"]
