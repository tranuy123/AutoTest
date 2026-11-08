# syntax=docker/dockerfile:1
# Control App (Next.js) - build tu goc repo (context = thu muc goc)
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY . .
# Cache mount: ca 3 service dung CHUNG mot kho goi pnpm, va cac lan build
# sau cung dung lai - goi nao da tai thi khong tai lai nua.
RUN --mount=type=cache,id=autotest-pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --store-dir /pnpm/store
# Dau "..." sau ten goi: build ca goi phu thuoc trong workspace
# (@autotest/scenario-schema) TRUOC control. Thieu buoc nay, Next build
# loi khong tim thay module vi scenario-schema chua co dist/.
RUN pnpm --filter @autotest/control... build

FROM node:22-slim AS runtime
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY --from=build /app /app
ENV PORT=3100
EXPOSE 3100
CMD ["pnpm", "--filter", "@autotest/control", "start"]
