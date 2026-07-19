'use client';

import { useEffect, useRef, useState } from 'react';
import { createSeededRandom } from '@/shared/lib/random';
import { ChatBubble, type TBotReply } from '@/entities/bot-messages';
import type { TReplay } from '@/entities/replays';
import { useGameStore } from '../../model/game.store';
import { GamePlay } from '../../lib/game-play';
import { generateRandomWeapons } from '../../lib/weapons';
import { resolvePointsDelta } from '../../lib/score';
import { createReplayEngineAdapter, ReplayDriver } from '../../lib/replay-driver';

/**
 * Период опроса готовности движка драйвером, мс. Ход применяется в «покое»
 * между ходами, поэтому точность кадра не нужна — хватает грубого таймера.
 */
const DRIVER_TICK_INTERVAL_MS = 100;

type TReplayCanvasProps = {
    replay: TReplay;
};

/**
 * Воспроизведение записанного боя: тот же движок GamePlay на том же seed, но
 * вместо ввода игрока ходы применяет ReplayDriver. Бот в запись не входит —
 * он детерминирован seed'ом и «переигрывает» свои ходы сам.
 */
export function ReplayCanvas({ replay }: TReplayCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const [botBubble, setBotBubble] = useState<{ reply: TBotReply; x: number; y: number } | null>(
        null,
    );

    const increasePlayerPoints = useGameStore((s) => s.increasePlayerPoints);
    const increaseEnemyPoints = useGameStore((s) => s.increaseEnemyPoints);
    const setGameOver = useGameStore((s) => s.setGameOver);
    const resetGame = useGameStore((s) => s.resetGame);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const game = new GamePlay(
            canvasRef,
            // Та же детерминированная раздача оружия, что и в живом бою, —
            // арсеналы не записываются в реплей, а восстанавливаются.
            generateRandomWeapons(),
            {
                onPointsCalc: (event) => {
                    const { isPlayer, delta } = resolvePointsDelta(event);
                    (isPlayer ? increasePlayerPoints : increaseEnemyPoints)(delta);
                },
                onGameOverCheck: ({ leftWeapons, rightWeapons }) => {
                    if (!leftWeapons && !rightWeapons && !game.isFireMode) {
                        setGameOver(true);
                    }
                },
                onMovesChange: () => {},
                onPowerChange: () => {},
                onBotReply: (reply) => {
                    const bot = game.rightTank;
                    if (!bot) return;
                    setBotBubble({
                        reply,
                        x: bot.x + bot.tankWidth / 2,
                        y: bot.y - bot.tankHeight,
                    });
                },
            },
            createSeededRandom(replay.seed),
            // Отдельный поток для косметики — как в GameCanvas (см. GamePlay).
            createSeededRandom(`fx:${replay.seed}`),
        );
        game.loadImages();

        const driver = new ReplayDriver(replay.moves, createReplayEngineAdapter(game));
        // Date.now вместо performance.now: драйверу хватает мс-точности, а в
        // тестах fake timers гарантированно фейкают именно Date.
        const timerId = window.setInterval(() => {
            driver.tick(Date.now());
        }, DRIVER_TICK_INTERVAL_MS);

        return () => {
            window.clearInterval(timerId);
            game.destroy();
            resetGame();
            setBotBubble(null);
        };
        // replay приходит с сервера страницы и не меняется за время жизни маршрута
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <>
            {/* Ввод не обрабатывается: реплей смотрят, а не играют. */}
            <canvas ref={canvasRef} className="game-canvas block h-full w-full bg-base-200" />
            {botBubble && (
                <ChatBubble
                    reply={botBubble.reply}
                    x={botBubble.x}
                    y={botBubble.y}
                    onExpire={() => setBotBubble(null)}
                />
            )}
        </>
    );
}
