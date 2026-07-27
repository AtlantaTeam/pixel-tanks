'use client';

import { useState } from 'react';
import { Button } from '@/shared/ui';
import { PauseOverlay } from '@/widgets/pause-overlay';

const noop = () => {};

/** design-inventory.dc.html §12 «Пауза / Настройки боя»: реальный виджет
 *  `PauseOverlay` (фаза 6, #342) — не дублируем его разметку на витрине.
 *  `Dialog` внутри виджета — `position: fixed` на весь viewport (модалка), поэтому
 *  держать его постоянно `open` на странице-каталоге сломало бы скролл/фокус
 *  остальных секций (10–13 стали бы недоступны под перманентным оверлеем).
 *  Открываем по кнопке — как и генерик-Dialog в §03. */
export function PauseSection() {
    const [open, setOpen] = useState(false);

    return (
        <div className="flex flex-col gap-4">
            <Button variant="primary" onClick={() => setOpen(true)}>
                Показать паузу
            </Button>
            <PauseOverlay
                open={open}
                onResume={() => setOpen(false)}
                onRestart={noop}
                onExitToMenu={noop}
            />
        </div>
    );
}
