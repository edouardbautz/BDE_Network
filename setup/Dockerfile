# The setup assistant: an interactive questionnaire that writes .env and bde.config.yml.
# It runs in its own container (see docker-compose.setup.yml), so the only thing a BDE needs is Docker.
#
#   docker compose -f docker-compose.setup.yml run --rm --build setup
#
# The build context is the repository, but .dockerignore for this file (Dockerfile.dockerignore)
# lets in only what the assistant uses.
FROM node:22-alpine

# The Docker CLI and the compose plugin: the assistant can start the platform when it has written the
# configuration, through the host's Docker socket (docker-compose.setup.yml mounts it).
RUN apk add --no-cache docker-cli docker-cli-compose docker-cli-buildx

WORKDIR /wizard
ENV PROJECT_DIR=/project \
    NO_UPDATE_NOTIFIER=1 \
    NODE_ENV=production

# The same versions as the platform's own package-lock.json (a test keeps them equal), installed on
# their own so that the assistant does not carry the platform's hundreds of dependencies.
RUN npm install --no-audit --no-fund --no-package-lock \
    zod@4.6.5 js-yaml@5.4.2 nodemailer@10.0.15 tsx@4.23.15

# The platform's own configuration schema, so that what the assistant writes is checked with it, and
# the Slack app manifest, for the pre-filled link.
COPY src/config/schema.ts ./src/config/schema.ts
COPY docs/slack-app-manifest.yml ./docs/slack-app-manifest.yml
COPY setup ./setup

CMD ["node_modules/.bin/tsx", "setup/main.ts"]
