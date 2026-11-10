# Deme ERP: one container, no build step, no packages to install.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY web ./web
ENV NODE_ENV=production PORT=8800 DEME_DB=/data/deme.db
# The database lives on a volume so it survives new releases.
VOLUME /data
EXPOSE 8800
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
