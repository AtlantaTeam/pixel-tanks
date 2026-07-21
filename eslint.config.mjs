import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
    ...nextVitals,
    ...nextTs,
    {
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
        },
    },
    // playwright-report/** и test-results/** — артефакты e2e-прогона (#81); coverage/** —
    // артефакт coverage-чека (#82, istanbul-ассеты prettify.js/sorter.js/block-navigation.js).
    // Все три стабильно появляются на раннере в прод-гейте, это чужой сгенерированный код —
    // без игнора следующий чек `lint` линтил бы вендорный бандл (сотни ложных ошибок в
    // трейс-вьюере, warning про unused eslint-disable в istanbul). Все каталоги в
    // .gitignore — линтить их нечего.
    globalIgnores([
        '.next/**',
        'out/**',
        'build/**',
        'next-env.d.ts',
        '.claude/**',
        'playwright-report/**',
        'test-results/**',
        'coverage/**',
    ]),
]);

export default eslintConfig;
