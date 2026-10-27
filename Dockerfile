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
RUN [ -f bde.config.yml ] || cp bde.config.example.yml bde.config.yml
# next.config.ts sets `output: 'standalone'`: .next/standalone is a self-contained
# server (server.js + only the node_modules it uses).
RUN npm run build
# The version of this image (package.json): the start-up command reads it, the application shows it, and the copies of
# the database made before an update carry it.
RUN node -p "require('./package.json').version" > /app/.bde-version

# The Prisma CLI, installed on its own at the exact version of the lockfile. It is a
# development dependency of the app, so it is not part of the standalone bundle, but
# the container needs it to apply migrations when it starts.
# The last command removes what only Prisma Studio and `prisma dev` use (about 170 MB):
# a user interface, a local database and the query compilers, and, in what has to stay,
# what is never run: the sources and the type declarations of `effect`, the files of the local
# database of `prisma dev` (the three that weigh 18 MB), the build metadata of Studio, and the
# drivers of databases we do not use. Each of these was tried alone against a real PostgreSQL:
# `migrate deploy` needs none of it, and a package that cannot lose a file (`effect/dist/cjs`,
# `@prisma/dev` itself) is not touched. The CI "docker" job fails if a Prisma update ever changes
# that.
FROM base AS migrate
COPY package-lock.json ./
RUN PRISMA_VERSION="$(node -p "require('./package-lock.json').packages['node_modules/prisma'].version")" \
 && npm install --prefix /opt/migrate --omit=dev --no-audit --no-fund --no-package-lock "prisma@${PRISMA_VERSION}" \
 && cd /opt/migrate/node_modules \
 && rm -rf @electric-sql react react-dom scheduler elkjs @visx @radix-ui @types classnames csstype \
      d3-* delaunator internmap robust-predicates \
      @prisma/studio-core/dist/ui @prisma/query-plan-executor \
      prisma/build/studio.js prisma/build/query_compiler_*.wasm \
      @prisma/dev/dist/runtime-assets/pglite.wasm @prisma/dev/dist/runtime-assets/pglite.data \
      @prisma/dev/dist/runtime-assets/pglite-seed.tar.gz \
      @prisma/studio-core/dist/metafile-cjs.json @prisma/studio-core/dist/metafile-esm.json \
      effect/src effect/dist/dts effect/dist/esm \
      lodash mysql2 iconv-lite aws-ssl-profiles postgres find-my-way

# Node.js alone: the image of Node also carries npm, yarn and corepack (24 MB that nothing here runs), and deleting them in a
# later layer gives nothing back. The runner stage starts from Alpine and takes only the binary.
FROM base AS node-binary

FROM alpine:3.24 AS runner
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=node-binary /usr/local/bin/node /usr/local/bin/node
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PRISMA_HIDE_UPDATE_MESSAGE=1 \
    CHECKPOINT_DISABLE=1 \
    UPLOADS_DIR=/uploads \
    NODE_OPTIONS="--max-old-space-size=384 --max-semi-space-size=32"
# NODE_OPTIONS: on a computer with a lot of memory, Node.js lets its heap grow to a gigabyte and more before it cleans (1,060 MiB
# after the load of 20 people, on a server that a BDE shares with other things). With these two limits the same load peaks at
# 335 MiB and is served as fast (13.4 requests a second against 13.8-14.0, 95 % of the answers in 1.28 s against 1.33 s): the heap
# is 384 MiB at most, and the young generation, which absorbs a page's short-lived objects, 32 MiB per space. A server with less than
# 768 MiB for the application should not run it (docs/en/deployment.md); a bigger one can set NODE_OPTIONS in docker-compose.yml.
# `psql` and `pg_dump` (the same major version as the bundled PostgreSQL): the start-up command keeps a copy of the database
# before applying migrations and puts it back if they fail (docker/database-tools.mjs).
# The operating system of the base image is updated first: a security fix of a library (OpenSSL, for the tools above) is
# published for Alpine before it reaches the next Node image, and the scan of the image (CI) fails on a fix that is there.
# (`libstdc++` is the one library the binary of Node.js needs besides the system's.) Nothing here needs npm or yarn: the server is
# started with `node`.
RUN apk upgrade --no-cache && apk add --no-cache libstdc++ postgresql17-client \
 && addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# bde.config.yml: the seed of an installation that has not been imported into the database yet (the first start
# copies it there, src/lib/settings/store.ts, and the database is the only source from then on). It comes from
# the build context (which the docker client sends itself, so it works whatever the daemon can see of the host's
# folders: rootless, remote, network share), through the builder stage. docker-compose.yml does NOT mount it.
# A missing file is replaced by the example, which means "nothing decided yet": the build never depends on it.
COPY --from=builder --chown=nextjs:nodejs /app/bde.config.yml ./
COPY --from=builder --chown=nextjs:nodejs /app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma/migrations ./prisma/migrations
COPY --from=migrate --chown=nextjs:nodejs /opt/migrate /opt/migrate
COPY --chown=nextjs:nodejs docker/prisma.config.mjs /opt/migrate/prisma.config.mjs
# What starts the container: applies the migrations, then the application, and explains in the browser what
# the operator can fix instead of letting the restart policy loop (see the top of docker/start.mjs).
COPY --chown=nextjs:nodejs docker/start.mjs docker/startup-problems.mjs docker/master-secrets.mjs docker/safe-update.mjs docker/database-tools.mjs /opt/start/
COPY --from=builder --chown=nextjs:nodejs /app/.bde-version /opt/start/version
# Where the `secrets` volume is mounted (docker/master-secrets.mjs). Created here so that the keys can also be
# written when the image runs without the volume, and so that a new volume starts with the right owner.
# Where the `uploads` volume is mounted: the BDE's logo (src/lib/branding). Also created here, for the same reason.
# Where the `backups` volume is mounted: the copies of the database made before an update. Created here for the same reason.
RUN mkdir /secrets /uploads /backups && chown nextjs:nodejs /secrets /uploads /backups && chmod 700 /secrets /backups
USER nextjs
EXPOSE 3000

# 503 while the database is unreachable (see src/lib/health.ts).
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

CMD ["node", "/opt/start/start.mjs"]
