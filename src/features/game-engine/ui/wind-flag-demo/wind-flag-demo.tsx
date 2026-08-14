'use client';

import { useEffect, useRef } from 'react';
import { getDevicePixelRatio, toDevicePixels } from '@/shared/lib/canvas';
import { DEFAULT_TANK_SKIN_ID, loadTankSkinImages, type TTankSkinId } from '@/entities/tank-skins';
import { GAME_ASSET_PATHS } from '../../lib/game-assets';
import { buildWindFlagScene, WIND_FLAG_DEMO_FRAME } from './build-wind-flag-scene';

export type TWindFlagDemoProps = {
    /** Ветер боя (поле `wind` движка): знак — направление, модуль — сила. */
    wind: number;
    skinId?: TTankSkinId;
    /** Класс канваса — позиционирование внутри карточки секции витрины. */
    className?: string;
};

/**
 * Демо флажка ветра (#579, форма вымпела) — витрина `/design-system`. Рисует НЕ свою
 * копию флага, а настоящий `Tank.draw` на плоском рельефе (сцену собирает чистая
 * `buildWindFlagScene`): расхождение витрины с боем исключено общим кодом, как у
 * `TankWheelDemo`. Кадр статичен (ни ветра-анимации, ни rAF) — витрина служит мишенью
 * визуальной регрессии.
 *
 * Канвас — РОВНО `180×116` CSS px, без растяжения на ширину карточки (ревью #579).
 * Раньше логический кадр натягивался на всю карточку и на 1440 давал коэффициент
 * ≈2.07 поверх масштаба мира: человек судил читаемость мелкого вымпела по картинке
 * вдвое крупнее боевой — то есть ровно тот дефект, ради которого правка и делалась,
 * на витрине был не виден. Теперь пиксель витрины = пиксель боя на арене 1280.
 *
 * Небо под канвасом рисует секция витрины (`SkyBackground` слоем ниже): читаемость
 * янтарного полотнища с тёмной обводкой проверяется на всех трёх пресетах — дневном
 * светлом, закатном оранжевом и ночном тёмном (критерий #579).
 */
export function WindFlagDemo({
    wind,
    skinId = DEFAULT_TANK_SKIN_ID,
    className,
}: TWindFlagDemoProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;
        const { width, height } = WIND_FLAG_DEMO_FRAME;
        let cancelled = false;

        // Бэкинг-стор под dpr (правило `canvas.md`): CSS-размер канваса равен
        // логическому кадру, поэтому трансформ — чистый dpr, без доп. увеличения.
        const dpr = getDevicePixelRatio();
        canvas.width = toDevicePixels(width, dpr);
        canvas.height = toDevicePixels(height, dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const sandImg = new Image();
        const sandLoaded = new Promise<void>((resolve) => {
            sandImg.onload = () => resolve();
            sandImg.onerror = () => resolve();
        });
        sandImg.src = GAME_ASSET_PATHS.sand;

        void Promise.all([loadTankSkinImages(skinId), sandLoaded]).then(([images]) => {
            if (cancelled) return;
            const { ground, tank } = buildWindFlagScene({ wind, skinId, images, sandImg });

            ctx.clearRect(0, 0, width, height);
            ground.draw(ctx);
            tank.draw(ctx, null, ground);
        });

        return () => {
            cancelled = true;
        };
    }, [wind, skinId]);

    return (
        <canvas
            ref={canvasRef}
            style={{ width: WIND_FLAG_DEMO_FRAME.width, height: WIND_FLAG_DEMO_FRAME.height }}
            className={className}
            aria-hidden
        />
    );
}
