'use client';

import { useEffect, useRef } from 'react';
import { getDevicePixelRatio, toDevicePixels } from '@/shared/lib/canvas';
import { getTankSkinById, loadTankSkinImages, type TTankSkinId } from '@/entities/tank-skins';
import { ENGINE_COLORS } from '../../lib/engine-palette';
import { drawTankWheels, wheelRotationDelta } from '../../lib/tank';
import { prefersReducedMotion } from '../../lib/prefers-reduced-motion';

export type TTankWheelDemoProps = {
    skinId: TTankSkinId;
    /** `false` — танк неподвижен (демо «на месте»), `true` — едет туда-сюда (issue #496). */
    moving: boolean;
};

/** Логическая система координат демо (CSS-пиксели); в неё же вписан бэкинг-стор. */
const CANVAS_WIDTH = 220;
const CANVAS_HEIGHT = 96;
const TANK_WIDTH = 120;
const TANK_HEIGHT = 56;
const GROUND_Y = 78;
/** Скорость самого демо (не катков — те считаются от пути, см. докблок ниже). */
const SPEED_PX_PER_SEC = 46;

/**
 * Демо вращения катков (issue #496, критерий «витрина показывает танк в движении
 * и в покое»). Не полноценный `GamePlay` — рельеф и физика тут не нужны, только
 * позиция корпуса на плоской полосе. Рисует ровно той же функцией, что и бой,
 * `drawTankWheels`, — совпадение с реальной анимацией гарантировано общим кодом,
 * не повторной вёрсткой трансформа.
 *
 * Угол катков считается от ФАКТИЧЕСКИ пройденного пути (`wheelRotationDelta` от
 * реального сдвига `x` после клэмпа границ), не от времени кадра — тот же
 * инвариант, что у `Tank.move`: у кромки катки не докручиваются на полный шаг,
 * а `prefers-reduced-motion` останавливает и позицию, и вращение.
 *
 * Бэкинг-стор подгоняется под CSS-размер и `devicePixelRatio` (правило
 * `canvas.md`, как `GamePlay.fit`): рисуем в логических 220×96, а `ctx`
 * масштабируется на dpr — катки и корпус не мылятся на ретине. Ресайз ловим
 * `ResizeObserver` (канвас резиновый — `w-full`).
 */
export function TankWheelDemo({ skinId, moving }: TTankWheelDemoProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        const wheels = getTankSkinById(skinId).geometry.wheels;
        const wheelRadiusPx = (wheels[0]?.r ?? 0) * TANK_WIDTH;
        const animate = moving && !prefersReducedMotion();

        let hullImg: HTMLImageElement | undefined;
        let wheelImg: HTMLImageElement | undefined;
        let x = (CANVAS_WIDTH - TANK_WIDTH) / 2;
        let direction = 1;
        let rotation = 0;
        let lastTs = 0;
        let rafId = 0;
        let cancelled = false;

        // Подгоняет бэкинг-стор под CSS-размер и dpr и ставит трансформ так, чтобы
        // логическая система 220×96 занимала весь канвас (масштаб включает dpr —
        // отдельного ctx.scale(dpr) не нужно). Присваивание width/height сбрасывает
        // контекст, поэтому меняем его только при реальном изменении размера.
        const fit = () => {
            const dpr = getDevicePixelRatio();
            const rect = canvas.getBoundingClientRect();
            const cssWidth = Math.round(rect.width || CANVAS_WIDTH);
            const cssHeight = Math.round(rect.height || CANVAS_HEIGHT);
            const backingWidth = toDevicePixels(cssWidth, dpr);
            const backingHeight = toDevicePixels(cssHeight, dpr);
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

        const draw = () => {
            ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
            ctx.strokeStyle = ENGINE_COLORS.borderStrong;
            ctx.beginPath();
            ctx.moveTo(0, GROUND_Y);
            ctx.lineTo(CANVAS_WIDTH, GROUND_Y);
            ctx.stroke();
            const body = { x, y: GROUND_Y - TANK_HEIGHT, width: TANK_WIDTH, height: TANK_HEIGHT };
            if (hullImg) ctx.drawImage(hullImg, body.x, body.y, body.width, body.height);
            drawTankWheels(ctx, wheelImg, wheels, body, rotation);
        };

        const loop = (ts: number) => {
            if (cancelled) return;
            const dtSec = Math.min(lastTs ? ts - lastTs : 0, 100) / 1000;
            lastTs = ts;
            const step = direction * SPEED_PX_PER_SEC * dtSec;
            const nextX = Math.min(Math.max(x + step, 0), CANVAS_WIDTH - TANK_WIDTH);
            // Угол — от РЕАЛЬНО применённого сдвига (после клэмпа), как Tank.move:
            // у кромки шаг короче, катки не должны докручиваться на полный `step`.
            rotation += wheelRotationDelta(nextX - x, wheelRadiusPx);
            x = nextX;
            if (x <= 0 || x >= CANVAS_WIDTH - TANK_WIDTH) direction *= -1;
            draw();
            rafId = requestAnimationFrame(loop);
        };

        fit();
        const observer =
            typeof ResizeObserver !== 'undefined'
                ? new ResizeObserver(() => {
                      fit();
                      // Статичный кадр после ресайза перерисовать вручную (rAF не идёт);
                      // анимация нарисует сама следующим кадром.
                      if (!animate) draw();
                  })
                : undefined;
        observer?.observe(canvas);

        void loadTankSkinImages(skinId).then((images) => {
            if (cancelled) return;
            hullImg = images.hull;
            wheelImg = images.wheel;
            draw();
            if (animate) rafId = requestAnimationFrame(loop);
        });

        return () => {
            cancelled = true;
            cancelAnimationFrame(rafId);
            observer?.disconnect();
        };
    }, [skinId, moving]);

    return <canvas ref={canvasRef} className="aspect-[220/96] w-full" aria-hidden />;
}
