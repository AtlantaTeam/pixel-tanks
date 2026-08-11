import { GameOverDialog } from '@/widgets/game-over-dialog';

/** design-inventory.dc.html — экран конца боя: диалог с кнопками «Новая игра»
 *  (primary) и «В меню» (ghost) для всех исходов.
 *
 *  Витрина = срез визуальной регрессии (`design-system-showcase.md`): исход
 *  показываем СТАТИЧНО (`dialogVariant="static"` — в потоке, без `fixed` и без
 *  кражи фокуса, как `PauseSection`), а очки задаём через `preview` БЕЗ мутации
 *  боевого `useGameStore`. Так три исхода сосуществуют независимо и попадают в
 *  бейзлайн как реальный контент, а не пустые боксы. `player`/`enemy` — HP
 *  сторон, `shots`/`hits`/`maneuvers` — входы статистики (урон, точность,
 *  выстрелы, манёвры), чтобы витрина показала непустые строки game-over. */
const OUTCOMES = [
    { key: 'victory', label: 'Победа', player: 30, enemy: 10, shots: 6, hits: 5, maneuvers: 3 },
    { key: 'defeat', label: 'Поражение', player: 10, enemy: 30, shots: 7, hits: 3, maneuvers: 2 },
    { key: 'draw', label: 'Ничья', player: 20, enemy: 20, shots: 5, hits: 3, maneuvers: 4 },
] as const;

export function GameOverSection() {
    return (
        <div className="flex flex-col gap-8">
            {OUTCOMES.map(({ key, label, player, enemy, shots, hits, maneuvers }) => (
                <div key={key} className="flex flex-col gap-3">
                    <h3 className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                        {label}
                    </h3>
                    {/* Landmark для среза (по нему визрегрессия и тест отличают
                        исходы); своей рамки не рисуем — статичный Dialog внутри
                        отбивает срез собственным Panel, лишняя внешняя рамка дала
                        бы двойной бокс. */}
                    <div role="region" aria-label={`Экран конца боя — ${label}`} className="p-6">
                        <GameOverDialog
                            dialogVariant="static"
                            preview={{ player, enemy, shots, hits, maneuvers }}
                            titleId={`game-over-title-${key}`}
                        />
                    </div>
                </div>
            ))}
        </div>
    );
}
