# syntax=docker/dockerfile:1

ARG NODE_VERSION=24-alpine

################################################################################
# Base image shared by every stage.
FROM node:${NODE_VERSION} AS base
WORKDIR /app

################################################################################
# Install dependencies.
FROM base AS deps
# recommended by the Next.js example for alpine compatibility
RUN apk add --no-cache libc6-compat
COPY package-lock.json package.json ./

# Husky runs via the "prepare" script -> disable scripts during container install.
ENV HUSKY=0
RUN npm ci --ignore-scripts

################################################################################
# Build the application (needs devDependencies).
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
RUN npm run build

################################################################################
# Production-only runner from the standalone output.
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

# Proper signal handling / zombie reaping.
RUN apk add --no-cache dumb-init

# Run as a non-root user.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
# standalone output bundles a minimal node_modules + server.js
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3001

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
