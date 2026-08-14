'use client';

import { useEffect, useRef, useState } from 'react';
import { createSeededRandom } from '@/shared/lib/random';
import { ChatBubble, type TBotReply } from '@/entities/bot-messages';
import { SkyBackground } from '../sky-background';
import { PrecipitationLayer } from '../precipitation-layer';
import type { TReplay } from '@/entities/replays';
import { getStoredTankSkinId, selectTankSkinForSeed } from '@/entities/tank-skins';
import { useGameStore } from '../../model/game.store';
import { GamePlay } from '../../lib/game-play';
import { dealWeapons } from '../../lib/weapons';
import { createFxRandom } from '../../lib/fx-random';
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
    // Ветер ВОСПРОИЗВОДИМОГО боя: движок считает его от сида записи, а слой осадков без
    // него ронял бы снег/дождь строго вертикально — не так, как было в самом бою.
    // Локальное состояние, а не стор: стор реплея держит HUD, и писать туда боевой ветер
    // означало бы смешивать два источника (см. `onWindInit` в `GameCanvas`).
    const [replayWind, setReplayWind] = useState(0);

    const applyDamage = useGameStore((s) => s.applyDamage);
    const setGameOver = useGameStore((s) => s.setGameOver);
    const resetGame = useGameStore((s) => s.resetGame);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Скин игрока читаем один раз: он и рисует левый танк, и исключает свою
        // палитру из выбора соперника (контраст «свой/чужой»).
        const playerSkinId = getStoredTankSkinId();

        const game = new GamePlay(
            canvasRef,
            // Та же детерминированная раздача оружия, что и в живом бою, —
            // арсеналы не записываются в реплей, а восстанавливаются.
            dealWeapons(),
            {
                // Как в живом бою: попадание снимает урон с HP того, в кого попали,
                // но конец боя по HP НЕ ставим (`endsBattle: false`): в реплее конец
                // ставит драйвер по концу ленты ходов. Иначе старая ссылка (запись до
                // HP-модели, где сторона суммарно ловила > MAX_HP урона) обнулила бы HP
                // и показала «Бой завершён» посреди ещё проигрываемых ходов.
                onTankHit: ({ hittedIsLeft, power }) => {
                    applyDamage(hittedIsLeft ? 'player' : 'enemy', power, false);
                },
                onGameOverCheck: ({ leftWeapons, rightWeapons }) => {
                    if (!leftWeapons && !rightWeapons && !game.isFireMode) {
                        setGameOver();
                    }
                },
                onWindInit: (wind) => setReplayWind(wind),
                // Смена ветра бурей (#547) — только у записей своей эпохи: у старых
                // `weather:false`, и движок этот колбэк не дёргает вовсе.
                onWindChange: (wind) => setReplayWind(wind),
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
            // Отдельный поток для косметики — как в GameCanvas (см. createFxRandom).
            createFxRandom(replay.seed),
            // Воспроизведение идёт на логическом размере записи, а не экрана:
            // физика в абсолютных пикселях, иначе рельеф/ветер/траектории разойдутся.
            {
                fixedLogicalSize: { width: replay.width, height: replay.height },
                // Скины (issue #481) в запись не пишутся (чисто косметика, см.
                // tank-skin-parity.test.ts) — свой берём из ТЕКУЩЕГО предпочтения
                // (как звук/тема), бот — детерминированно от seed записи из палитр,
                // отличных от палитры игрока (цветовой контраст «свой/чужой»): тот
                // же сид + тот же скин игрока всегда дают тот же вид соперника.
                leftSkinId: playerSkinId,
                rightSkinId: selectTankSkinForSeed(replay.seed, playerSkinId),
                // Сид записи — модели света сцены (#545): реплей показывает то же
                // время суток (тень, тонировка), что и живой бой того же сида.
                seed: replay.seed,
                // Погода — ТОЛЬКО у записей своей эпохи (#546/#547, формат v5). Сид один и
                // тот же, поэтому без флага снег и буря применились бы и к старым записям:
                // ветер ×4/3 или его разворот после третьего выстрела — другие траектории,
                // другой HP, на несчастливом сиде другой победитель. Реплей обязан
                // показывать записанный бой, а не сегодняшние правила поверх него.
                weather: replay.weather === true,
            },
        );
        // Инсеты safe-зоны записи — ДО генерации рельефа (loadImages → initPaint):
        // рельеф генерится внутри свободной зоны (#454), поэтому воспроизведение
        // обязано взять те же инсеты, иначе рельеф и счёт разойдутся с живым боем.
        // Записи до safe-зоны инсетов не имеют — рельеф во весь канвас, как и был.
        if (replay.insets) game.setArenaInsets(replay.insets);
        game.loadImages();

        const driver = new ReplayDriver(replay.moves, createReplayEngineAdapter(game));
        // Движок «в покое»: снаряд не летит, земля не осыпается, танки стоят.
        // По этому признаку и завершаем реплей, когда ходы кончились.
        const isEngineSettled = () =>
            !game.isFireMode &&
            !game.bullet &&
            !game.ground?.isFalling &&
            !game.leftTank?.dx &&
            !game.leftTank?.dy &&
            !game.rightTank?.dx &&
            !game.rightTank?.dy;
        // Date.now вместо performance.now: драйверу хватает мс-точности, а в
        // тестах fake timers гарантированно фейкают именно Date.
        const timerId = window.setInterval(() => {
            driver.tick(Date.now());
            // Ходы кончились и последний доиграл — останавливаем таймер и явно
            // помечаем конец. Иначе интервал тикал бы до анмаунта, а HUD навсегда
            // застрял бы на бейдже «Реплей», если запись не исчерпала оружие
            // (обрезанная или сторонняя ссылка).
            if (driver.isFinished && isEngineSettled()) {
                window.clearInterval(timerId);
                setGameOver();
            }
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
            {/* Небо того же сида, что у боя (#545): без него реплей показывал СЛЕДСТВИЯ
                света — тень танков и тонировку рельефа от светила, которого на экране нет.
                `reducedMotion` — облака статичны: реплей и так проигрывается по записи, а
                живой параллакс в нём только отвлекал бы от разбора выстрелов. */}
            <SkyBackground
                seed={replay.seed}
                wind={replayWind}
                reducedMotion
                className="pointer-events-none absolute inset-0"
            />
            {/* Ввод не обрабатывается: реплей смотрят, а не играют. Бэкинг-стор
                canvas — фиксированного логического размера боя; object-contain
                вписывает его в экран, сохраняя пропорции поля (см. fixedLogicalSize). */}
            <canvas
                ref={canvasRef}
                className="game-canvas relative mx-auto block h-full w-full object-contain"
            />
            {/* Осадки — ТОЛЬКО у записей своей эпохи (v5, см. `weather` выше): иначе на
                старой записи шёл бы снег, которого в том бою не было, а «размокшие»
                воронки в рельефе оставались бы необъяснёнными. */}
            {replay.weather === true && (
                <PrecipitationLayer
                    seed={replay.seed}
                    wind={replayWind}
                    className="pointer-events-none absolute inset-0"
                />
            )}
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
