# Deme Intelligence as one container: the Node server with its data in a SQLite file on a volume.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
# Only the Anthropic SDK is needed here (for AI import mapping); the Postgres driver is for Netlify.
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY shared ./shared
COPY web ./web
ENV NODE_ENV=production PORT=8800 DEME_DB=/data/deme.db
VOLUME /data
EXPOSE 8800
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
