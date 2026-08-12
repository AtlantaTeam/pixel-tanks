'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { clsx } from 'clsx';
import { usePrefersReducedMotion } from '@/shared/lib/animation';
import { BOT_NAME } from '@/shared/config';
import { Icon } from '@/shared/ui';
import { EBotReplyCategory, type TBotReply } from '../../t-bot-reply';

const DEFAULT_DURATION_MS = 3000;
/** Печать реплики (handoff «Чат-бабл бота»): ~35 мс/символ. */
const TYPING_MS_PER_CHAR = 35;
/**
 * Доля срока жизни бабла, за которую печать обязана завершиться. Печать не
 * связана со сроком жизни напрямую (`text.length × TYPING_MS_PER_CHAR` против
 * `durationMs`), поэтому длинная реплика без клэмпа обрывалась бы на полуслове,
 * когда сработает таймер исчезновения. При превышении бюджета шаг печати
 * ускоряется так, чтобы весь текст успел проявиться, а остаток срока — на чтение.
 */
const TYPING_BUDGET_RATIO = 0.6;

const CATEGORY_COLOR: Record<EBotReplyCategory, string> = {
    [EBotReplyCategory.Happy]: 'var(--color-accent)',
    [EBotReplyCategory.Angry]: 'var(--color-danger)',
    [EBotReplyCategory.Sarcasm]: 'var(--color-primary)',
};

type TChatBubbleProps = {
    reply: TBotReply;
    x: number;
    y: number;
    durationMs?: number;
    onExpire?: () => void;
    className?: string;
};

/** Печатает `text` посимвольно с шагом `TYPING_MS_PER_CHAR` — сразу целиком при
 *  `prefers-reduced-motion: reduce` (handoff «Доступность движения»): в этом
 *  случае эффект даже не подписывается на интервал, полный текст отдаёт сам
 *  return — состояние печати такому рендеру не нужно.
 *
 *  Сброс прогресса печати при смене `text` — синхронный setState ПРЯМО В теле
 *  рендера (паттерн React «adjusting state when a prop changes»), не в эффекте:
 *  так React перерендерит с нуля до коммита, без каскадного лишнего кадра,
 *  который дал бы сброс из `useEffect`. */
function useTypedText(text: string, durationMs: number): string {
    const reducedMotion = usePrefersReducedMotion();
    const [state, setState] = useState({ text, visibleChars: 0 });
    if (state.text !== text) {
        setState({ text, visibleChars: 0 });
    }

    useEffect(() => {
        if (reducedMotion) return;
        // Шаг печати ≤ TYPING_MS_PER_CHAR, но при необходимости ускоряется, чтобы
        // весь текст уложился в бюджет `durationMs × TYPING_BUDGET_RATIO` — иначе
        // длинная реплика обрывается на полуслове на таймере жизни бабла.
        const budget = durationMs * TYPING_BUDGET_RATIO;
        const step =
            text.length > 0
                ? Math.min(TYPING_MS_PER_CHAR, budget / text.length)
                : TYPING_MS_PER_CHAR;
        let shown = 0;
        const id = setInterval(() => {
            shown += 1;
            setState((s) => ({ ...s, visibleChars: shown }));
            if (shown >= text.length) clearInterval(id);
        }, step);
        return () => clearInterval(id);
    }, [text, reducedMotion, durationMs]);

    return reducedMotion ? text : text.slice(0, state.visibleChars);
}

/** DOM-слой поверх Canvas: реплика бота, привязанная к точке (x, y) над танком —
 *  бабл сидит нижним краем на (x, y) (`-translate-y-full`), поэтому хвост,
 *  центрированный по низу, всегда указывает точно на танк независимо от длины
 *  текста (высота растёт вверх, точка привязки не двигается). */
export function ChatBubble({
    reply,
    x,
    y,
    durationMs = DEFAULT_DURATION_MS,
    onExpire,
    className,
}: TChatBubbleProps) {
    const typedText = useTypedText(reply.text, durationMs);
    const color = CATEGORY_COLOR[reply.category];

    // onExpire держим в ref, чтобы его идентичность не пересоздавала таймер:
    // родитель ре-рендерится десятками раз в секунду при прицеливании, а инлайн
    // `() => setBotBubble(null)` без ref сбрасывал бы отсчёт и бабл не исчезал бы.
    const onExpireRef = useRef(onExpire);
    useEffect(() => {
        onExpireRef.current = onExpire;
    }, [onExpire]);

    useEffect(() => {
        const timer = setTimeout(() => onExpireRef.current?.(), durationMs);
        return () => clearTimeout(timer);
        // reply в deps намеренно: смена реплики (даже на той же позиции) должна
        // перезапускать таймер жизни бабла, а не досчитывать старый.
    }, [reply, durationMs]);

    return (
        <div
            // Декоративный тизер над танком, не aria-live: скринридеру незачем
            // зачитывать реплику бота на каждый выстрел.
            aria-hidden="true"
            className={clsx(
                'pointer-events-none absolute -translate-x-1/2 -translate-y-full',
                'animate-bubble-pop motion-reduce:animate-none',
                'border-[length:var(--border-w)] max-w-[260px] bg-surface px-3.5 py-3 text-center',
                'shadow-[var(--glow-enemy),0_0_0_1px_rgba(0,0,0,.9)]',
                className,
            )}
            style={
                {
                    left: x,
                    top: y,
                    borderColor: color,
                } as CSSProperties
            }
        >
            <div className="mb-1 flex items-center justify-center gap-1.5 text-enemy">
                <Icon name="skull" size={14} />
                <span className="font-ui text-[10px] font-bold tracking-[0.12em] uppercase">
                    {BOT_NAME}
                </span>
            </div>
            <p className="font-ui text-[12px] leading-[1.45] text-text">{typedText}</p>
            {/* Хвост — треугольник, центрирован по низу бабла: указывает на танк,
                над которым бабл заякорен (см. докблок компонента). */}
            <span
                aria-hidden
                className="absolute bottom-[-9px] left-1/2 h-0 w-0 -translate-x-1/2 border-x-8 border-t-[9px] border-x-transparent"
                style={{ borderTopColor: color }}
            />
        </div>
    );
}
