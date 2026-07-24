/**
 * @typedef {import('eslint').Rule.RuleModule} TRuleModule
 * @typedef {import('eslint').Rule.Node} TRuleNode
 */

// Файл — на чистом JS (`.mjs`), а не `.ts`, намеренно: eslint.config.mjs импортирует правило
// в рантайме нативным ESM-лоадером Node. Импорт `.ts` требовал бы стрипа типов (Node ≥22.18)
// и печатал бы MODULE_TYPELESS_PACKAGE_JSON-варнинг на каждом `npm run lint`. `.mjs` — без этих
// требований к версии Node и без варнинга.

const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;

/** Атрибуты, чьё значение рендерится/озвучивается пользователю как замена иконки. */
const ICON_LIKE_ATTRIBUTES = new Set(['aria-label', 'title', 'alt', 'placeholder']);

/**
 * @param {string} value
 * @returns {string | null}
 */
function findEmoji(value) {
    return value.match(EMOJI_PATTERN)?.[0] ?? null;
}

/**
 * @param {TRuleNode} node
 * @returns {string | null}
 */
function getJsxAttributeName(node) {
    if (node.type !== 'JSXAttribute') return null;
    return node.name.type === 'JSXIdentifier' ? node.name.name : null;
}

/** Строковый литерал/шаблон — эмодзи в нём считается «иконкой», только если он рендерится
 *  как дочерний узел JSX-элемента/фрагмента либо как значение icon-подобного атрибута
 *  (`aria-label`/`title`/`alt`/`placeholder`). Эмодзи в обычных JS-данных (тестовые фикстуры,
 *  реплики бота) — не иконка, правило их не трогает.
 * @param {TRuleNode} node
 * @returns {boolean}
 */
function isJsxRenderPosition(node) {
    let current = node;
    let parent = current.parent;

    while (
        parent &&
        (parent.type === 'ConditionalExpression' || parent.type === 'LogicalExpression')
    ) {
        current = parent;
        parent = current.parent;
    }

    if (!parent) return false;

    if (parent.type === 'JSXExpressionContainer') {
        const grandParent = parent.parent;
        if (grandParent?.type === 'JSXElement' || grandParent?.type === 'JSXFragment') {
            return true;
        }
        if (grandParent?.type === 'JSXAttribute') {
            const name = getJsxAttributeName(grandParent);
            return name != null && ICON_LIKE_ATTRIBUTES.has(name);
        }
        return false;
    }

    if (parent.type === 'JSXAttribute') {
        const name = getJsxAttributeName(parent);
        return name != null && ICON_LIKE_ATTRIBUTES.has(name);
    }

    return false;
}

/** @type {TRuleModule} */
export const noEmojiAsIconRule = {
    meta: {
        type: 'problem',
        docs: {
            // Правило — эвристика по позиции литерала: ловит только ИНЛАЙН-эмодзи в JSX (текст
            // элемента, строковый/шаблонный литерал в render-позиции, icon-подобные атрибуты).
            // Эмодзи, протёкший через переменную/константу/объект (`const g = '🔥'; <b>{g}</b>`),
            // оно НЕ ловит — этот слой страхуют компонентные тесты (mute/sound/replay).
            description:
                'Запрещает инлайн-эмодзи вместо <Icon> из shared/ui/icon (только литералы в JSX; протечку через переменную ловят компонентные тесты). Нет нужной иконки в наборе — заводи блокер для дизайна, не подставляй эмодзи-фолбэк.',
        },
        schema: [],
        messages: {
            emojiAsIcon:
                'Эмодзи «{{emoji}}» использован как иконка — рендери <Icon name="..."/> из shared/ui вместо эмодзи. Нет подходящей иконки в наборе — это блокер, не эмодзи-фолбэк.',
        },
    },
    create(context) {
        return {
            JSXText(node) {
                const emoji = findEmoji(node.value);
                if (emoji) {
                    context.report({ node, messageId: 'emojiAsIcon', data: { emoji } });
                }
            },
            Literal(node) {
                if (typeof node.value !== 'string') return;
                const emoji = findEmoji(node.value);
                if (emoji && isJsxRenderPosition(node)) {
                    context.report({ node, messageId: 'emojiAsIcon', data: { emoji } });
                }
            },
            TemplateLiteral(node) {
                if (!isJsxRenderPosition(node)) return;
                for (const quasi of node.quasis) {
                    const emoji = findEmoji(quasi.value.raw);
                    if (emoji) {
                        context.report({ node: quasi, messageId: 'emojiAsIcon', data: { emoji } });
                        break;
                    }
                }
            },
        };
    },
};
