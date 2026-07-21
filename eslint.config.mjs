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
    // playwright-report/** и test-results/** — артефакты e2e-прогона (#81). С e2e в
    // прод-гейте они стабильно появляются на сервере (минифицированный вендор трейс-
    // вьюера), и без игнора следующий чек `lint` захлебнулся бы сотнями ложных ошибок
    // в чужом бандле. Оба каталога в .gitignore — линтить их нечего.
    globalIgnores([
        '.next/**',
        'out/**',
        'build/**',
        'next-env.d.ts',
        '.claude/**',
        'playwright-report/**',
        'test-results/**',
    ]),
]);

export default eslintConfig;
