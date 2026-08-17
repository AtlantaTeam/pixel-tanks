import { defineConfig } from '@playwright/test';

/**
 * Визуальная регрессия боевой сцены (issue #585) — ОТДЕЛЬНЫЙ конфиг, не проект
 * внутри `playwright.config.ts`.
 *
 * Причина разделения одна и жёсткая: эталонные кадры среда-зависимы. Растеризация
 * шрифтов и канваса зависит от версии Chromium, freetype и fontconfig, поэтому
 * кадры снимаются ТОЛЬКО в образе `node:24` (`e2e-visual/Dockerfile`,
 * `npm run test:visual`), а обычный e2e-прогон гейта идёт на хосте. Смешай их в
 * одном конфиге — и `npm run test:e2e` на хосте краснел бы на чужих эталонах,
 * то есть барьер отключили бы первым же «почини гейт».
 *
 * Локальный VPN/прокси перехватывает пробу webServer к localhost (см. комментарий
 * в `playwright.config.ts`) — исключаем localhost из проксирования тем же приёмом.
 */
process.env.NO_PROXY = [process.env.NO_PROXY, 'localhost,127.0.0.1'].filter(Boolean).join(',');
process.env.no_proxy = process.env.NO_PROXY;

// Свой порт, не 3050/3051: визуальный прогон не должен спорить за порт ни с `npm
// run dev` разработчика, ни с e2e прод-гейта, если те идут рядом.
const VISUAL_PORT = Number(process.env.VISUAL_PORT ?? 3053);
const VISUAL_URL = `http://localhost:${VISUAL_PORT}`;

export default defineConfig({
    testDir: './e2e-visual',
    // Кадры снимаются последовательно и без ретраев: параллельные воркеры делят
    // CPU, а сцена ждёт декодирования арта — эталон должен сниматься в одинаковых
    // условиях. Ретрай же прятал бы недетерминизм вместо того, чтобы показать его.
    fullyParallel: false,
    workers: 1,
    retries: 0,
    forbidOnly: !!process.env.CI,
    reporter: [['list']],
    // Эталоны лежат плоско, без суффиксов проекта и платформы: платформа тут ровно
    // одна — образ `node:24`, и суффикс `-linux` в имени врал бы, будто кадр можно
    // снять на любом linux.
    snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
    expect: {
        toHaveScreenshot: {
            // Допуска нет вовсе (критерий готовности #585): любой изменившийся
            // пиксель — красный тест. Порог «пара пикселей» здесь бесполезен —
            // ровно на нём и проехал регресс тени #571 (полоса 594×2 px).
            maxDiffPixels: 0,
            maxDiffPixelRatio: 0,
            threshold: 0,
            animations: 'disabled',
            caret: 'hide',
            scale: 'css',
        },
    },
    use: {
        baseURL: VISUAL_URL,
        // Фиксируем всё, что влияет на растр: размер кадра, DPR и отключённое
        // движение (CSS-анимации HUD иначе попадают в кадр в случайной фазе).
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
        colorScheme: 'dark',
        timezoneId: 'UTC',
        // `reducedMotion` в этой версии не типизирован в опциях теста — только в
        // опциях контекста (та же грабля, что в `design-system-showcase.spec.ts`).
        contextOptions: { reducedMotion: 'reduce' },
        locale: 'ru-RU',
        trace: 'off',
    },
    // Только прод-сборка: e2e гейта тоже сертифицирует `next start`, а dev-бандл
    // отличается и разметкой, и таймингом компиляции первого захода.
    webServer: {
        command: `npm run start -- --port ${VISUAL_PORT}`,
        url: VISUAL_URL,
        reuseExistingServer: false,
        timeout: 120_000,
    },
    // Без пресета `devices[...]`: его `use` перекрывает верхний уровень и вернул бы
    // свой вьюпорт (1280×720) вместо зафиксированного здесь.
    projects: [
        {
            name: 'chromium',
            use: { browserName: 'chromium' },
        },
    ],
});
