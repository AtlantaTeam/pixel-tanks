import { defineConfig } from 'vitest/config';
import path from 'path';

// projects (vitest 3): раннер ralph — Node CommonJS-скрипт вне src/, его тесты не
// должны тянуть DOM-окружение и React-ориентированный setupFiles приложения
// (happy-dom + @testing-library/jest-dom) — они ему не нужны, это лишняя связка.
// "app" — прежнее поведение для src/**; "ralph" — чистый node, без setupFiles.
export default defineConfig({
    test: {
        coverage: {
            provider: 'v8',
            include: ['src/**/*.{ts,tsx}'],
            exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts', 'src/app/**'],
            // #82: прод-гейт (PROD_GATE_CHECKS в .claude/ralph/ralph.js) гоняет
            // `npm run test:coverage` только в профиле prod — playground этот чек
            // вообще не включает в состав гейта (gateChecksFor), поэтому порог ниже
            // ощущается только в prod, "мягкий" вариант для playground не нужен отдельно.
            // Числа — текущий фактический baseline (statements/lines 70.77%, functions
            // 63.42%, branches 88.64% на момент issue #82) минус запас на шум: порог не
            // "не упасть ни на процент", а "не откатиться заметно" — не блокирует гейт
            // сегодня, но ловит будущую деградацию.
            thresholds: {
                statements: 70,
                lines: 70,
                functions: 60,
                branches: 85,
            },
        },
        projects: [
            {
                extends: true,
                test: {
                    name: 'app',
                    environment: 'happy-dom',
                    globals: true,
                    setupFiles: ['./src/test/setup.ts'],
                    include: ['src/**/*.test.{ts,tsx}'],
                },
            },
            {
                extends: true,
                test: {
                    name: 'ralph',
                    environment: 'node',
                    globals: true,
                    include: [
                        '.claude/ralph/**/*.test.{js,ts}',
                        // *.config.test.ts в корне — тесты корневых конфигов (vitest.config
                        // и т.п.), по конвенции «тест рядом с модулем и по его имени».
                        '*.config.test.ts',
                        'scripts/**/*.test.{js,ts}',
                    ],
                },
            },
        ],
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
