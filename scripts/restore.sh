#!/bin/sh
# Restaure une sauvegarde faite par scripts/backup.sh (la base de données, et les clés si vous les donnez).
#
# Ne demande que Docker (avec « docker compose ») et les outils Unix habituels :
# pas besoin de Node.js sur le serveur. Sous Windows, lancez-le depuis Git Bash ou WSL.
#
# Usage : ./scripts/restore.sh backups/bde-backup-AAAA-MM-JJ_HH-MM-SS.tar.gz [--secrets backups/bde-secrets-....tar.gz] [--yes]
#         ./scripts/restore.sh --auto [bde-auto-AAAA-MM-JJ_HH-MM-SSZ.tar.gz] [--yes]
#         ./scripts/restore.sh bde-auto-....tar.gz.enc                         (fichier téléchargé depuis Paramètres : phrase de passe demandée)
#         ./scripts/restore.sh --pre-update [pre-update_AAAAMMJJTHHMMSSZ_vX.Y.Z.sql.gz] [--yes]
#         ./scripts/restore.sh backups/bde-backup-....tar.gz --no-start        (pour revenir à une version précédente)
#   --auto     restaure une des sauvegardes que la plateforme fait TOUTE SEULE chaque nuit (dossier backups/auto de l'hôte,
#              ou BDE_BACKUP_DIR), la plus récente si vous n'en nommez pas. Elle contient la base ET les clés : rien d'autre à donner,
#              même sur un serveur neuf.
#   fichier .enc  une sauvegarde téléchargée depuis la page Paramètres est chiffrée avec une phrase de passe que le propriétaire a
#              choisie. Elle est demandée ici (ou lue dans la variable BDE_BACKUP_PASSPHRASE). Perdue, elle ne se retrouve pas :
#              le fichier est alors inutilisable (les sauvegardes du dossier du serveur, elles, ne sont pas chiffrées).
#   --pre-update  restaure la copie que la plateforme a faite TOUTE SEULE avant d'appliquer une mise à jour de la
#              base (volume « backups » de Docker ; la plus récente si vous n'en nommez pas). Elle ne contient que la
#              base : les clés du volume « secrets » n'ont pas changé.
#   --secrets  l'archive des clés (volume « secrets ») : INDISPENSABLE sur un autre serveur que l'original,
#              sinon les secrets chiffrés de la base (clé 42, SMTP, webhooks) ne peuvent plus être lus.
#              Sur le serveur d'origine, dont le volume « secrets » est intact, elle n'est pas nécessaire.
#   --yes      ne demande pas de confirmation (pour un script ; à utiliser en connaissance de cause)
#   --no-start laisse l'application ARRÊTÉE à la fin. Pour revenir à une version précédente : le dossier est encore à la
#              version que vous quittez, et son application, relancée aussitôt, appliquerait de nouveau ses migrations à la
#              base que vous venez de remettre, que la version précédente refuserait alors (« la base de données est plus
#              récente »). Restaurez avec --no-start, revenez au code précédent (git checkout), puis docker compose up -d.
#              --pre-update l'implique : une copie d'avant mise à jour ne sert qu'à revenir en arrière.
#
# ATTENTION : cela REMPLACE toutes les données actuelles par celles de la sauvegarde. Une
# sauvegarde de sécurité de l'état actuel est faite juste avant, dans backups/.
set -eu

export MSYS_NO_PATHCONV=1
umask 077

usage() {
  echo "Usage : ./scripts/restore.sh backups/bde-backup-AAAA-MM-JJ_HH-MM-SS.tar.gz [--secrets backups/bde-secrets-....tar.gz] [--no-start] [--yes]"
  echo "        ./scripts/restore.sh --auto [bde-auto-....tar.gz] [--yes]"
  echo "        ./scripts/restore.sh bde-auto-....tar.gz.enc [--yes]     (fichier téléchargé : phrase de passe demandée)"
  echo "        ./scripts/restore.sh --pre-update [pre-update_....sql.gz] [--yes]"
}

