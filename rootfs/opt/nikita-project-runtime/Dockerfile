# Toolchain only. No application sources, sample site, private locks or build output.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /project
USER node
