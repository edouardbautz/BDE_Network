#!/bin/sh
# Sauvegarde la plateforme dans DEUX archives :
#   backups/bde-backup-AAAA-MM-JJ_HH-MM-SS.tar.gz   la base de données (membres, événements, réglages)
#   backups/bde-secrets-AAAA-MM-JJ_HH-MM-SS.tar.gz  les clés du volume « secrets » de Docker
#
# Ne demande que Docker (avec « docker compose ») et les outils Unix habituels :
# pas besoin de Node.js sur le serveur. Sous Windows, lancez-le depuis Git Bash ou WSL.
#
# Usage : ./scripts/backup.sh [--keep N]
#   --keep N   ne garde que les N sauvegardes les plus récentes (supprime les plus anciennes)
#
# Les deux archives sont lisibles par vous seul (chmod 600) ; copiez-les hors du serveur.
#
# L'archive des clés est INDISPENSABLE : les secrets de la plateforme (clé de l'application 42, mot de
# passe SMTP, webhooks) sont chiffrés dans la base, et la clé qui les déchiffre n'est que dans le volume
# « secrets ». Sans cette archive, une base restaurée sur un autre serveur ne peut plus les lire (il faut
# alors les ressaisir). Elle contient aussi la clé des sessions : gardez-la à un AUTRE endroit que
# l'archive de la base, pour qu'une fuite de l'une ne donne pas l'autre.
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
SECRETS_OUTPUT="backups/bde-secrets-${STAMP}${BACKUP_LABEL:-}.tar.gz"
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

# Les clés : lues dans le volume « secrets » par un conteneur éphémère de l'application (le même volume
# que l'application, sans avoir à en deviner le nom). Pas de mot de passe de la base dedans : il ne sert
# qu'à créer une base, pas à restaurer une sauvegarde.
echo "Sauvegarde des clés (volume « secrets »)..."
if docker compose run --rm --no-deps -T --entrypoint tar app -cf - -C /secrets auth_secret settings_key \
  >"$WORK/secrets.tar" 2>"$WORK/secrets.err" && tar -tf "$WORK/secrets.tar" | grep -qx settings_key; then
  gzip -c "$WORK/secrets.tar" >"$SECRETS_OUTPUT"
else
  SECRETS_OUTPUT=""
  echo "" >&2
  echo "ATTENTION : les clés du volume « secrets » n'ont pas pu être sauvegardées." >&2
  echo "  (L'application a-t-elle déjà démarré une fois ? Le détail : docker compose logs app)" >&2
  echo "  La base est sauvegardée, mais sans les clés ses secrets chiffrés ne seront pas lisibles sur un autre serveur." >&2
fi

tar -czf "$OUTPUT" -C "$WORK" database.sql info.txt

if [ -n "$KEEP" ]; then
  # ls -t : du plus récent au plus ancien ; on supprime tout ce qui dépasse N.
  # shellcheck disable=SC2012
  ls -1t backups/bde-backup-*.tar.gz | tail -n +"$((KEEP + 1))" | while read -r OLD; do
    rm -f "$OLD"
    echo "Ancienne sauvegarde supprimée : $OLD"
  done
  # shellcheck disable=SC2012
  ls -1t backups/bde-secrets-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r OLD; do
    rm -f "$OLD"
    echo "Ancienne sauvegarde des clés supprimée : $OLD"
  done
fi

SIZE="$(du -h "$OUTPUT" | cut -f1)"
echo ""
echo "Sauvegarde terminée :"
echo "  base de données : $OUTPUT ($SIZE)"
if [ -n "$SECRETS_OUTPUT" ]; then
  echo "  clés (secrets)  : $SECRETS_OUTPUT"
  echo ""
  echo "Copiez les DEUX fichiers hors du serveur (scp, rsync, rclone...), à deux endroits différents."
  echo "Sans l'archive des clés, une restauration sur un autre serveur ne peut plus déchiffrer les secrets."
else
  echo ""
  echo "Pensez à la copier hors du serveur (scp, rsync, rclone...)."
fi
