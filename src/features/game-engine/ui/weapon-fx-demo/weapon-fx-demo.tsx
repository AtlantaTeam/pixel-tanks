'use client';

import { useEffect, useRef } from 'react';
import { getDevicePixelRatio, toDevicePixels } from '@/shared/lib/canvas';
import { EWeaponKind } from '@/shared/model';
import { ENGINE_COLORS } from '../../lib/engine-palette';
import { paintExplosionFocus, weaponSpecFor } from '../../lib/weapon-specs';
import { prefersReducedMotion } from '../../lib/prefers-reduced-motion';

export type TWeaponFxDemoProps = {
    /** Тип оружия — его снаряд и взрыв рисуются числами и палитрой из `WEAPON_SPECS`. */
    kind: EWeaponKind;
};

/** Логическая система координат демо (CSS-пиксели); в неё вписан бэкинг-стор. */
const CANVAS_WIDTH = 260;
const CANVAS_HEIGHT = 150;
const GROUND_Y = 122;
/** Базовый радиус взрыва демо (аналог `WORLD_UNITS.explosionMaxRadius`, но под размер витрины). */
const BASE_RADIUS = 26;
/** Точка попадания (центр очага 0) и старт снаряда. */
const IMPACT_X = 168;
const START_X = 30;
const START_Y = 34;
/** Кадров на фазу полёта и на паузу перед повтором. */
const FLIGHT_FRAMES = 46;
const HOLD_FRAMES = 26;
/** Размер квадрата снаряда в демо (× `bulletSizeFactor` типа). */
const BULLET_UNIT = 5;

/**
 * Витрина снаряда и взрыва одного типа оружия (issue #483): снаряд летит дугой,
 * затем отыгрывается взрыв — те же числа и палитра `WEAPON_SPECS`, тот же примитив
 * кадра взрыва `paintExplosionFocus`, что и в бою (`Bullet.drawExplosion`), поэтому
 * витрина не расходится с реальным видом. Кластер показывает три очага подряд,
 * мощный — ударную волну по фронту, роющий — палитру грунта.
 *
 * Не полноценный `GamePlay`: рельеф/физика тут не нужны, только визуал fx на плоской
 * полосе. Бэкинг-стор подгоняется под dpr (правило `canvas.md`), ресайз — через
 * `ResizeObserver` (канвас резиновый). `prefers-reduced-motion` замораживает кадр.
 */
export function WeaponFxDemo({ kind }: TWeaponFxDemoProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        const spec = weaponSpecFor(kind);
        const animate = !prefersReducedMotion();

        // Абсолютные центры очагов взрыва: смещение в долях базового радиуса (кластер).
        const foci = spec.foci.map((focus) => ({
            x: IMPACT_X + focus.dxFactor * BASE_RADIUS,
            maxRadius: focus.radiusFactor * BASE_RADIUS,
        }));

        let phase: 'flight' | 'explode' | 'hold' = 'flight';
        let flightFrame = 0;
        let focusIndex = 0;
        let radius = 0;
        let holdFrame = 0;
        let rafId = 0;
        let cancelled = false;

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

        const bulletPos = (t: number) => ({
            x: START_X + (IMPACT_X - START_X) * t,
            // Дуга: линейный спуск к земле плюс подъём синусом в середине пути.
            y: START_Y + (GROUND_Y - START_Y) * t - 26 * Math.sin(Math.PI * t),
        });

        const drawScene = () => {
            ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
            ctx.strokeStyle = ENGINE_COLORS.borderStrong;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, GROUND_Y);
            ctx.lineTo(CANVAS_WIDTH, GROUND_Y);
            ctx.stroke();
        };

        const drawBullet = (t: number) => {
            const { x, y } = bulletPos(t);
            const size = BULLET_UNIT * spec.bulletSizeFactor;
            ctx.fillStyle = spec.bulletColor ?? '#000000';
            ctx.fillRect(x - size / 2, y - size / 2, size, size);
        };

        // Статичный кадр для reduced-motion: снаряд на подлёте + очаг 0 на ~55% роста.
        const drawStaticFrame = () => {
            drawScene();
            drawBullet(0.42);
            paintExplosionFocus(
                ctx,
                foci[0].x,
                GROUND_Y - foci[0].maxRadius * 0.2,
                foci[0].maxRadius * 0.55,
                spec.colors,
                spec.shockwave,
            );
        };

        const loop = () => {
            if (cancelled) return;
            drawScene();
            if (phase === 'flight') {
                drawBullet(flightFrame / FLIGHT_FRAMES);
                flightFrame += 1;
                if (flightFrame >= FLIGHT_FRAMES) {
                    phase = 'explode';
                    focusIndex = 0;
                    radius = 0;
                }
            } else if (phase === 'explode') {
                const focus = foci[focusIndex];
                paintExplosionFocus(
                    ctx,
                    focus.x,
                    GROUND_Y - focus.maxRadius * 0.2,
                    radius,
                    spec.colors,
                    spec.shockwave,
                );
                radius += spec.growthPerFrame;
                if (radius >= focus.maxRadius) {
                    radius = 0;
                    focusIndex += 1;
                    if (focusIndex >= foci.length) {
                        phase = 'hold';
                        holdFrame = 0;
                    }
                }
            } else {
                holdFrame += 1;
                if (holdFrame >= HOLD_FRAMES) {
                    phase = 'flight';
                    flightFrame = 0;
                }
            }
            rafId = requestAnimationFrame(loop);
        };

        fit();
        const observer =
            typeof ResizeObserver !== 'undefined'
                ? new ResizeObserver(() => {
                      fit();
                      if (!animate) drawStaticFrame();
                  })
                : undefined;
        observer?.observe(canvas);

        if (animate) {
            rafId = requestAnimationFrame(loop);
        } else {
            drawStaticFrame();
        }

        return () => {
            cancelled = true;
            cancelAnimationFrame(rafId);
            observer?.disconnect();
        };
    }, [kind]);

    return <canvas ref={canvasRef} className="aspect-[260/150] w-full" aria-hidden />;
}
