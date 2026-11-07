# Orchestrator (Node + TypeScript) - build tu goc repo (context = thu muc goc)
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @autotest/orchestrator build

FROM node:22-slim AS runtime
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY --from=build /app /app
ENV PORT=3101
EXPOSE 3101
CMD ["pnpm", "--filter", "@autotest/orchestrator", "start"]
