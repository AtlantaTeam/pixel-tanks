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

/** Бейдж заморозки телеметрии на планшете/десктопе (#472): короткий чип рядом
 *  с пилюлей хода, а не полноширинная заметка внутри ряда телеметрии (лежала
 *  поверх числовых ячеек на `xl`, где полоса телеметрии — 78px без запаса под
 *  строку текста). Кадры брейкпоинтов выше уже показывают состояние «свой ход»
 *  (слот зарезервирован, бейдж невидим) на всех четырёх ширинах — здесь второе
 *  состояние («ход бота», бейдж виден) для планшета и десктопа: мобильный уже
 *  покрыт рядом состояний выше (`GameScreenStatesRow`, срез «Ход бота»). */
const FREEZE_BADGE_FRAMES = [
    bp(768, SCREEN_FRAME_HEIGHT, 0.62, 'Планшет · 768 (ход бота)', 'tablet'),
    bp(1280, SCREEN_FRAME_HEIGHT, 0.42, 'Desktop · 1280 (ход бота)', 'desktop'),
];

export function GameScreenFreezeBadgeRow() {
    return (
        <div data-testid="game-screen-freeze-badge" className="flex min-w-0 flex-col gap-2">
            <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                Бейдж заморозки — планшет/десктоп, ход бота
            </span>
            <div className="flex min-w-0 flex-wrap items-start gap-5 overflow-x-auto pb-2">
                {FREEZE_BADGE_FRAMES.map((frame) => (
                    <ScreenFrame key={frame.label} frame={frame}>
                        <GameScreenFrame variant={frame.variant} state="bot-turn" />
                    </ScreenFrame>
                ))}
            </div>
        </div>
    );
}
