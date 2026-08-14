'use client';

import { useEffect, useState } from 'react';
import { useGameStore, windDirection } from '@/features/game-engine';
import { Toast } from '@/shared/ui';

/** Сколько плашка смены ветра держится на экране, мс (#547). Событие, не постоянный HUD. */
export const WIND_SHIFT_BANNER_DURATION_MS = 4500;

/**
 * Один показ плашки (#547): монтируется видимой и сам гаснет через таймер. Живёт
 * ровно одну смену ветра — внешний `WindShiftBanner` пересоздаёт его по `key={nonce}`,
 * поэтому таймер и видимость чистые для каждой смены, а состояние не нужно сбрасывать
 * вручную (сброс делает смена ключа). Начальная видимость — стартовое состояние, не
 * `setState` в эффекте: эффект только ставит таймер гашения.
 */
function WindShiftBannerInstance({ wind }: { wind: number }) {
    const [visible, setVisible] = useState(true);

    useEffect(() => {
        const timer = setTimeout(() => setVisible(false), WIND_SHIFT_BANNER_DURATION_MS);
        return () => clearTimeout(timer);
    }, []);

    if (!visible) return null;

    const message =
        windDirection(wind) === 'left'
            ? 'Буря сменила ветер — теперь влево ←'
            : 'Буря сменила ветер — теперь вправо →';

    return (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-20 flex -translate-y-1/2 justify-center px-2.5">
            <Toast variant="warning" message={message} className="max-w-sm" />
        </div>
    );
}

/**
 * Плашка «буря сменила ветер» (#547, §7.8 разбора #534): собственный слой поверх
 * арены, как `AmmoEmptyToast`. Показывается РОВНО в момент смены ветра бурей —
 * движок дёргает `announceWindShift` через `onWindChange`, счётчик `windShiftNonce`
 * растёт, и по нему монтируется новый показ (`key={nonce}`). Смена ветра посреди боя
 * обязана быть видимым событием, иначе читается как баг (§7.8) — это и есть критерий
 * #547 «в HUD видно, что ветер изменился, в момент изменения». Значение ветра в
 * ячейке «Ветер» верхнего HUD обновляется параллельно (`setWind`), так что игрок
 * видит и факт смены, и новую цифру.
 *
 * `nonce === 0` (до смены / новый бой) — плашки нет. По центру арены и
 * `pointer-events-none`, чтобы событие поймал взгляд, но целиться сквозь него не мешало.
 */
export function WindShiftBanner() {
    const nonce = useGameStore((s) => s.windShiftNonce);
    const wind = useGameStore((s) => s.wind);

    if (nonce === 0) return null;
    return <WindShiftBannerInstance key={nonce} wind={wind} />;
}
