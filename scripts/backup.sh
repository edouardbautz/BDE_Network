#!/bin/sh
# Sauvegarde la base de données dans UNE archive :
#   backups/bde-backup-AAAA-MM-JJ_HH-MM-SS.tar.gz
#
# Ne demande que Docker (avec « docker compose ») et les outils Unix habituels :
# pas besoin de Node.js sur le serveur. Sous Windows, lancez-le depuis Git Bash ou WSL.
#
# Usage : ./scripts/backup.sh [--keep N]
#   --keep N   ne garde que les N sauvegardes les plus récentes (supprime les plus anciennes)
#
# L'archive contient des données personnelles : elle n'est lisible que par vous (chmod 600),
# copiez-la hors du serveur. Elle ne contient PAS le fichier .env (clés secrètes) : gardez-le
# à part, dans un endroit sûr.
set -eu

# Git Bash (Windows) réécrit les chemins comme /app/... dans les arguments ; sans effet ailleurs.
export MSYS_NO_PATHCONV=1
umask 077

usage() {
  echo "Usage : ./scripts/backup.sh [--keep N]"
}

KEEP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --keep)
      if [ $# -lt 2 ]; then
        echo "--keep demande un nombre (par exemple : --keep 14)." >&2
        exit 2
      fi
      KEEP="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Option inconnue : $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$KEEP" in
  "" | *[!0-9]* | 0)
    if [ -n "$KEEP" ]; then
      echo "--keep doit être un nombre entier supérieur à 0 (reçu : « $KEEP »)." >&2
      exit 2
    fi
    ;;
esac

cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker (avec la commande « docker compose ») est introuvable : installez-le d'abord." >&2
  exit 1
fi

if ! docker compose ps --status running --services 2>/dev/null | grep -qx postgres; then
  echo "La base de données ne tourne pas : lancez d'abord « docker compose up -d »." >&2
  exit 1
fi

mkdir -p backups
STAMP="$(date +%Y-%m-%d_%H-%M-%S)"
# BACKUP_LABEL est utilisé par restore.sh pour nommer sa sauvegarde de sécurité.
OUTPUT="backups/bde-backup-${STAMP}${BACKUP_LABEL:-}.tar.gz"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM

echo "Sauvegarde de la base de données..."
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" --clean --if-exists "$POSTGRES_DB"' >"$WORK/database.sql"
if ! tail -n 5 "$WORK/database.sql" | grep -q "PostgreSQL database dump complete"; then
  echo "La sauvegarde de la base est incomplète : abandon (aucun fichier créé)." >&2
  exit 1
fi

{
  echo "Sauvegarde BDE_Network"
  echo "Date : $(date '+%Y-%m-%d %H:%M:%S')"
} >"$WORK/info.txt"

tar -czf "$OUTPUT" -C "$WORK" database.sql info.txt

if [ -n "$KEEP" ]; then
  # ls -t : du plus récent au plus ancien ; on supprime tout ce qui dépasse N.
  # shellcheck disable=SC2012
  ls -1t backups/bde-backup-*.tar.gz | tail -n +"$((KEEP + 1))" | while read -r OLD; do
    rm -f "$OLD"
    echo "Ancienne sauvegarde supprimée : $OLD"
  done
fi

SIZE="$(du -h "$OUTPUT" | cut -f1)"
echo ""
echo "Sauvegarde terminée : $OUTPUT ($SIZE)"
echo "Pensez à la copier hors du serveur (scp, rsync, rclone...)."
