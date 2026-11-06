FROM node:24-bookworm

# ffmpeg and ffprobe for the tests that run them; NVENC needs an NVIDIA GPU, which this container does not have.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install --global pnpm@12

USER node
WORKDIR /workspaces/homestream
