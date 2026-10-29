FROM node:22-alpine
ENV NODE_ENV=production
RUN npm install --global --ignore-scripts --no-audit --no-fund typescript typescript-language-server \
  && npm cache clean --force
WORKDIR /workspace
USER 1000:1000
CMD ["typescript-language-server", "--stdio"]
