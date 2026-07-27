const BREAKPOINTS = ['390 · Mobile', '768 · Планшет', '1280 · Desktop', '1920 · Wide'];

/** design-inventory.dc.html §11 «Поток · все брейкпоинты»: каталог экранов
 *  (логин/профиль/бой дня/реплей/онбординг/игра/utility) по 4 брейкпоинтам.
 *  Сами кадры экранов — отдельная задача каталогизации данных-заглушек
 *  (см. milestone «Верстка ДС ralph · Фаза 7»); здесь — контейнер секции и
 *  легенда брейкпоинтов, чтобы нумерация 01–13 витрины совпадала с инвентарём. */
export function ScreensSection() {
    return (
        <div className="flex flex-col gap-4">
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
            <p className="font-ui text-label text-text-dim">
                Каталог кадров (логин · профиль · бой дня · реплей · онбординг · игра · utility) —
                следующая карточка этой фазы.
            </p>
        </div>
    );
}
