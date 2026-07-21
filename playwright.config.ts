import { defineConfig, devices } from '@playwright/test';

// Локальный VPN/прокси (HTTP_PROXY=127.0.0.1:...) перехватывает пробу webServer
// к localhost и отдаёт 502 — исключаем localhost из проксирования.
process.env.NO_PROXY = [process.env.NO_PROXY, 'localhost,127.0.0.1'].filter(Boolean).join(',');
process.env.no_proxy = process.env.NO_PROXY;

// Порт e2e (#81). В CI (прод-гейт ralph) — выделенный 3051, а не 3050: reuseExistingServer
// там false, и если на раннере уже слушает свой `npm run dev` на 3050 (типично при
// разработке в соседнем tmux-окне), Playwright упал бы с «port is already used» — красный
// e2e, который чини-сессия починить кодом не может (причина вне репозитория). Вне CI —
// 3050, тот же порт, что у `npm run dev`, с переиспользованием живого сервера.
const E2E_PORT = process.env.CI ? 3051 : 3050;
const E2E_URL = `http://localhost:${E2E_PORT}`;

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    // Репортёр обязан быть НЕблокирующим (#81): html-репортёр по умолчанию на падении
    // поднимает веб-сервер отчёта и висит до Ctrl+C. В прод-гейте ralph (headless, без
    // человека) это превратило бы «красный e2e» в «зависший гейт». open:'never' —
    // отчёт пишется на диск, но не сервируется; list даёт читаемый лог падения в stdout.
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL: E2E_URL,
        trace: 'on-first-retry',
    },
    // В CI e2e сертифицирует ПРОД-сборку (`next start`), а не dev: прод-гейт первым чеком
    // уже собрал `next build` — гоняем e2e ровно по тому артефакту, что деплоится
    // (границы server/client, prod-минификация), и убираем дев-компиляцию маршрутов на
    // первом заходе, джиттер которой сейчас маскируют retries. Требует прогона `npm run
    // build` до e2e — в прод-гейте он идёт раньше по составу чеков (BASE_GATE_CHECKS).
    // Вне CI — `npm run dev`, чтобы локальный запуск не требовал предварительной сборки.
    webServer: {
        command: process.env.CI ? `npm run start -- --port ${E2E_PORT}` : 'npm run dev',
        url: E2E_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
