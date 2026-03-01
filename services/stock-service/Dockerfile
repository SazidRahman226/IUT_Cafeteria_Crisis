FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund --loglevel=error
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc
RUN npm prune --omit=dev && npm cache clean --force

FROM node:20-alpine
ENV NODE_ENV=production
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup
WORKDIR /app
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/package.json ./
USER appuser
EXPOSE 4002
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 CMD node -e "require('http').get('http://localhost:4002/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"
CMD ["node", "dist/index.js"]