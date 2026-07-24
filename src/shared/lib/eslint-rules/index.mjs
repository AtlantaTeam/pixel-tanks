import { noEmojiAsIconRule } from './no-emoji-as-icon.mjs';

/**
 * Плагин с собственными правилами линтинга проекта, подключается в eslint.config.mjs.
 * Файлы правил — на чистом JS (`.mjs`), а не `.ts`: eslint.config грузит их в рантайме
 * нативным ESM-лоадером Node, а `.ts` тянул бы стрип типов (Node ≥22.18) и варнинг.
 * @type {import('eslint').ESLint.Plugin}
 */
export const pixelTanksEslintPlugin = {
    rules: {
        'no-emoji-as-icon': noEmojiAsIconRule,
    },
};

export { noEmojiAsIconRule };
