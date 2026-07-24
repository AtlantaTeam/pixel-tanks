import { clsx } from 'clsx';
import type { TFaction } from '@/shared/lib/theme';
import type { TIconName } from '../icon';
import { Icon } from '../icon';

export type TChatBubbleFaction = TFaction;

type TChatBubbleProps = {
    faction: TChatBubbleFaction;
    speaker: string;
    message: string;
    className?: string;
};

const ICON_BY_FACTION: Record<TChatBubbleFaction, TIconName> = {
    player: 'star',
    enemy: 'skull',
};

/** design-inventory.dc.html §HUD «Chat-bubble бота»: реплика с шапкой (иконка +
 *  имя) на --accent/--glow и хвостиком-указателем снизу слева. `data-faction`
 *  ставит сама (как Avatar/FactionBadge) — бабл всегда привязан к своей стороне,
 *  а не к теме предка.
 *
 *  NB: в `entities/bot-messages/ui/chat-bubble` живёт одноимённый, но иной компонент —
 *  рантайм-оверлей над танком (позиция x/y, `animate-bubble-pop`, категорийные цвета).
 *  Это канонический ДС-атом статичной реплики; на него `entities`-оверлею предстоит
 *  перейти отдельной задачей игрового трека. Импорты различаются слоем-путём
 *  (`@/shared/ui` против `@/entities/bot-messages`). */
export function ChatBubble({ faction, speaker, message, className }: TChatBubbleProps) {
    return (
        <div
            data-faction={faction}
            className={clsx(
                'relative inline-block max-w-[260px] border-[length:var(--border-w)] border-[color:var(--accent)] bg-surface px-3.5 py-3 shadow-[var(--glow)]',
                className,
            )}
        >
            <div className="mb-1 flex items-center gap-2">
                <Icon
                    name={ICON_BY_FACTION[faction]}
                    size={14}
                    className="text-[color:var(--accent)]"
                />
                <span className="font-ui text-label font-bold tracking-[0.08em] text-[color:var(--accent)] uppercase">
                    {speaker}
                </span>
            </div>
            <p className="font-ui text-caption leading-[1.45] text-text">{message}</p>
            <span
                aria-hidden
                data-testid="chat-bubble-tail"
                className="absolute -bottom-[9px] left-[22px] h-0 w-0 border-x-[8px] border-t-[9px] border-x-transparent border-t-[color:var(--accent)]"
            />
        </div>
    );
}
