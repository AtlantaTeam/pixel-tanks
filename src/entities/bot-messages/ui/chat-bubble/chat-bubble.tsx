'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import { clsx } from 'clsx';
import { EBotReplyCategory, type TBotReply } from '../../t-bot-reply';

const DEFAULT_DURATION_MS = 3000;

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

/** DOM-слой поверх Canvas: реплика бота, привязанная к точке (x, y) над танком. */
export function ChatBubble({
    reply,
    x,
    y,
    durationMs = DEFAULT_DURATION_MS,
    onExpire,
    className,
}: TChatBubbleProps) {
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
                'pixel-border pointer-events-none absolute m-1 -translate-x-1/2 -translate-y-full',
                'animate-bubble-pop motion-reduce:animate-none',
                'max-w-40 bg-panel px-3 py-2 text-center font-pixel text-[10px] text-ink',
                className,
            )}
            style={
                {
                    left: x,
                    top: y,
                    '--pixel-border-color': CATEGORY_COLOR[reply.category],
                } as CSSProperties
            }
        >
            {reply.text}
        </div>
    );
}
