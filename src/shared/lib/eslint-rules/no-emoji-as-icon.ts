import type { Rule } from 'eslint';

/** `JSXText` не поименован в `Rule.RuleListener` (только базовые estree-узлы) — достаём его
 *  из объединения `Rule.Node` (расширено JSX-типами через `@types/estree-jsx`) явно. */
type TJsxTextNode = Extract<Rule.Node, { type: 'JSXText' }>;

const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;

/** Атрибуты, чьё значение рендерится/озвучивается пользователю как замена иконки. */
const ICON_LIKE_ATTRIBUTES = new Set(['aria-label', 'title', 'alt', 'placeholder']);

function findEmoji(value: string): string | null {
    return value.match(EMOJI_PATTERN)?.[0] ?? null;
}

function getJsxAttributeName(node: Rule.Node): string | null {
    if (node.type !== 'JSXAttribute') return null;
    return node.name.type === 'JSXIdentifier' ? node.name.name : null;
}

/** Строковый литерал/шаблон — эмодзи в нём считается «иконкой», только если он рендерится
 *  как дочерний узел JSX-элемента/фрагмента либо как значение icon-подобного атрибута
 *  (`aria-label`/`title`/`alt`/`placeholder`). Эмодзи в обычных JS-данных (тестовые фикстуры,
 *  реплики бота) — не иконка, правило их не трогает. */
function isJsxRenderPosition(node: Rule.Node): boolean {
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

export const noEmojiAsIconRule: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Запрещает эмодзи-пиктограммы вместо <Icon> из shared/ui/icon. Нет нужной иконки в наборе — заводи блокер для дизайна, не подставляй эмодзи-фолбэк.',
        },
        schema: [],
        messages: {
            emojiAsIcon:
                'Эмодзи «{{emoji}}» использован как иконка — рендери <Icon name="..."/> из shared/ui вместо эмодзи. Нет подходящей иконки в наборе — это блокер, не эмодзи-фолбэк.',
        },
    },
    create(context) {
        return {
            JSXText(node: TJsxTextNode) {
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
