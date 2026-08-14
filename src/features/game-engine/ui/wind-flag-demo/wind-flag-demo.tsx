'use client';

import { useEffect, useRef } from 'react';
import { getDevicePixelRatio, toDevicePixels } from '@/shared/lib/canvas';
import { createSeededRandom } from '@/shared/lib/random';
import {
    DEFAULT_TANK_SKIN_ID,
    getTankSkinById,
    loadTankSkinImages,
    type TTankSkinId,
} from '@/entities/tank-skins';
import { GAME_ASSET_PATHS } from '../../lib/game-play';
import { Ground } from '../../lib/ground';
import { Tank } from '../../lib/tank';
import { windFlagRotationRad } from '../../lib/wind-flag';
import { WORLD_UNITS } from '../../lib/world-scale';

export type TWindFlagDemoProps = {
    /** Ветер боя (поле `wind` движка): знак — направление, модуль — сила. */
    wind: number;
    skinId?: TTankSkinId;
    /** Слой поверх неба секции — как у `WindDustLayer`: `absolute inset-0`. */
    className?: string;
};

/** Логическая система координат демо (CSS-пиксели); в неё же вписан бэкинг-стор. */
const CANVAS_WIDTH = 180;
const CANVAS_HEIGHT = 116;
/** Высота поверхности песка над низом канваса. */
const GROUND_HEIGHT = 24;
/**
 * Масштаб мира десктопного кадра (арена ≈1280 px) — ровно тот, на котором флажок
 * замеряли на проде (#579): витрина показывает пиксели боя, а не свои.
 */
const DEMO_SCALE = 1.28;
/** Ствол чуть вверх — не заслоняет мачту и читается как боевая поза. */
const BARREL_ANGLE = -Math.PI / 7;

/**
 * Демо флажка ветра (#579, форма вымпела) — витрина `/design-system`. Рисует НЕ свою
 * копию флага, а настоящий `Tank.draw` на плоском рельефе: расхождение витрины с боем
 * исключено общим кодом, как у `TankWheelDemo`. Кадр статичен (ни ветра-анимации, ни
 * rAF) — витрина служит мишенью визуальной регрессии.
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
        let cancelled = false;
        let redraw = () => {};

        // Бэкинг-стор под CSS-размер и dpr (правило `canvas.md`): логические
        // CANVAS_WIDTH×CANVAS_HEIGHT растягиваются на весь канвас, пиксели не мылятся.
        const fit = () => {
            const dpr = getDevicePixelRatio();
            const rect = canvas.getBoundingClientRect();
            const backingWidth = toDevicePixels(Math.round(rect.width || CANVAS_WIDTH), dpr);
            const backingHeight = toDevicePixels(Math.round(rect.height || CANVAS_HEIGHT), dpr);
            if (canvas.width !== backingWidth) canvas.width = backingWidth;
            if (canvas.height !== backingHeight) canvas.height = backingHeight;
            ctx.setTransform(
                backingWidth / CANVAS_WIDTH,
                0,
                0,
                backingHeight / CANVAS_HEIGHT,
                0,
                0,
            );
        };

        const sandImg = new Image();
        const sandLoaded = new Promise<void>((resolve) => {
            sandImg.onload = () => resolve();
            sandImg.onerror = () => resolve();
        });
        sandImg.src = GAME_ASSET_PATHS.sand;

        void Promise.all([loadTankSkinImages(skinId), sandLoaded]).then(([images]) => {
            if (cancelled) return;
            const ground = new Ground(CANVAS_WIDTH, CANVAS_HEIGHT, createSeededRandom(1), sandImg);
            // Плоская полоса: демо про флажок, а не про рельеф — наклон корпуса не
            // должен спорить с наклоном полотнища.
            ground.heights = new Array<number>(CANVAS_WIDTH).fill(GROUND_HEIGHT);
            const tank = new Tank(
                Math.round((CANVAS_WIDTH - WORLD_UNITS.tankWidth * DEMO_SCALE) / 2),
                CANVAS_HEIGHT - GROUND_HEIGHT,
                CANVAS_WIDTH,
                CANVAS_HEIGHT,
                BARREL_ANGLE,
                [],
                images.hull,
                images.barrel,
                DEMO_SCALE,
                images.wheel,
                getTankSkinById(skinId).geometry.wheels,
                false,
            );
            tank.windFlagRotationRad = windFlagRotationRad(wind);

            redraw = () => {
                ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
                ground.draw(ctx);
                tank.draw(ctx, null, ground);
            };
            redraw();
        });

        fit();
        const observer =
            typeof ResizeObserver !== 'undefined'
                ? new ResizeObserver(() => {
                      fit();
                      redraw();
                  })
                : undefined;
        observer?.observe(canvas);

        return () => {
            cancelled = true;
            observer?.disconnect();
        };
    }, [wind, skinId]);

    return (
        <canvas
            ref={canvasRef}
            className={`aspect-[180/116] w-full ${className ?? ''}`}
            aria-hidden
        />
    );
}
