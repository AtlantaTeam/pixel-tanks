import type { ESLint } from 'eslint';
import { noEmojiAsIconRule } from './no-emoji-as-icon.ts';

/** Плагин с собственными правилами линтинга проекта, подключается в eslint.config.mjs. */
export const pixelTanksEslintPlugin: ESLint.Plugin = {
    rules: {
        'no-emoji-as-icon': noEmojiAsIconRule,
    },
};

export { noEmojiAsIconRule };
