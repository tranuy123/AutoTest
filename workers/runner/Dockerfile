# Runner (Node + TypeScript + Playwright + Xvnc) - build tu goc repo (context = thu muc goc)
# S3.1/S3.2 (AD-9): moi phien che do xem chay Chromium headed duoi mot Xvnc
# (TigerVNC) rieng; Stream Gateway phat hinh qua noVNC o cong 3102.
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# Dau "..." sau ten goi: build ca cac goi phu thuoc trong workspace
# (@autotest/oracle) TRUOC runner, theo dung thu tu phu thuoc.
# Thieu buoc nay, tsc cua runner loi TS2307 vi oracle chua co dist/.
RUN pnpm --filter @autotest/runner... build

FROM node:22-slim AS runtime
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY --from=build /app /app
# Chromium + thu vien he thong cho Playwright, Xvnc cho stream noVNC.
RUN apt-get update \
  && apt-get install -y --no-install-recommends tigervnc-standalone-server \
  && pnpm --filter @autotest/runner exec playwright install --with-deps chromium \
  && rm -rf /var/lib/apt/lists/*
ENV RUNNER_PORT=3102
EXPOSE 3102
CMD ["pnpm", "--filter", "@autotest/runner", "start"]
