FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/editor-runtime
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
USER node
