# Установка, обновление и откат на сервере

Целевой адрес: **https://stp-multiframe.ru/calc/**. Нужен веб-сервер с HTTPS и возможностью отдавать файлы из каталога.
Пример для nginx — [../../deploy/nginx/calc.conf](../../deploy/nginx/calc.conf).

## Как устроена выкладка

```
/var/www/stp-multiframe.ru/                 ← SITE_ROOT (корень сайта)
├── calc  →  .releases/calc/v1.0.1                  ← ссылка на включённый выпуск (её и видит nginx)
└── .releases/calc/
    ├── v1.0.0/   предыдущий выпуск (для отката)
    ├── v1.0.1/   текущий выпуск
    ├── current, previous                           ← служебные файлы с номерами
    └── _before-first-install/                      ← то, что лежало по этому адресу до первой установки
```

Включение и откат — это перекладывание ссылки: сайт не бывает «наполовину обновлённым».

## Первая установка

1. На сервере нужны `bash`, `curl`, `unzip`, `sha256sum` (обычно уже есть). Node.js **не нужен**.
2. Получите скрипты (они в репозитории, код сайта на сервер не попадает):
   ```bash
   curl -fsSLO https://raw.githubusercontent.com/Paulos99/MF_StP/v1.0.0/deploy/install-release.sh
   curl -fsSLO https://raw.githubusercontent.com/Paulos99/MF_StP/v1.0.0/deploy/rollback.sh
   chmod +x install-release.sh rollback.sh
   ```
   (в адресе — номер выпуска; скрипты берутся из той же метки).
3. Подключите настройки nginx из `deploy/nginx/calc.conf` и `deploy/nginx/security-headers.conf`
   (последний сохраните как `/etc/nginx/snippets/calc-security-headers.conf`). Проверьте `nginx -t`, затем `nginx -s reload`.
4. Установите выпуск:
   ```bash
   SITE_ROOT=/var/www/stp-multiframe.ru \
   SMOKE_URL=https://stp-multiframe.ru/calc/ \
   ./install-release.sh v1.0.0 <контрольная_сумма_из_сообщения_владельца>
   ```
   Скрипт: скачивает `calc-v1.0.0.zip`, сверяет sha256, распаковывает в `.releases/calc/v1.0.0`,
   переключает ссылку и проверяет `https://stp-multiframe.ru/calc/version.txt`. Если проверка не прошла, возвращает предыдущий выпуск.
5. Пройдите [проверку после выкладки](#проверка-после-выкладки) и [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md).

## Обновление

Владелец сообщает: «Выпуск v1.0.1, сумма `…`». Выполните ту же команду с новым номером:

```bash
SITE_ROOT=/var/www/stp-multiframe.ru SMOKE_URL=https://stp-multiframe.ru/calc/ ./install-release.sh v1.0.1 <сумма>
```

Перезагрузка nginx не нужна. Пользователи получают новую версию при следующей загрузке страницы (файлы проверяются на сервере при каждом заходе).
Хранится 5 последних выпусков (`KEEP=10` — другое число).

## Откат

```bash
SITE_ROOT=/var/www/stp-multiframe.ru ./rollback.sh           # на предыдущий выпуск
SITE_ROOT=/var/www/stp-multiframe.ru ./rollback.sh v1.0.0    # на конкретный, если он ещё на диске
```

Откат занимает секунды. Если нужного выпуска нет на диске, установите его заново тем же `install-release.sh`.
Сообщите владельцу, что откатили и почему.

## Установка вручную (без скрипта)

1. Скачайте `calc-vX.Y.Z.zip` и `.sha256` со страницы [Releases](https://github.com/Paulos99/MF_StP/releases).
2. `sha256sum -c calc-vX.Y.Z.zip.sha256`
3. Распакуйте **содержимое** архива в новую папку, например `/var/www/stp-multiframe.ru/.releases/calc/vX.Y.Z`.
4. Переключите ссылку: `ln -sfn <папка выпуска> /var/www/stp-multiframe.ru/calc.new && mv -T /var/www/stp-multiframe.ru/calc.new /var/www/stp-multiframe.ru/calc`.
5. Для отката верните ссылку на прежнюю папку тем же способом.

Если на сервере не nginx (Apache, хостинг с панелью): нужны те же правила — «`/calc` перенаправляется на `/calc/`» и
«`index.html`, `assets/*` и `version.txt` проверяются заново при каждом заходе (не кэшировать надолго)». Запасной `index.html` для неизвестных адресов не нужен.

## Проверка после выкладки

1. https://stp-multiframe.ru/calc/ в режиме инкогнито: страница, логотипы открываются; адрес без слеша (`/calc`) перенаправляет на `/calc/`.
2. https://stp-multiframe.ru/calc/version.txt отвечает номером выпуска (`v1.0.0`).
3. Расчёт: «Ввести размеры» → 5 × 4 м, высота 2,7 → «Рассчитать»: показывается схема укладки и итоговые количества.
4. «Скачать PDF»: файл скачивается (6 страниц A4 для комнаты 5 × 4 м), схемы читаются.
5. «Поделиться»: ссылка копируется; открытая в новой вкладке, восстанавливает тот же расчёт.
6. Открыть на телефоне: интерфейс помещается в экран, схему можно двигать пальцем.
7. Проблемомер ведёт на калькулятор: кнопка и QR-код в его PDF открывают https://stp-multiframe.ru/calc/.
8. Консоль браузера без ошибок красного цвета (Ctrl+Shift+J).
