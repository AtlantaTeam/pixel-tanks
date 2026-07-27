import { GameOverDialog } from '@/widgets/game-over-dialog';

/** design-inventory.dc.html — экран конца боя: диалог с кнопками «Новая игра»
 *  (primary) и «В меню» (ghost) для всех исходов.
 *
 *  Витрина = срез визуальной регрессии (`design-system-showcase.md`): исход
 *  показываем СТАТИЧНО (`dialogVariant="static"` — в потоке, без `fixed` и без
 *  кражи фокуса, как `PauseSection`), а очки задаём через `preview` БЕЗ мутации
 *  боевого `useGameStore`. Так три исхода сосуществуют независимо и попадают в
 *  бейзлайн как реальный контент, а не пустые боксы. */
const OUTCOMES = [
    { key: 'victory', label: 'Победа', playerPoints: 30, enemyPoints: 10 },
    { key: 'defeat', label: 'Поражение', playerPoints: 10, enemyPoints: 30 },
    { key: 'draw', label: 'Ничья', playerPoints: 20, enemyPoints: 20 },
] as const;

export function GameOverSection() {
    return (
        <div className="flex flex-col gap-8">
            {OUTCOMES.map(({ key, label, playerPoints, enemyPoints }) => (
                <div key={key} className="flex flex-col gap-3">
                    <h3 className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                        {label}
                    </h3>
                    <div
                        role="region"
                        aria-label={`Game over dialog - ${key}`}
                        className="border-[length:var(--border-w)] border-border bg-panel p-6"
                    >
                        <GameOverDialog
                            seed="42"
                            dialogVariant="static"
                            preview={{ playerPoints, enemyPoints }}
                            titleId={`game-over-title-${key}`}
                        />
                    </div>
                </div>
            ))}
        </div>
    );
}
