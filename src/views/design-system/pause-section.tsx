import { PauseOverlay } from '@/widgets/pause-overlay';

const noop = () => {};

/** design-inventory.dc.html §12 «Пауза / Настройки боя»: реальный виджет
 *  `PauseOverlay` (фаза 6, #342) — не дублируем его разметку на витрине.
 *  `Dialog` внутри виджета — `position: fixed` на весь viewport в боевом режиме,
 *  поэтому витрина просит статичный срез (`dialogVariant="static"`): без fixed и
 *  без кражи фокуса — секция остаётся в потоке страницы рядом с 10–13. */
export function PauseSection() {
    return (
        <PauseOverlay
            open
            dialogVariant="static"
            onResume={noop}
            onRestart={noop}
            onExitToMenu={noop}
        />
    );
}
