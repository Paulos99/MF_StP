#!/usr/bin/env bash
# Откат калькулятора на предыдущий установленный выпуск (или на указанный, если он ещё на диске):
#
#   SITE_ROOT=/var/www/stp-multiframe.ru ./rollback.sh [vX.Y.Z]
set -euo pipefail
SITE="calc"
: "${SITE_ROOT:?Задайте SITE_ROOT — каталог сайта (корень nginx)}"
REL_DIR="$SITE_ROOT/.releases/$SITE"
LINK="$SITE_ROOT/$SITE"
TARGET="${1:-$(cat "$REL_DIR/previous" 2>/dev/null || true)}"
if [[ -z "$TARGET" ]]; then
  echo "Предыдущий выпуск неизвестен. Укажите номер: $0 vX.Y.Z" >&2
  echo "Доступно на диске: $(cd "$REL_DIR" 2>/dev/null && ls -1 | tr '\n' ' ')" >&2
  exit 1
fi
if [[ ! -d "$REL_DIR/$TARGET" ]]; then
  echo "Выпуска $TARGET нет на диске ($REL_DIR). Установите его заново: install-release.sh $TARGET" >&2
  exit 1
fi
CURRENT="$(cat "$REL_DIR/current" 2>/dev/null || true)"
ln -sfn "$REL_DIR/$TARGET" "$LINK.new"
mv -T "$LINK.new" "$LINK"
[[ -n "$CURRENT" && "$CURRENT" != "$TARGET" ]] && echo "$CURRENT" > "$REL_DIR/previous"
echo "$TARGET" > "$REL_DIR/current"
echo "==> Откат выполнен: включён $TARGET (был: ${CURRENT:-неизвестно})"
if [[ -n "${SMOKE_URL:-}" ]]; then
  echo "    версия по адресу: $(curl -fsS "${SMOKE_URL%/}/version.txt" 2>/dev/null | tr -d '[:space:]' || echo нет ответа)"
fi
