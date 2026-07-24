import { clsx } from 'clsx';
import type { TFaction } from '@/shared/lib/theme';

/** Общий шелл квадратного бейджа фракции для Avatar и FactionBadge — чтобы вид не
 *  разъезжался между двумя атомами (DRY). По design-inventory.dc.html §HUD
 *  «Avatar / бейдж фракции»: `border:3px solid var(--accent); box-shadow:var(--glow)`
 *  — одна чистая рамка + мягкое гло. Ширину рамки и размер (`border-[3px]`/`size-14`)
 *  задаёт вызывающий атом. `pixel-border` тут НЕ используется намеренно: ступенчатая
 *  box-shadow-рамка поверх настоящего `border` дала бы двойную рамку, которой в
 *  инвентаре нет. Ветка `unknown` — серый бейдж без гло (тоже по инвентарю). */
export function badgeShellClasses(faction: TFaction | 'unknown') {
    const isUnknown = faction === 'unknown';

    return clsx(
        'flex items-center justify-center',
        isUnknown
            ? 'bg-muted border-border-strong text-text-dim'
            : 'bg-surface border-[color:var(--accent)] text-[color:var(--accent)] shadow-[var(--glow)]',
    );
}
