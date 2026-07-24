import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import { noEmojiAsIconRule } from './no-emoji-as-icon.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        parserOptions: { ecmaFeatures: { jsx: true } },
    },
});

ruleTester.run('no-emoji-as-icon', noEmojiAsIconRule, {
    valid: [
        // Типографика — не эмодзи, не трогаем
        '() => <p>2 × 2 = 4</p>',
        '() => <p>ветер → восток</p>',
        '() => <p>раздел · раздел</p>',
        '() => <p>шаг — другой шаг</p>',
        // Эмодзи вне JSX-позиции (данные, фикстуры) — не иконка, не трогаем
        "const replay = battle('бой-дня-☀', [fire(0.5, 5)]);",
        "const BOT_REPLIES = [{ text: 'Ух, как зарядил! 🔥' }];",
        // Использование <Icon> — правильный путь
        '() => <Icon name="fire" />',
        // Обычный текст без эмодзи в JSX
        '() => <button aria-label="Выключить звук">текст</button>',
    ],
    invalid: [
        {
            code: '() => <div>🔥</div>',
            errors: [{ messageId: 'emojiAsIcon' }],
        },
        {
            code: '() => <span>{isMuted ? "🔇" : "🔊"}</span>',
            errors: [{ messageId: 'emojiAsIcon' }, { messageId: 'emojiAsIcon' }],
        },
        {
            code: '() => <img alt="🔥" />',
            errors: [{ messageId: 'emojiAsIcon' }],
        },
        {
            code: '() => <button aria-label={"🔥"} />',
            errors: [{ messageId: 'emojiAsIcon' }],
        },
        {
            code: '() => <p>{`нажми ${x} 🔥`}</p>',
            errors: [{ messageId: 'emojiAsIcon' }],
        },
    ],
});
