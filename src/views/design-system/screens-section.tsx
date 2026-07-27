import { ScreensCatalog } from './screens/screens-catalog';

const BREAKPOINTS = ['390 · Mobile', '768 · Планшет', '1280 · Desktop', '1920 · Wide'];

/** design-inventory.dc.html §11 «Поток · все брейкпоинты»: каталог экранов
 *  (логин/профиль/бой дня/реплей/онбординг/игра/utility) по 4 брейкпоинтам.
 *  Кадры статичные и на данных-заглушках: каждый рендерится в реальную ширину
 *  брейкпоинта и ужимается `scale()` (см. `screens/frameset.ts`), поэтому layout
 *  внутри переключается пропом `variant`, а не Tailwind-префиксами `md:`/`lg:` —
 *  те читали бы фактическую ширину окна, а не ширину кадра. */
export function ScreensSection() {
    return (
        <div className="flex min-w-0 flex-col gap-8">
            <p className="max-w-prose text-caption text-text-muted">
                Каждый экран — резиновый layout в кадрах{' '}
                {BREAKPOINTS.map((bp, i) => (
                    <span key={bp}>
                        <b className="text-text">{bp}</b>
                        {i < BREAKPOINTS.length - 1 ? ' / ' : ''}
                    </span>
                ))}
                . Планшет — первоклассная цель: одноколоночный мобайл раскрывается в 2 колонки. Wide
                = десктоп с max-width, контент по центру.
            </p>
            <ScreensCatalog />
        </div>
    );
}
