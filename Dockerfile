FROM node:22-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
# next.config.ts sets `output: 'standalone'`: .next/standalone is a self-contained
# server (server.js + only the node_modules it uses).
RUN npm run build

# The Prisma CLI, installed on its own at the exact version of the lockfile. It is a
# development dependency of the app, so it is not part of the standalone bundle, but
# the container needs it to apply migrations when it starts.
# The last command removes what only Prisma Studio and `prisma dev` use (about 120 MB):
# a user interface, a local database and the query compilers. `migrate deploy` needs none
# of it; the CI "docker" job fails if a Prisma update ever changes that.
FROM base AS migrate
COPY package-lock.json ./
RUN PRISMA_VERSION="$(node -p "require('./package-lock.json').packages['node_modules/prisma'].version")" \
 && npm install --prefix /opt/migrate --omit=dev --no-audit --no-fund --no-package-lock "prisma@${PRISMA_VERSION}" \
 && cd /opt/migrate/node_modules \
 && rm -rf @electric-sql react react-dom scheduler elkjs @visx @radix-ui @types classnames csstype \
      d3-* delaunator internmap robust-predicates \
      @prisma/studio-core/dist/ui @prisma/query-plan-executor \
      prisma/build/studio.js prisma/build/query_compiler_*.wasm

FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PRISMA_HIDE_UPDATE_MESSAGE=1 \
    CHECKPOINT_DISABLE=1
# Nothing here needs npm or yarn: the server is started with `node`.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# The operator's configuration. It comes from the build context (which the docker client sends itself, so it
# works whatever the daemon can see of the host's folders: rootless, remote, network share), through the
# builder stage, where next.config.ts has just validated it: a missing, empty, unreadable or invalid file
# fails the BUILD with a message that says what to do, not the start in a loop. docker-compose.yml does NOT
# mount it: a file bind mount that the daemon cannot resolve or the app cannot read breaks the start.
COPY --from=builder --chown=nextjs:nodejs /app/bde.config.yml ./
COPY --from=builder --chown=nextjs:nodejs /app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma/migrations ./prisma/migrations
COPY --from=migrate --chown=nextjs:nodejs /opt/migrate /opt/migrate
COPY --chown=nextjs:nodejs docker/prisma.config.mjs /opt/migrate/prisma.config.mjs
# What starts the container: applies the migrations, then the application, and explains in the browser what
# the operator can fix instead of letting the restart policy loop (see the top of docker/start.mjs).
COPY --chown=nextjs:nodejs docker/start.mjs docker/startup-problems.mjs docker/master-secrets.mjs /opt/start/
# Where the `secrets` volume is mounted (docker/master-secrets.mjs). Created here so that the keys can also be
# written when the image runs without the volume, and so that a new volume starts with the right owner.
RUN mkdir /secrets && chown nextjs:nodejs /secrets && chmod 700 /secrets
USER nextjs
EXPOSE 3000

# 503 while the database is unreachable (see src/lib/health.ts).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

CMD ["node", "/opt/start/start.mjs"]
