# Follow-Up microservice — standalone image
FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9

# Build stage
COPY package.json ./
COPY tsconfig.json ./
COPY src ./src

RUN pnpm install --prod=false && pnpm build && pnpm prune --prod

ENV NODE_ENV=production
EXPOSE 3100

# Health check — orchestrator uses this for auto-restart
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3100/health || exit 1

CMD ["node", "dist/index.js"]
