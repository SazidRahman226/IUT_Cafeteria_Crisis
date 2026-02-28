FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY tsconfig.json ./
COPY src ./src
RUN npm i typescript ts-node @types/express @types/jsonwebtoken @types/bcryptjs @types/pg @types/uuid @types/cors --save-dev && npx tsc
RUN npm ci --only=production && npm cache clean --force

FROM node:20-alpine
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
USER appuser
EXPOSE 4001
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 CMD node -e "require('http').get('http://localhost:4001/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"
CMD ["node", "dist/index.js"]
