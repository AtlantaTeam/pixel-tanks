'use client';

import { useEffect, useRef } from 'react';
import { getTankSkinById, loadTankSkinImages, type TTankSkinId } from '@/entities/tank-skins';
import { ENGINE_COLORS } from '../../lib/engine-palette';
import { drawTankWheels, wheelRotationDelta } from '../../lib/tank';
import { prefersReducedMotion } from '../../lib/prefers-reduced-motion';

export type TTankWheelDemoProps = {
    skinId: TTankSkinId;
    /** `false` — танк неподвижен (демо «на месте»), `true` — едет туда-сюда (issue #496). */
    moving: boolean;
};

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
 * Угол катков считается от пройденного пути (`wheelRotationDelta`), не от
 * времени кадра — тот же инвариант, что у `Tank.move`: `prefers-reduced-motion`
 * останавливает и позицию, и вращение (см. критерий готовности).
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
            const distance = direction * SPEED_PX_PER_SEC * dtSec;
            x = Math.min(Math.max(x + distance, 0), CANVAS_WIDTH - TANK_WIDTH);
            rotation += wheelRotationDelta(distance, wheelRadiusPx);
            if (x <= 0 || x >= CANVAS_WIDTH - TANK_WIDTH) direction *= -1;
            draw();
            rafId = requestAnimationFrame(loop);
        };

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
        };
    }, [skinId, moving]);

    return (
        <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            className="w-full"
            aria-hidden
        />
    );
}
