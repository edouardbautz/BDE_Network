#!/bin/sh
# Restaure une sauvegarde faite par scripts/backup.sh (la base de données, et les clés si vous les donnez).
#
# Ne demande que Docker (avec « docker compose ») et les outils Unix habituels :
# pas besoin de Node.js sur le serveur. Sous Windows, lancez-le depuis Git Bash ou WSL.
#
# Usage : ./scripts/restore.sh backups/bde-backup-AAAA-MM-JJ_HH-MM-SS.tar.gz [--secrets backups/bde-secrets-....tar.gz] [--yes]
#   --secrets  l'archive des clés (volume « secrets ») : INDISPENSABLE sur un autre serveur que l'original,
#              sinon les secrets chiffrés de la base (clé 42, SMTP, webhooks) ne peuvent plus être lus.
#              Sur le serveur d'origine, dont le volume « secrets » est intact, elle n'est pas nécessaire.
#   --yes      ne demande pas de confirmation (pour un script ; à utiliser en connaissance de cause)
#
# ATTENTION : cela REMPLACE toutes les données actuelles par celles de la sauvegarde. Une
# sauvegarde de sécurité de l'état actuel est faite juste avant, dans backups/.
set -eu

export MSYS_NO_PATHCONV=1
umask 077

usage() {
  echo "Usage : ./scripts/restore.sh backups/bde-backup-AAAA-MM-JJ_HH-MM-SS.tar.gz [--secrets backups/bde-secrets-....tar.gz] [--yes]"
}

