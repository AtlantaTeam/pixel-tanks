import { defineConfig } from 'steiger';
import fsd from '@feature-sliced/steiger-plugin';

export default defineConfig([
    ...fsd.configs.recommended,
    {
        // Next.js App Router — не FSD-слой, игнорируем
        ignores: ['./src/app/**'],
    },
    {
        // Payload CMS — инфраструктурный слой, не FSD
        ignores: ['./src/payload.config.ts', './src/payload/**', './src/payload-types.ts'],
    },
    {
        // Моки для тестов
        ignores: ['**/__mocks__/**'],
    },
    {
        // Пустые слои пока не наполнены — убрать когда появится код
        rules: {
            'fsd/insignificant-slice': 'off',
        },
    },
]);
