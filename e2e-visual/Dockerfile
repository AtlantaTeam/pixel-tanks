# Образ для съёмки и сверки эталонных кадров боевой сцены (issue #585).
#
# Зачем образ вообще: растеризация шрифтов и канваса зависит от версии Chromium,
# freetype и fontconfig — то есть от машины. Эталон без допуска в пикселях имеет
# смысл только тогда, когда среда съёмки одна и та же и у человека, и у гейта.
# Поэтому кадры снимаются здесь, а не на хосте.
#
# База — `node:24`, та же мажорная версия Node, что у остального e2e (`engines`
# в package.json). В образ вшит браузер, поэтому прогон эталонов НЕ ходит в сеть:
# сеть нужна ровно один раз, при сборке образа.
#
# Собирается и запускается через `npm run test:visual` (scripts/visual-baseline.mjs),
# руками собирать не требуется.
FROM node:24-bookworm

# Версию playwright передаёт сборщик из package.json — браузер обязан совпадать с
# тем @playwright/test, которым гоняются тесты, иначе прогон падает на «Executable
# doesn't exist». Пин версии здесь же делает образ воспроизводимым.
ARG PLAYWRIGHT_VERSION

# Браузер кладём в общий `/ms-playwright`, а не в `/root/.cache` по умолчанию:
# контейнер запускается от uid хостового пользователя (`--user` в
# `scripts/visual-baseline.mjs`), чтобы `.next`, `test-results` и пересnятые
# эталоны не оставались в рабочем дереве root-owned. Непривилегированному uid
# `/root/.cache` не виден — «Executable doesn't exist» посреди прогона, поэтому
# эти две правки живут только парой (ревью #585).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN test -n "$PLAYWRIGHT_VERSION" \
    && npx --yes "playwright@${PLAYWRIGHT_VERSION}" install --with-deps chromium \
    && chmod -R a+rX /ms-playwright \
    && rm -rf /root/.npm

# Репозиторий монтируется сюда при запуске (`docker run -v`), в образ не копируется:
# кадры и эталоны должны оказаться в рабочем дереве, а не внутри контейнера.
WORKDIR /app

ENV CI=1
