import type { ReactNode } from 'react';
import type { TScreenFrame } from './frameset';

type TScreenFrameProps = {
    frame: TScreenFrame;
    children: ReactNode;
};

/** design-inventory.dc.html §11: бокс превью размером dispW×dispH, внутри —
 *  контейнер в полную ширину брейкпоинта, ужатый `scale()` от верхнего левого угла.
 *  Кадр не скроллится: всё, что не влезло в 720px высоты, обрезается — как в инвентаре. */
export function ScreenFrame({ frame, children }: TScreenFrameProps) {
    return (
        <div className="flex flex-col gap-2">
            <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                {frame.label}
            </span>
            <div
                className="overflow-hidden border-[length:var(--border-w-thick)] border-border-strong bg-bg shadow-[var(--shadow-drop)]"
                style={{ width: frame.dispW, height: frame.dispH }}
            >
                <div
                    style={{
                        width: frame.w,
                        height: frame.h,
                        transform: `scale(${frame.scale})`,
                        transformOrigin: 'top left',
                    }}
                >
                    {children}
                </div>
            </div>
        </div>
    );
}
