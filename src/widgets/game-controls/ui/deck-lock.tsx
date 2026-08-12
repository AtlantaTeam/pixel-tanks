import { clsx } from 'clsx';

/**
 * Лок ввода палубы (handoff «Лок ввода», общий для хода бота и полёта снаряда):
 * оверлей на всю палубу — блюр + затемнение, чтобы контролы под ним не
 * просвечивали «грязью», и подпись состояния. Смысл — «сейчас нельзя», а не
 * «залипло».
 *
 * Реальный блок ввода живёт в самих контролах (`disabled` в `GameControls` и
 * гарды движка в `game-canvas.tsx`) — этот оверлей их не заменяет, а дублирует
 * defense-in-depth: `pointer-events-auto` перехватывает клик и здесь, даже если
 * какой-то будущий контрол забудет собственный гард/`disabled`.
 */
export type TDeckLockReason = 'bot-turn' | 'flight';

const LABEL: Record<TDeckLockReason, string> = {
    'bot-turn': 'Ход соперника',
    flight: 'Снаряд в полёте',
};

type TDeckLockProps = {
    reason: TDeckLockReason | null;
};

export function DeckLock({ reason }: TDeckLockProps) {
    if (!reason) return null;

    return (
        <div
            data-testid="deck-lock"
            aria-hidden
            className={clsx(
                'pointer-events-auto absolute inset-0 z-10 flex flex-col items-center justify-center gap-2',
                'bg-[rgba(8,12,8,0.88)] backdrop-blur-[3px] shadow-[inset_0_0_0_1px_rgba(0,0,0,.9)]',
            )}
        >
            <span
                aria-hidden
                className="size-2.5 animate-lock-blink bg-[color:var(--accent)] motion-reduce:animate-none"
            />
            <span className="font-display text-[15px] tracking-[0.08em] text-[color:var(--accent)] uppercase [text-shadow:var(--glow)]">
                {LABEL[reason]}
            </span>
        </div>
    );
}