FILE=""
SECRETS_FILE=""
ASSUME_YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --yes)
      ASSUME_YES=1
      shift
      ;;
    --secrets)
      if [ $# -lt 2 ]; then
        echo "--secrets demande le fichier des clés (bde-secrets-....tar.gz)." >&2
        exit 2
      fi
      SECRETS_FILE="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*)
      echo "Option inconnue : $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [ -n "$FILE" ]; then
        echo "Un seul fichier de sauvegarde à la fois." >&2
        usage >&2
        exit 2
      fi
      FILE="$1"
      shift
      ;;
  esac
done

if [ -z "$FILE" ]; then
  echo "Indiquez la sauvegarde à restaurer." >&2
  usage >&2
  echo "" >&2
  echo "Sauvegardes disponibles :" >&2
  cd "$(dirname "$0")/.."
  # shellcheck disable=SC2012
  ls -1t backups/bde-backup-*.tar.gz 2>/dev/null | head -n 10 >&2 || true
  exit 2
fi

# Chemin relatif donné depuis le dossier où l'on se trouve, avant de se placer à la racine du projet.
case "$FILE" in
  /*) ;;
  *) FILE="$(pwd)/$FILE" ;;
esac

case "$SECRETS_FILE" in
  "" | /*) ;;
  *) SECRETS_FILE="$(pwd)/$SECRETS_FILE" ;;
esac

cd "$(dirname "$0")/.."

if [ ! -f "$FILE" ]; then
  echo "Fichier introuvable : $FILE" >&2
  exit 1
fi

if [ -n "$SECRETS_FILE" ]; then
  if [ ! -f "$SECRETS_FILE" ]; then
    echo "Fichier des clés introuvable : $SECRETS_FILE" >&2
    exit 1
  fi
  if ! tar -tzf "$SECRETS_FILE" 2>/dev/null | grep -qx "settings_key"; then
    echo "« $SECRETS_FILE » n'est pas une archive de clés de BDE_Network (settings_key absent) :" >&2
    echo "elle doit avoir été créée par scripts/backup.sh (bde-secrets-....tar.gz)." >&2
    exit 1
  fi
fi

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker (avec la commande « docker compose ») est introuvable : installez-le d'abord." >&2
  exit 1
fi

if ! tar -tzf "$FILE" 2>/dev/null | grep -qx "database.sql"; then
  echo "« $FILE » n'est pas une sauvegarde de BDE_Network (database.sql absent) :" >&2
  echo "elle doit avoir été créée par scripts/backup.sh." >&2
  exit 1
fi

echo ""
echo "Vous allez RESTAURER : $FILE"
echo ""
echo "  • La base de données actuelle sera REMPLACÉE par celle de la sauvegarde."
echo "  • Tout ce qui a été fait depuis cette sauvegarde sera perdu (sauf dans la copie de sécurité)."
echo "  • L'application sera arrêtée pendant l'opération, puis relancée."
echo "  • Une copie de sécurité de l'état actuel est faite juste avant, dans backups/."
if [ -n "$SECRETS_FILE" ]; then
  echo "  • Les clés du volume « secrets » (session, chiffrement des secrets) seront REMPLACÉES par celles de :"
  echo "    $SECRETS_FILE"
fi
echo ""

if [ "$ASSUME_YES" -ne 1 ]; then
  if [ ! -t 0 ]; then
    echo "Confirmation impossible hors d'un terminal : relancez dans un terminal, ou ajoutez --yes." >&2
    exit 1
  fi
  printf "Pour confirmer, tapez RESTAURER puis Entrée (tout autre texte annule) : "
  read -r ANSWER
  if [ "$ANSWER" != "RESTAURER" ]; then
    echo "Annulé : rien n'a été modifié."
    exit 1
  fi
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM

echo ""
echo "1/5 Copie de sécurité de l'état actuel..."
docker compose up -d --wait postgres >/dev/null
if ! BACKUP_LABEL="-avant-restauration" ./scripts/backup.sh; then
  echo "La copie de sécurité a échoué : restauration annulée, rien n'a été modifié." >&2
  exit 1
fi

tar -xzf "$FILE" -C "$WORK"

echo ""
echo "2/5 Arrêt de l'application..."
docker compose stop app >/dev/null 2>&1 || true

if [ -n "$SECRETS_FILE" ]; then
  echo "3/5 Restauration des clés (volume « secrets »)..."
  if ! gzip -dc "$SECRETS_FILE" | docker compose run --rm --no-deps -T --entrypoint tar app -xf - -C /secrets >"$WORK/secrets.log" 2>&1; then
    cat "$WORK/secrets.log" >&2
    echo "" >&2
    echo "Les clés n'ont pas pu être restaurées : rien n'a été modifié. Relance de l'application..." >&2
    docker compose up -d app >/dev/null 2>&1 || true
    exit 1
  fi
else
  echo "3/5 Clés (volume « secrets ») : conservées telles quelles (aucune archive de clés donnée)."
fi

echo "4/5 Restauration de la base de données..."
# Une seule transaction : si quelque chose échoue, la base reste exactement comme avant.
if ! docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 --single-transaction -q -o /dev/null' <"$WORK/database.sql"; then
  echo "" >&2
  echo "La restauration de la base a échoué : la base n'a PAS été modifiée." >&2
  echo "Relance de l'application..." >&2
  docker compose up -d app >/dev/null 2>&1 || true
  exit 1
fi

# Les sauvegardes faites avant le retrait du stockage de fichiers contiennent aussi un
# uploads.tar. Rien dans l'application n'écrit ni ne lit de fichiers envoyés : il est ignoré.
if [ -f "$WORK/uploads.tar" ]; then
  echo "    (Cette sauvegarde contient un dossier de fichiers envoyés, que l'application n'utilise plus : ignoré.)"
fi

echo "5/5 Relance de l'application..."
docker compose up -d app >/dev/null

echo ""
echo "Restauration terminée. L'application redémarre (les migrations éventuelles s'appliquent toutes seules)."
echo "Vérifiez avec : docker compose logs --tail 20 app"
if [ -z "$SECRETS_FILE" ]; then
  echo ""
  echo "Rappel : sur un AUTRE serveur que celui d'origine, relancez avec --secrets <archive des clés>."
  echo "Sans elle, les secrets chiffrés de la base (clé 42, SMTP, webhooks) ne seront pas lisibles : l'application"
  echo "le dit dans ses journaux, et ils se ressaisissent."
fi