FILE=""
SECRETS_FILE=""
ASSUME_YES=0
NO_START=0
PRE_UPDATE=0
PRE_UPDATE_NAME=
AUTO=0
AUTO_NAME=
while [ $# -gt 0 ]; do
  case "$1" in
    --yes)
      ASSUME_YES=1
      shift
      ;;
    --no-start)
      NO_START=1
      shift
      ;;
    --pre-update)
      PRE_UPDATE=1
      shift
      # Un nom de copie peut suivre ; sinon, la plus récente.
      case "${1:-}" in
        pre-update_*.sql.gz)
          PRE_UPDATE_NAME="$1"
          shift
          ;;
      esac
      ;;
    --auto)
      AUTO=1
      shift
      # Un nom de sauvegarde peut suivre ; sinon, la plus récente.
      case "${1:-}" in
        bde-auto-*.tar.gz)
          AUTO_NAME="$1"
          shift
          ;;
      esac
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

# A copy made before an update is for going back to the version before it: the application of this folder, started on it, would
# apply its migrations again at once.
[ "$PRE_UPDATE" -eq 1 ] && NO_START=1

if { [ "$PRE_UPDATE" -eq 1 ] || [ "$AUTO" -eq 1 ]; } && [ -n "$FILE" ]; then
  echo "--pre-update, --auto et un fichier de sauvegarde ne vont pas ensemble : choisissez l'un ou l'autre." >&2
  exit 2
fi
if [ "$PRE_UPDATE" -eq 1 ] && [ "$AUTO" -eq 1 ]; then
  echo "--pre-update et --auto ne vont pas ensemble : choisissez l'un ou l'autre." >&2
  exit 2
fi

if [ "$PRE_UPDATE" -eq 0 ] && [ "$AUTO" -eq 0 ] && [ -z "$FILE" ]; then
  echo "Indiquez la sauvegarde à restaurer." >&2
  usage >&2
  echo "" >&2
  echo "Sauvegardes disponibles :" >&2
  cd "$(dirname "$0")/.."
  # shellcheck disable=SC2012
  ls -1t backups/bde-backup-*.tar.gz 2>/dev/null | head -n 10 >&2 || true
  echo "(Les sauvegardes automatiques : ./scripts/restore.sh --auto)" >&2
  exit 2
fi

