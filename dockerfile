╭─────────────────╮
│ Anybuild 0.33.3 │
╰─────────────────╯
  Detected Node.js provider
    Server: Express
    Package manager: npm
    Node version: 24
  Generated Anybuild at /tmp/.tmpDI1lp0/out/Anybuild
  Packages
  ──────────
  node  │  24
  npm   │  11  │  only build
  bash  │  -   │  only build
  Build Steps
  ───────────
  ▸ install
    $ npm install
  ▸ build
    $ npm install
  Deploy scripts
  ──────────────
  ▸ start
    $ npm start
  Starting Build...
  ─────────────────
┌──────────────────────────────────────────────────────────────────────────────┐
│    1 # syntax=docker/dockerfile:1.7-labs                                     │
│    2 FROM debian:trixie-slim AS build                                        │
│    3                                                                         │
│    4 RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \           │
│    5     --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \       │
│    6     rm -f /etc/apt/apt.conf.d/docker-clean \                            │
│    7     && apt-get update \                                                 │
│    8     && apt-get -y --no-install-recommends install \                     │
│    9         build-essential gcc make autoconf libtool bison \               │
│   10         dpkg-dev pkg-config re2c locate \                               │
│   11         libmariadb-dev libmariadb-dev-compat libpq-dev libsqlite3-dev \ │
│   12         libvips-dev default-libmysqlclient-dev libmagickwand-dev \      │
│   13         libicu-dev libxml2-dev libxslt-dev libyaml-dev \                │
│   14         sudo curl ca-certificates unzip git                             │
│   15                                                                         │
│   16 SHELL ["/bin/bash", "-o", "pipefail", "-c"]                             │
│   17 ENV MISE_DATA_DIR="/mise"                                               │
│   18 ENV MISE_CONFIG_DIR="/mise"                                             │
│   19 ENV MISE_CACHE_DIR="/mise/cache"                                        │
│   20 ENV MISE_INSTALL_PATH="/usr/local/bin/mise"                             │
│   21 ENV PATH="/mise/shims:$PATH"                                            │
│   22                                                                         │
│   23 RUN curl https://mise.run | sh                                          │
│   24 RUN mkdir -p /app                                                       │
│   25 RUN --mount=type=cache,target=/mise/cache,sharing=locked mise use --glo │
│   26 RUN --mount=type=cache,target=/mise/cache,sharing=locked mise use --glo │
│   27 WORKDIR /opt/build                                                      │
│   28 ENV CI=true NPM_CONFIG_FUND=false                                       │
│   29 RUN npm install                                                         │
│   30 COPY \                                                                  │
│   31   --exclude=node_modules \                                              │
│   32   --exclude=.git \                                                      │
│   33   . .                                                                   │
│   34 RUN npm install                                                         │
│   35 RUN npm prune --omit=dev --ignore-scripts                               │
│   36 RUN mkdir -p /opt/assets                                                │
│   37 RUN echo 'IyEvdXNyL2Jpbi9lbnYgYmFzaApzZXQgLWV1byBwaXBlZmFpbAoKcm9vdD0iJ │
│   38 RUN bash /opt/assets/optimize-node-modules.sh node_modules              │
│   39 RUN cp -R . /app                                                        │
│   40                                                                         │
│   41 FROM scratch                                                            │
│   42 COPY --from=build /app /app                                             │
│   43                                                                         │
└──────────────────────────────────────────────────────────────────────────────┘
#1 [depot] build: https://depot.dev/orgs/71bkc6nr3w/projects/63lj75k3n0/builds/3gk419k6b9
#1 DONE 0.0s
#2 [depot] launching amd64 machine
#2 DONE 0.1s
#3 [depot] connecting to amd64 machine
#3 DONE 0.0s
#4 [internal] load build definition from Dockerfile
#4 transferring dockerfile:
#4 transferring dockerfile: 2.76kB done
#4 DONE 0.1s
#5 resolve image config for docker-image://docker.io/docker/dockerfile:1.7-labs
#5 0.009 [auth] Started verifying token authority from the client for registry-1.docker.io
#5 0.012 [auth] Completed verifying token authority from the client for registry-1.docker.io after 0.003s
#5 DONE 0.1s
#6 docker-image://docker.io/docker/dockerfile:1.7-labs@sha256:b99fecfe00268a8b556fad7d9c37ee25d716ae08a5d7320e6d51c4dd83246894
#6 resolve docker.io/docker/dockerfile:1.7-labs@sha256:b99fecfe00268a8b556fad7d9c37ee25d716ae08a5d7320e6d51c4dd83246894 0.1s done
#6 CACHED
#7 [internal] load metadata for docker.io/library/debian:trixie-slim
#7 0.005 [auth] Started verifying token authority from the client for registry-1.docker.io
#7 0.007 [auth] Completed verifying token authority from the client for registry-1.docker.io after 0.002s
#7 DONE 0.1s
#8 [build  1/15] FROM docker.io/library/debian:trixie-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2
#8 resolve docker.io/library/debian:trixie-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2 0.0s done
#8 DONE 0.0s
#9 [build  2/15] RUN --mount=type=cache,target=/var/cache/apt,sharing=locked     --mount=type=cache,target=/var/lib/apt/lists,sharing=locked     rm -f /etc/apt/apt.conf.d/docker-clean     && apt-get update     && apt-get -y --no-install-recommends install         build-essential gcc make autoconf libtool bison         dpkg-dev pkg-config re2c locate         libmariadb-dev libmariadb-dev-compat libpq-dev libsqlite3-dev         libvips-dev default-libmysqlclient-dev libmagickwand-dev         libicu-dev libxml2-dev libxslt-dev libyaml-dev         sudo curl ca-certificates unzip git
#9 CACHED
#10 [build  4/15] RUN mkdir -p /app
#10 CACHED
#11 [build  5/15] RUN --mount=type=cache,target=/mise/cache,sharing=locked mise use --global "node@24"
#11 CACHED
#12 [build  3/15] RUN curl https://mise.run | sh
#12 CACHED
#13 [build  6/15] RUN --mount=type=cache,target=/mise/cache,sharing=locked mise use --global "npm@11"
#13 CACHED
#14 [build  7/15] WORKDIR /opt/build
#14 CACHED
#15 [internal] load build context
#15 transferring context:
#15 transferring context: 298.60kB 0.0s done
#15 DONE 0.1s
#16 [build  8/15] RUN npm install
#16 0.399 npm error code ENOENT
#16 0.399 npm error syscall open
#16 0.399 npm error path /opt/build/package.json
#16 0.399 npm error errno -2
#16 0.399 npm error enoent Could not read package.json: Error: ENOENT: no such file or directory, open '/opt/build/package.json'
#16 0.399 npm error enoent This is related to npm not being able to find a file.
#16 0.399 npm error enoent
#16 0.401 npm error A complete log of this run can be found in: /root/.npm/_logs/2026-11-16T20_50_39_116Z-debug-0.log
#16 ERROR: process "/bin/bash -o pipefail -c npm install" did not complete successfully: exit code: 254
------
 > [build  8/15] RUN npm install:
0.399 npm error code ENOENT
0.399 npm error syscall open
0.399 npm error path /opt/build/package.json
0.399 npm error errno -2
0.399 npm error enoent Could not read package.json: Error: ENOENT: no such file or directory, open '/opt/build/package.json'
0.399 npm error enoent This is related to npm not being able to find a file.
0.399 npm error enoent
0.401 npm error A complete log of this run can be found in: /root/.npm/_logs/2026-11-16T20_50_39_116Z-debug-0.log
------

Build Summary: https://depot.dev/orgs/71bkc6nr3w/projects/63lj75k3n0/builds/3gk419k6b9
failed to solve: process "/bin/bash -o pipefail -c npm install" did not complete successfully: exit code: 254
Error: auto failed for /tmp/.tmpDI1lp0/out: Command depot build failed with exit code Some(1): Command depot build failed with exit code Some(1)
