# syntax=docker/dockerfile:1
FROM node:22-alpine

# gh CLI is optional — Rei uses GITHUB_TOKEN + REST API by default.
# Install it only if you prefer the CLI path (e.g. for local dev).
# RUN apk add --no-cache github-cli

WORKDIR /app

# Copy package.json first for layer caching
COPY package.json ./

# No npm install needed (zero runtime deps — pure Node.js)
# Copy source
COPY . .

# Default port
ENV REI_HOST=0.0.0.0
EXPOSE 4317

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4317/api/health || exit 1

# Start in demo mode by default; override with -e DEMO_MODE=false
CMD ["node", "server.mjs"]
