#!/bin/sh
set -eu
set -o pipefail

# Hardened replacement for the upstream restore.sh shipped by
# eeshugerman/postgres-backup-s3. The upstream script does not fail closed on
# pg_restore errors and its latest-object lookup does not match the backup key
# layout produced by backup.sh.

: "${POSTGRES_DATABASE:?POSTGRES_DATABASE is required}"
: "${POSTGRES_HOST:?POSTGRES_HOST is required}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"
: "${S3_PREFIX:=backup}"
: "${S3_REGION:=auto}"
: "${S3_S3V4:=yes}"
: "${S3_ENDPOINT:=}"
: "${S3_ACCESS_KEY_ID:=}"
: "${S3_SECRET_ACCESS_KEY:=}"
: "${PASSPHRASE:=}"
: "${RESTORE_DATABASE:=${POSTGRES_DATABASE}}"
: "${REQUIRE_ENCRYPTED_BACKUP:=no}"

case "${REQUIRE_ENCRYPTED_BACKUP}" in
  yes|no) ;;
  *) echo "REQUIRE_ENCRYPTED_BACKUP must be yes or no." >&2; exit 1 ;;
esac

export AWS_DEFAULT_REGION="${S3_REGION}"
[ -z "${S3_ACCESS_KEY_ID}" ] || export AWS_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID}"
[ -z "${S3_SECRET_ACCESS_KEY}" ] || export AWS_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY}"
export PGPASSWORD="${POSTGRES_PASSWORD}"

if [ "${S3_S3V4}" = "yes" ]; then
  aws configure set default.s3.signature_version s3v4
fi

aws_s3() {
  if [ -n "${S3_ENDPOINT}" ]; then
    aws --endpoint-url "${S3_ENDPOINT}" "$@"
  else
    aws "$@"
  fi
}

WORK_DIR="$(mktemp -d /tmp/quasar-restore.XXXXXX)"
ARCHIVE="${WORK_DIR}/backup"
trap 'rm -rf "${WORK_DIR}"' EXIT INT TERM

# backup.sh writes keys as: ${S3_PREFIX}/${POSTGRES_DATABASE}_<timestamp>.dump[.gpg]
OBJECT_KEY="${REMOTE_BACKUP_KEY:-}"
if [ -z "${OBJECT_KEY}" ]; then
  OBJECT_KEY="$(aws_s3 s3 ls "s3://${S3_BUCKET}/${S3_PREFIX}/" \
    | awk -v prefix="${POSTGRES_DATABASE}_" '$4 ~ ("/" prefix) || $4 ~ ("^" prefix) { print $4 }' \
    | sort \
    | tail -n 1)"
fi

if [ -z "${OBJECT_KEY}" ]; then
  echo "No remote backup found for database ${POSTGRES_DATABASE}." >&2
  exit 1
fi

case "${OBJECT_KEY}" in
  "${S3_PREFIX}"/*) REMOTE_URI="s3://${S3_BUCKET}/${OBJECT_KEY}" ;;
  *) REMOTE_URI="s3://${S3_BUCKET}/${S3_PREFIX}/${OBJECT_KEY}" ;;
esac

if [ "${REQUIRE_ENCRYPTED_BACKUP}" = "yes" ] && [ "${OBJECT_KEY##*.}" != "gpg" ]; then
  echo "Encrypted logical backup is required, but selected object is not a .gpg artifact: ${OBJECT_KEY}" >&2
  exit 1
fi

echo "Fetching remote backup object for ${POSTGRES_DATABASE}..."
aws_s3 s3 cp "${REMOTE_URI}" "${ARCHIVE}"

RESTORE_FILE="${ARCHIVE}"
case "${OBJECT_KEY}" in
  *.gpg)
    [ -n "${PASSPHRASE}" ] || {
      echo "PASSPHRASE is required for encrypted backup ${OBJECT_KEY}." >&2
      exit 1
    }
    printf '%s' "${PASSPHRASE}" | gpg --decrypt --batch --yes --passphrase-fd 0 "${ARCHIVE}" > "${WORK_DIR}/backup.dump"
    RESTORE_FILE="${WORK_DIR}/backup.dump"
    ;;
  *.dump) ;;
  *)
    echo "Unsupported backup object suffix: ${OBJECT_KEY}" >&2
    exit 1
    ;;
esac

echo "Restoring ${OBJECT_KEY} into database ${RESTORE_DATABASE}..."
pg_restore --exit-on-error --clean --if-exists --no-owner --no-privileges \
  -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" \
  -d "${RESTORE_DATABASE}" "${RESTORE_FILE}"
echo "Remote backup restore completed successfully."
