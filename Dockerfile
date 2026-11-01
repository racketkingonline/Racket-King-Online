# Racket King Online: un solo container con client (dist/) e server (Node + tsx).
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "node_modules/.bin/tsx", "server/index.ts"]
