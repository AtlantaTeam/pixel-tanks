import { defineConfig, devices } from '@playwright/test';

// Локальный VPN/прокси (HTTP_PROXY=127.0.0.1:...) перехватывает пробу webServer
// к localhost и отдаёт 502 — исключаем localhost из проксирования.
process.env.NO_PROXY = [process.env.NO_PROXY, 'localhost,127.0.0.1'].filter(Boolean).join(',');
process.env.no_proxy = process.env.NO_PROXY;

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
        baseURL: 'http://localhost:3050',
        trace: 'on-first-retry',
    },
    webServer: {
        command: 'npm run dev',
        url: 'http://localhost:3050',
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