# Chemin relatif donné depuis le dossier où l'on se trouve, avant de se placer à la racine du projet.
case "$FILE" in
  "" | /*) ;;
  *) FILE="$(pwd)/$FILE" ;;
esac

case "$SECRETS_FILE" in
  "" | /*) ;;
  *) SECRETS_FILE="$(pwd)/$SECRETS_FILE" ;;
esac

cd "$(dirname "$0")/.."

if [ "$PRE_UPDATE" -eq 0 ] && [ "$AUTO" -eq 0 ] && [ ! -f "$FILE" ]; then
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

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM

if [ "$PRE_UPDATE" -eq 1 ]; then
  # Les copies d'avant mise à jour sont dans le dossier des sauvegardes (backups/auto/pre-update/) ; celles que l'ancien
  # volume « backups » (versions d'avant la pile 4) contient encore, et que la plateforme n'a pas encore reprises, sont lues
  # aussi. On lit avec un conteneur éphémère de l'application (les mêmes montages qu'elle, sans en deviner les noms).
  AVAILABLE="$(docker compose run --rm --no-deps -T --entrypoint ls app -1 /auto-backups/pre-update /legacy-backups 2>/dev/null | grep '^pre-update_.*\.sql\.gz$' | sort -u || true)"
  if [ -z "$AVAILABLE" ]; then
    echo "Aucune copie d'avant mise à jour dans le dossier des sauvegardes (backups/auto/pre-update)." >&2
    echo "(Elles sont faites quand la plateforme applique une mise à jour de la base ; sinon, utilisez une sauvegarde de scripts/backup.sh.)" >&2
    exit 1
  fi
  if [ -z "$PRE_UPDATE_NAME" ]; then
    PRE_UPDATE_NAME="$(printf '%s\n' "$AVAILABLE" | tail -n 1)"
  elif ! printf '%s\n' "$AVAILABLE" | grep -qx "$PRE_UPDATE_NAME"; then
    echo "Copie introuvable : $PRE_UPDATE_NAME. Disponibles :" >&2
    printf '%s\n' "$AVAILABLE" >&2
    exit 1
  fi
  FILE="$PRE_UPDATE_NAME"
  docker compose run --rm --no-deps -T --entrypoint sh app -c 'cat "/auto-backups/pre-update/$1" 2>/dev/null || cat "/legacy-backups/$1"' sh "$PRE_UPDATE_NAME" >"$WORK/pre-update.sql.gz"
  gzip -dc "$WORK/pre-update.sql.gz" >"$WORK/database.sql"
  if ! tail -n 5 "$WORK/database.sql" | grep -q "PostgreSQL database dump complete"; then
    echo "La copie « $PRE_UPDATE_NAME » est incomplète : restauration annulée, rien n'a été modifié." >&2
    exit 1
  fi
else
  ARCHIVE="$FILE"
  if [ "$AUTO" -eq 1 ]; then
    # Les sauvegardes automatiques sont dans le dossier de l'hôte monté sur /auto-backups, lisible par l'application seulement :
    # on les lit avec un conteneur éphémère (le même dossier qu'elle, sans en deviner le chemin, rootless compris).
    AVAILABLE="$(docker compose run --rm --no-deps -T --entrypoint ls app -1 /auto-backups 2>/dev/null | grep '^bde-auto-.*\.tar\.gz$' | sort || true)"
    if [ -z "$AVAILABLE" ]; then
      echo "Aucune sauvegarde automatique dans le dossier des sauvegardes (backups/auto, ou BDE_BACKUP_DIR)." >&2
      echo "(Pour un fichier téléchargé depuis Paramètres, donnez son chemin.)" >&2
      exit 1
    fi
    if [ -z "$AUTO_NAME" ]; then
      AUTO_NAME="$(printf '%s\n' "$AVAILABLE" | tail -n 1)"
    elif ! printf '%s\n' "$AVAILABLE" | grep -qx "$AUTO_NAME"; then
      echo "Sauvegarde introuvable : $AUTO_NAME. Disponibles :" >&2
      printf '%s\n' "$AVAILABLE" >&2
      exit 1
    fi
    FILE="$AUTO_NAME"
    ARCHIVE="$WORK/archive.tar.gz"
    docker compose run --rm --no-deps -T --entrypoint cat app "/auto-backups/$AUTO_NAME" >"$ARCHIVE"
  fi
  case "$FILE" in
    *.enc)
      # Chiffrée par la page Paramètres : OpenSSL standard (AES-256-CBC, PBKDF2-SHA256, 600 000 itérations), déchiffrée dans
      # l'image de l'application, qui a openssl : le serveur n'a besoin que de Docker.
      if [ -z "${BDE_BACKUP_PASSPHRASE:-}" ]; then
        if [ ! -t 0 ]; then
          echo "Ce fichier est chiffré : donnez la phrase de passe dans BDE_BACKUP_PASSPHRASE, ou relancez dans un terminal." >&2
          exit 1
        fi
        printf "Phrase de passe du fichier (rien ne s'affiche pendant la saisie) : "
        stty -echo 2>/dev/null || true
        read -r BDE_BACKUP_PASSPHRASE || true
        stty echo 2>/dev/null || true
        echo ""
      fi
      export BDE_BACKUP_PASSPHRASE
      if ! docker compose run --rm --no-deps -T -e BDE_BACKUP_PASSPHRASE --entrypoint sh app -c 'openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -pass env:BDE_BACKUP_PASSPHRASE' <"$ARCHIVE" >"$WORK/decrypted.tar.gz" 2>"$WORK/decrypt.log"; then
        echo "Le fichier n'a pas pu être déchiffré : phrase de passe incorrecte, ou fichier abîmé. Rien n'a été modifié." >&2
        exit 1
      fi
      unset BDE_BACKUP_PASSPHRASE
      ARCHIVE="$WORK/decrypted.tar.gz"
      ;;
  esac
  if ! tar -tzf "$ARCHIVE" 2>/dev/null | grep -qx "database.sql"; then
    echo "« $FILE » n'est pas une sauvegarde de BDE_Network (database.sql absent) :" >&2
    echo "elle doit avoir été créée par scripts/backup.sh ou par la plateforme (sauvegardes automatiques)." >&2
    echo "(Un fichier .enc demande la bonne phrase de passe : une mauvaise donne parfois un contenu illisible.)" >&2
    exit 1
  fi
fi

echo ""
echo "Vous allez RESTAURER : $FILE"
echo ""
echo "  • La base de données actuelle sera REMPLACÉE par celle de la sauvegarde."
echo "  • Tout ce qui a été fait depuis cette sauvegarde sera perdu (sauf dans la copie de sécurité)."
if [ "$NO_START" -eq 1 ]; then
  echo "  • L'application sera arrêtée, et LAISSÉE ARRÊTÉE (retour à une version précédente : voir la fin)."
else
  echo "  • L'application sera arrêtée pendant l'opération, puis relancée."
fi
echo "  • Une copie de sécurité de l'état actuel est faite juste avant, dans backups/."
if [ -n "$SECRETS_FILE" ]; then
  echo "  • Les clés du volume « secrets » (session, chiffrement des secrets) seront REMPLACÉES par celles de :"
  echo "    $SECRETS_FILE"
elif [ "$PRE_UPDATE" -eq 0 ] && tar -tzf "$ARCHIVE" 2>/dev/null | grep -qx "secrets.tar"; then
  echo "  • Les clés du volume « secrets » (session, chiffrement des secrets) seront REMPLACÉES par celles de la sauvegarde."
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

echo ""
echo "1/5 Copie de sécurité de l'état actuel..."
docker compose up -d --wait postgres >/dev/null
if ! BACKUP_LABEL="-avant-restauration" ./scripts/backup.sh; then
  echo "La copie de sécurité a échoué : restauration annulée, rien n'a été modifié." >&2
  exit 1
fi

if [ "$PRE_UPDATE" -eq 0 ]; then
  tar -xzf "$ARCHIVE" -C "$WORK"
fi

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
elif [ -f "$WORK/secrets.tar" ]; then
  # Une sauvegarde automatique porte ses clés : une seule archive suffit, même sur un serveur sans rien.
  echo "3/5 Restauration des clés de la sauvegarde (volume « secrets »)..."
  if ! docker compose run --rm --no-deps -T --entrypoint tar app -xf - -C /secrets <"$WORK/secrets.tar" >"$WORK/secrets.log" 2>&1; then
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
# La base est REMPLACÉE, pas complétée : la sauvegarde ne supprime que ce qu'elle contient, et une table ajoutée
# par une version plus récente (on restaure une sauvegarde faite avant une mise à jour) resterait, puis ferait
# échouer la migration suivante (« relation already exists »). On repart donc d'un schéma vide.
if ! { printf 'DROP SCHEMA public CASCADE;\nCREATE SCHEMA public;\n'; cat "$WORK/database.sql"; } | docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 --single-transaction -q -o /dev/null'; then
  echo "" >&2
  echo "La restauration de la base a échoué : la base n'a PAS été modifiée." >&2
  echo "Relance de l'application..." >&2
  docker compose up -d app >/dev/null 2>&1 || true
  exit 1
fi

# Les sauvegardes faites avant le retrait de l'ancien stockage de fichiers contiennent aussi un
# uploads.tar. Il est ignoré : le logo, lui, est dans logo.tar (voir backup.sh).
if [ -f "$WORK/uploads.tar" ]; then
  echo "    (Cette sauvegarde contient un ancien dossier de fichiers envoyés, que l'application n'utilise plus : ignoré.)"
fi

# Le logo envoyé depuis la page Paramètres : remplacé par celui de la sauvegarde. Un échec n'arrête pas la
# restauration (la base est déjà restaurée) : le logo se renvoie depuis Paramètres.
if [ -f "$WORK/logo.tar" ]; then
  echo "    Restauration du logo (volume « uploads »)..."
  if ! docker compose run --rm --no-deps -T --entrypoint sh app -c 'rm -f /uploads/logo-* && tar -xf - -C /uploads' <"$WORK/logo.tar" >"$WORK/logo.log" 2>&1; then
    cat "$WORK/logo.log" >&2
    echo "    Le logo n'a pas pu être restauré : renvoyez-le depuis la page Paramètres." >&2
  fi
fi

if [ "$NO_START" -eq 1 ]; then
  echo "5/5 Application laissée arrêtée."
  echo ""
  echo "Restauration terminée. Pour revenir à la version précédente : git checkout <la version notée>, puis docker compose up -d."
  echo "(Relancée ici, l'application de ce dossier appliquerait de nouveau ses migrations à la base que vous venez de remettre.)"
else
  echo "5/5 Relance de l'application..."
  docker compose up -d app >/dev/null

  echo ""
  echo "Restauration terminée. L'application redémarre (les migrations éventuelles s'appliquent toutes seules)."
  echo "Vérifiez avec : docker compose logs --tail 20 app"
fi
if [ -z "$SECRETS_FILE" ] && [ ! -f "$WORK/secrets.tar" ]; then
  echo ""
  echo "Rappel : sur un AUTRE serveur que celui d'origine, relancez avec --secrets <archive des clés>."
  echo "Sans elle, les secrets chiffrés de la base (clé 42, SMTP, webhooks) ne seront pas lisibles : l'application"
  echo "le dit dans ses journaux, et ils se ressaisissent."
fi
