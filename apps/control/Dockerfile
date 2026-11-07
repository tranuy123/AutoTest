# Control App (Next.js) - build tu goc repo (context = thu muc goc)
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @autotest/control build

FROM node:22-slim AS runtime
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY --from=build /app /app
ENV PORT=3100
EXPOSE 3100
CMD ["pnpm", "--filter", "@autotest/control", "start"]
