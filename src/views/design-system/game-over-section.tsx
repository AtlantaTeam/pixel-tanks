import { useGameStore } from '@/features/game-engine';
import { GameOverDialog } from '@/widgets/game-over-dialog';

/** design-inventory.dc.html — экран конца боя: диалог с кнопками
 *  «Новая игра» (primary) и «В меню» (ghost) для всех исходов. */
export function GameOverSection() {
    return (
        <div className="flex flex-col gap-8">
            {(['victory', 'defeat'] as const).map((outcome) => {
                const playerPoints = outcome === 'victory' ? 30 : 10;
                const enemyPoints = outcome === 'victory' ? 10 : 30;

                return (
                    <div key={outcome} className="flex flex-col gap-3">
                        <h3 className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                            {outcome === 'victory' ? 'Победа' : 'Поражение'}
                        </h3>
                        <div className="border-[length:var(--border-w)] border-border bg-panel p-6">
                            <div
                                role="region"
                                aria-label={`Game over dialog - ${outcome}`}
                                onMouseEnter={() => {
                                    useGameStore.setState({
                                        isGameOver: false,
                                        playerPoints,
                                        enemyPoints,
                                    });
                                    useGameStore.getState().setGameOver(true);
                                }}
                            >
                                <GameOverDialog seed="42" />
                            </div>
                        </div>
                    </div>
                );
            })}

            <div className="flex flex-col gap-3">
                <h3 className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                    Ничья
                </h3>
                <div className="border-[length:var(--border-w)] border-border bg-panel p-6">
                    <div
                        role="region"
                        aria-label="Game over dialog - draw"
                        onMouseEnter={() => {
                            useGameStore.setState({
                                isGameOver: false,
                                playerPoints: 20,
                                enemyPoints: 20,
                            });
                            useGameStore.getState().setGameOver(true);
                        }}
                    >
                        <GameOverDialog seed="42" />
                    </div>
                </div>
            </div>
        </div>
    );
}
