# Runner (Node + TypeScript + Playwright) - build tu goc repo (context = thu muc goc)
# S1.1: chua cai browser; Chromium/Xvfb se duoc them o Story S3.1.
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @autotest/runner build

FROM node:22-slim AS runtime
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN corepack enable
WORKDIR /app
COPY --from=build /app /app
CMD ["pnpm", "--filter", "@autotest/runner", "start"]
