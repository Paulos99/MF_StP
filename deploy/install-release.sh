#!/usr/bin/env bash
# Установка проверенного выпуска калькулятора на сервер одной командой:
#
#   SITE_ROOT=/var/www/stp-multiframe.ru ./install-release.sh v1.0.0 [контрольная_сумма_sha256]
#
# Скрипту не нужны ни Node.js, ни доступ к коду: он скачивает готовый архив выпуска из GitHub Releases
# репозитория владельца, проверяет контрольную сумму, распаковывает в отдельную папку выпуска и
# одним атомарным действием переключает ссылку calc на неё. Предыдущие выпуски остаются на диске (откат: rollback.sh).
#
# Переменные (все необязательные, кроме SITE_ROOT):
#   SITE_ROOT   каталог сайта, в котором лежит calc (корень nginx для stp-multiframe.ru). Обязательна.
#   KEEP        сколько выпусков хранить на диске (по умолчанию 5)
#   SMOKE_URL   адрес для проверки после переключения, например https://stp-multiframe.ru/calc/
#               (проверяется, что <адрес>version.txt отвечает номером выпуска; при ошибке — автооткат)
#   BASE_URL    откуда скачивать (по умолчанию GitHub Releases владельца; нужен только для проверок)
set -euo pipefail

REPO="Paulos99/MF_StP"
SITE="calc"
TAG="${1:-}"
EXPECTED_SHA="${2:-}"
KEEP="${KEEP:-5}"

if [[ -z "$TAG" ]]; then
  echo "Использование: SITE_ROOT=/путь/к/сайту $0 vX.Y.Z [sha256]" >&2
  exit 2
fi
if [[ ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Имя выпуска должно быть вида v1.2.3, получено: $TAG" >&2
  exit 2
fi
: "${SITE_ROOT:?Задайте SITE_ROOT — каталог сайта (корень nginx), например /var/www/stp-multiframe.ru}"
if [[ ! -d "$SITE_ROOT" ]]; then
  echo "Каталог $SITE_ROOT не найден." >&2
  exit 1
fi

BASE_URL="${BASE_URL:-https://github.com/$REPO/releases/download/$TAG}"
ASSET="calc-$TAG.zip"
REL_DIR="$SITE_ROOT/.releases/$SITE"
LINK="$SITE_ROOT/$SITE"
mkdir -p "$REL_DIR"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> Скачиваем $ASSET"
curl -fsSL --retry 3 -o "$TMP/$ASSET" "$BASE_URL/$ASSET"
curl -fsSL --retry 3 -o "$TMP/$ASSET.sha256" "$BASE_URL/$ASSET.sha256"

ACTUAL="$(sha256sum "$TMP/$ASSET" | cut -d' ' -f1)"
PUBLISHED="$(cut -d' ' -f1 < "$TMP/$ASSET.sha256" | tr -d '[:space:]')"
if [[ "$ACTUAL" != "$PUBLISHED" ]]; then
  echo "!! Контрольная сумма архива не совпала с опубликованной. Установка отменена." >&2
  exit 1
fi
if [[ -n "$EXPECTED_SHA" && "$ACTUAL" != "$EXPECTED_SHA" ]]; then
  echo "!! Контрольная сумма архива не совпала с суммой из сообщения владельца. Установка отменена." >&2
  exit 1
fi
echo "    sha256: $ACTUAL"

STAGE="$REL_DIR/$TAG"
if [[ -e "$STAGE" && "${FORCE:-0}" != "1" ]]; then
  echo "Выпуск $TAG уже распакован ($STAGE). Для повторной установки: FORCE=1"
  if [[ "$(readlink "$LINK" 2>/dev/null || true)" == "$STAGE" ]]; then exit 0; fi
else
  rm -rf "$STAGE.tmp" "$STAGE"
  mkdir -p "$STAGE.tmp"
  unzip -q "$TMP/$ASSET" -d "$STAGE.tmp"
  if [[ ! -f "$STAGE.tmp/index.html" ]]; then
    echo "!! В архиве нет index.html. Установка отменена." >&2
    rm -rf "$STAGE.tmp"
    exit 1
  fi
  if [[ "$(tr -d '[:space:]' < "$STAGE.tmp/version.txt" 2>/dev/null || true)" != "$TAG" ]]; then
    echo "!! Номер выпуска внутри архива не совпал с $TAG. Установка отменена." >&2
    rm -rf "$STAGE.tmp"
    exit 1
  fi
  chmod -R a+rX "$STAGE.tmp"
  mv "$STAGE.tmp" "$STAGE"
fi

# Первая установка: если на месте calc лежит обычная папка, сохраняем её как «до установки».
if [[ -e "$LINK" && ! -L "$LINK" ]]; then
  echo "==> Сохраняем существующую папку как $REL_DIR/_before-first-install"
  rm -rf "$REL_DIR/_before-first-install"
  mv "$LINK" "$REL_DIR/_before-first-install"
fi

PREVIOUS_TARGET="$(readlink "$LINK" 2>/dev/null || true)"
PREVIOUS=""
[[ -n "$PREVIOUS_TARGET" ]] && PREVIOUS="$(basename "$PREVIOUS_TARGET")"
[[ -z "$PREVIOUS" && -d "$REL_DIR/_before-first-install" ]] && PREVIOUS="_before-first-install"

echo "==> Переключаем $LINK -> $STAGE"
ln -sfn "$STAGE" "$LINK.new"
mv -T "$LINK.new" "$LINK"

if [[ -n "${SMOKE_URL:-}" ]]; then
  served="$(curl -fsS --retry 3 --retry-delay 2 "${SMOKE_URL%/}/version.txt" 2>/dev/null | tr -d '[:space:]' || true)"
  if [[ "$served" != "$TAG" ]]; then
    echo "!! Проверка по адресу ${SMOKE_URL%/}/version.txt не прошла (получено: '${served:-нет ответа}')." >&2
    if [[ -n "$PREVIOUS" && "$PREVIOUS" != "$TAG" && -d "$REL_DIR/$PREVIOUS" ]]; then
      echo "!! Возвращаем $PREVIOUS" >&2
      ln -sfn "$REL_DIR/$PREVIOUS" "$LINK.new"
      mv -T "$LINK.new" "$LINK"
    fi
    exit 1
  fi
  echo "    проверка пройдена: ${SMOKE_URL%/}/version.txt = $served"
fi

if [[ -n "$PREVIOUS" && "$PREVIOUS" != "$TAG" ]]; then
  echo "$PREVIOUS" > "$REL_DIR/previous"
fi
echo "$TAG" > "$REL_DIR/current"

# Удаляем самые старые выпуски, оставляя KEEP последних и тот, что сейчас включён.
mapfile -t OLD < <(cd "$REL_DIR" && ls -1dt v*/ 2>/dev/null | sed 's#/$##' | tail -n +"$((KEEP + 1))")
for d in "${OLD[@]:-}"; do
  [[ -z "$d" || "$d" == "$TAG" || "$d" == "$PREVIOUS" ]] && continue
  rm -rf "${REL_DIR:?}/$d"
done

echo "==> Готово: включён $TAG (предыдущий: ${PREVIOUS:-нет}). Откат: SITE_ROOT=$SITE_ROOT $(dirname "$0")/rollback.sh"
