FROM node:22-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
COPY --from=web /web/dist /app/web/dist
ENV WEB_DIST=/app/web/dist
EXPOSE 3000
CMD ["node", "src/index.js"]
