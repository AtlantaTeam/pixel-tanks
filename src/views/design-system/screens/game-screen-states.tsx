import { bp, SCREEN_FRAME_HEIGHT } from './frameset';
import { GameScreenFrame, type TGameScreenState } from './game-screen-frame';
import { ScreenFrame } from './screen-frame';

/** Состояния боевого экрана (handoff «Взаимодействия и состояния», issue #427).
 *  `over` (game over, victory/defeat) сюда не входит — он уже 1:1 показан
 *  `GameOverSection` (§13) реальным `GameOverDialog`, дублировать незачем. Все
 *  срезы — на эталонной мобильной ШИРИНЕ 390 (handoff «390×844 — эталон» задаёт
 *  эталонной именно ширину); высота кадра — общая `SCREEN_FRAME_HEIGHT` каталога
 *  (720), а не 844: каталог сравнивает срезы по ширине при единой высоте. */
const STATES: { key: TGameScreenState; label: string }[] = [
    { key: 'player-turn', label: 'Свой ход' },
    { key: 'bot-turn', label: 'Ход бота' },
    { key: 'aiming', label: 'Прицеливание' },
    { key: 'empty-ammo', label: 'Пустой боезапас' },
    { key: 'calm', label: 'Спокойный HUD' },
];

const STATE_FRAME = bp(390, SCREEN_FRAME_HEIGHT, 1, '', 'mobile');

/** Ряд состояний игрового экрана — рядом с кадрами брейкпоинтов в §11 «Экраны»,
 *  но отдельным `data-testid`, чтобы тесты не путали счёт вхождений с кадрами
 *  брейкпоинтов (`game-screen-breakpoints`). */
export function GameScreenStatesRow() {
    return (
        <div data-testid="game-screen-states" className="flex min-w-0 flex-col gap-2">
            <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                Состояния (мобильный эталон 390)
            </span>
            <div className="flex min-w-0 flex-wrap items-start gap-5 overflow-x-auto pb-2">
                {STATES.map(({ key, label }) => (
                    <ScreenFrame key={key} frame={{ ...STATE_FRAME, label }}>
                        <GameScreenFrame variant="mobile" state={key} />
                    </ScreenFrame>
                ))}
            </div>
        </div>
    );
}
