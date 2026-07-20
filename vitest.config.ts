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
                    include: ['.claude/ralph/**/*.test.{js,ts}'],
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
