FROM postgres:16

ARG TARGETARCH
ARG WAL_G_VERSION=v3.0.8

# WAL-G is downloaded from the official release and verified by architecture-
# specific SHA-256 before it enters the PostgreSQL image. Do not replace this
# with a mutable latest tag or an unverified binary.
RUN case "${TARGETARCH}" in \
        amd64) WAL_G_ARCH=amd64; WAL_G_SHA256=f30544c5ce93cf83b87578e3c4a2e9c0e0ffc3d160ef89ecddaf75f397d98deb ;; \
        arm64) WAL_G_ARCH=aarch64; WAL_G_SHA256=794d1a81f0c27825a1603bd39c0f2cf5dd8bed7cc36b598ca05d8d963c3d5fcf ;; \
        *) echo "Unsupported WAL-G architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && apt-get update -qq \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && curl -fsSL "https://github.com/wal-g/wal-g/releases/download/${WAL_G_VERSION}/wal-g-pg-22.04-${WAL_G_ARCH}" -o /usr/local/bin/wal-g \
    && echo "${WAL_G_SHA256}  /usr/local/bin/wal-g" | sha256sum -c - \
    && chmod 0755 /usr/local/bin/wal-g \
    && apt-get purge -y --auto-remove ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends \
        postgresql-16-repmgr \
        curl \
        ca-certificates \
        sudo \
        procps \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/run/postgresql /var/log/postgresql /var/lib/postgresql/wal_archive \
    && chown -R postgres:postgres /var/run/postgresql /var/log/postgresql /var/lib/postgresql/wal_archive

ENV PATH="/usr/lib/postgresql/16/bin:${PATH}"
ENV REPMGR_CONF="/etc/repmgr.conf"

COPY dockerfiles/postgresql-repmgr/entrypoint-primary.sh /entrypoint-primary.sh
COPY dockerfiles/postgresql-repmgr/entrypoint-standby.sh /entrypoint-standby.sh
COPY scripts/wal-g-pitr-restore.sh /usr/local/bin/wal-g-pitr-restore.sh

RUN chmod +x /entrypoint-primary.sh /entrypoint-standby.sh /usr/local/bin/wal-g-pitr-restore.sh
