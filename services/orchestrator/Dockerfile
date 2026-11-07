# syntax=docker/dockerfile:1
# Orchestrator (Node + TypeScript) - build tu goc repo (context = thu muc goc)
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY . .
# Cache mount: ca 3 service dung CHUNG mot kho goi pnpm, va cac lan build
# sau cung dung lai - goi nao da tai thi khong tai lai nua.
RUN --mount=type=cache,id=autotest-pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --store-dir /pnpm/store
# Dau "..." sau ten goi: build ca cac goi phu thuoc trong workspace
# (@autotest/oracle, @autotest/scenario-schema) TRUOC orchestrator.
# Thieu buoc nay, tsc loi TS2307 vi cac goi phu thuoc chua co dist/.
RUN pnpm --filter @autotest/orchestrator... build

FROM node:22-slim AS runtime
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY --from=build /app /app
ENV PORT=3101
EXPOSE 3101
CMD ["pnpm", "--filter", "@autotest/orchestrator", "start"]
