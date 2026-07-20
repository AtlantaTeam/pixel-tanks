import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        environment: 'happy-dom',
        globals: true,
        setupFiles: ['./src/test/setup.ts'],
        // src/** — приложение; .claude/ralph — Node-раннер (CommonJS-скрипт), тесты
        // на его чистые функции живут рядом с ним, а не в src.
        include: ['src/**/*.test.{ts,tsx}', '.claude/ralph/**/*.test.{js,ts}'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.{ts,tsx}'],
            exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts', 'src/app/**'],
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
