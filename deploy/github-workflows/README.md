# Файлы рабочих процессов GitHub Actions: что перенести в `.github/workflows/`

Токен ассистента не имеет права `workflow`, поэтому новые и изменённые файлы рабочих процессов лежат здесь.
Владелец репозитория переносит их в `.github/workflows/` (через веб-интерфейс GitHub: Add file → Create new file, путь `.github/workflows/<имя>`,
затем удаляет эту папку отдельным коммитом).

| Файл здесь | Куда | Что делает | Статус |
|---|---|---|---|
| `ci.yml` | `.github/workflows/ci.yml` | На каждый PR и на `main`: `npm ci`, проверка раскладки панелей, сборка, проверка отсутствия внешних скриптов, архив `calc-dist` | **новый** |
| `release.yml` | `.github/workflows/release.yml` | По метке `vX.Y.Z` на `main`: проверки, сборка, архив `calc-vX.Y.Z.zip` и `.sha256` в GitHub Release | **новый** |
| `deploy.yml` | `.github/workflows/deploy.yml` (заменить существующий) | Стенд GitHub Pages. Отличия от текущего: `npm ci` вместо `npm install` (теперь есть `package-lock.json`), перед сборкой запускается `npm test`, кэш npm | **изменён** |

Стенд продолжает работать и без переноса `deploy.yml`: текущая версия (`npm install`) совместима с добавленным `package-lock.json`.

## Перед первым выпуском

1. Перенести три файла.
2. Settings → Actions → General → Workflow permissions: достаточно «Read repository contents»; `release.yml` сам запрашивает `contents: write`
   только для публикации выпуска (если запрещено на уровне организации/репозитория — разрешите «Read and write permissions»).
3. Проверить защиту: метки `v*` и ветка `main` (Settings → Rules).
4. Поставить метку: `git tag -a v1.0.0 -m "…" && git push origin v1.0.0`. Дождаться зелёного запуска «Выпуск» и появления архива на странице Releases.
