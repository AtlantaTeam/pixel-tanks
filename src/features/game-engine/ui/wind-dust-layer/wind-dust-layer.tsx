'use client';

import { useEffect, useRef } from 'react';
import { floor, getDevicePixelRatio, toDevicePixels } from '@/shared/lib/canvas';
import { prefersReducedMotion } from '../../lib/prefers-reduced-motion';
import { pickSkyPreset } from '../../lib/sky-preset';
import { WindDust } from '../../lib/wind-dust-scene';

type TWindDustLayerProps = {
    /** Сид боя: та же раскладка пылинок и тот же ночной пресет, что у неба (#550). */
    seed: number | string | null | undefined;
    /** Ветер боя (`game.store.wind`): пылинки летят по нему, при 0 — их нет. */
    wind: number;
    /** Override `prefers-reduced-motion` — только для витрины/тестов. */
    reducedMotion?: boolean;
    className?: string;
};

/**
 * Слой ветровых пылинок приземного слоя (#550, §7 разбора #534): «дешёвый носитель»
 * ветра рядом с ареной, куда и так смотрит взгляд во время прицеливания — не только
 * цифра в ячейке «Ветер» наверху HUD. Отдельный `<canvas>` над игровым, тот же паттерн,
 * что `PrecipitationLayer` (#546): свой rAF с полной очисткой кадра не задевает
 * dirty-rect оптимизацию игрового канваса.
 *
 * Ночью (пресет неба `night`, тот же сид, что у `SkyBackground`) пылинки плохо читаются
 * на тёмном фоне — вместо них `WindDust` рисует подсветку кромки песка (см.
 * `wind-dust-scene.ts`), не отдельные частицы.
 */
export const WindDustLayer = ({ seed, wind, reducedMotion, className }: TWindDustLayerProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        // Нет 2D-контекста (happy-dom/SSR) — тихо выходим, слой не рисуем.
        if (!ctx) return;

        const reduced = reducedMotion ?? prefersReducedMotion();
        const resolvedSeed = seed ?? 'default';
        const isNight = pickSkyPreset(resolvedSeed).id === 'night';
        const scene = new WindDust({ seed: resolvedSeed, wind, isNight, reducedMotion: reduced });

        let rafId = 0;
        let lastTs = 0;
        let disposed = false;

        const fit = () => {
            const dpr = getDevicePixelRatio();
            const rect = canvas.getBoundingClientRect();
            const cssWidth = floor(rect.width || canvas.offsetWidth);
            const cssHeight = floor(rect.height || canvas.offsetHeight);
            if (cssWidth <= 0 || cssHeight <= 0) return;
            const backingWidth = toDevicePixels(cssWidth, dpr);
            const backingHeight = toDevicePixels(cssHeight, dpr);
            if (canvas.width !== backingWidth) canvas.width = backingWidth;
            if (canvas.height !== backingHeight) canvas.height = backingHeight;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            scene.resize(cssWidth, cssHeight);
        };

        const frame = (ts: number) => {
            if (disposed) return;
            const dt = lastTs ? ts - lastTs : 0;
            lastTs = ts;
            scene.update(dt);
            scene.draw(ctx);
            // reduced-motion: движения нет — после первого кадра петля не нужна.
            if (reduced) return;
            rafId = requestAnimationFrame(frame);
        };

        fit();
        rafId = requestAnimationFrame(frame);

        const observer =
            typeof ResizeObserver !== 'undefined'
                ? new ResizeObserver(() => {
                      fit();
                      scene.draw(ctx);
                  })
                : undefined;
        observer?.observe(canvas);

        return () => {
            disposed = true;
            cancelAnimationFrame(rafId);
            observer?.disconnect();
        };
    }, [seed, wind, reducedMotion]);

    return (
        <canvas
            ref={canvasRef}
            aria-hidden
            className={`pointer-events-none block h-full w-full ${className ?? ''}`}
        />
    );
};
