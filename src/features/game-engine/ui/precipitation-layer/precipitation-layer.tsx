'use client';

import { useEffect, useRef } from 'react';
import { floor, getDevicePixelRatio, toDevicePixels } from '@/shared/lib/canvas';
import { prefersReducedMotion } from '../../lib/prefers-reduced-motion';
import { Precipitation } from '../../lib/precipitation-scene';
import type { TPrecipPresetId } from '../../lib/precipitation';

type TPrecipitationLayerProps = {
    /** Сид боя: тот же сид — тот же погодный пресет и та же раскладка частиц. */
    seed: number | string | null | undefined;
    /** Ветер боя (`game.store.wind`): частицы сносит по нему (#546). Постоянен весь бой. */
    wind?: number;
    /** Явный пресет — для витрины `/design-system`. */
    preset?: TPrecipPresetId;
    /**
     * Гашение на прицеливании: при активной оттяжке (`gestureVisual !== null`) частицы
     * уходят до ~30% альфы — тот же сигнал и приём, что у чат-бабла бота (#527).
     */
    dimmed?: boolean;
    /**
     * Единичный статичный кадр на этом времени сцены (мс) вместо rAF-петли — для витрины:
     * снапшот с частицами детерминирован и не флейкает визуальную регрессию.
     */
    snapshotMs?: number;
    /**
     * Override `prefers-reduced-motion` — только для витрины/тестов. По умолчанию читается
     * из системной настройки.
     */
    reducedMotion?: boolean;
    className?: string;
};

/**
 * Слой осадков над ареной (#546, §7.7): отдельный `<canvas>` поверх игрового. Свой rAF
 * с полной очисткой кадра не задевает dirty-rect оптимизацию игрового канваса — прямой
 * ответ на риск FPS из разбора. Слой прозрачен и не ловит указатель (`pointer-events-none`).
 *
 * При `prefers-reduced-motion` частиц нет (правило 3 разбора): движения на арене, где
 * игрок ведёт палец, быть не должно. В этом режиме кадр рисуется один раз (буря — дымка,
 * дождь/снег — пусто, погоду несёт тонировка рельефа от `Ground`) и петля встаёт.
 */
export const PrecipitationLayer = ({
    seed,
    wind,
    preset,
    dimmed = false,
    snapshotMs,
    reducedMotion,
    className,
}: TPrecipitationLayerProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    // Гашение меняется на каждом pointermove — держим в ref, чтобы кадровый цикл читал
    // свежее значение, не перезапуская сцену (иначе поле частиц пересобиралось бы).
    const dimmedRef = useRef(dimmed);
    useEffect(() => {
        dimmedRef.current = dimmed;
    }, [dimmed]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        // Нет 2D-контекста (happy-dom/SSR) — тихо выходим, слой не рисуем.
        if (!ctx) return;

        const reduced = reducedMotion ?? prefersReducedMotion();
        const resolvedSeed = seed ?? 'default';
        const scene = new Precipitation({
            seed: resolvedSeed,
            wind,
            reducedMotion: reduced,
            preset,
        });

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
            scene.setDimmed(dimmedRef.current);
            scene.update(dt);
            scene.draw(ctx);
            // reduced-motion: частиц нет — после первого кадра петля не нужна.
            if (reduced) return;
            rafId = requestAnimationFrame(frame);
        };

        fit();

        // Витрина: единичный статичный кадр на заданном времени — без rAF-петли, чтобы
        // снапшот визуальной регрессии был детерминирован.
        if (snapshotMs !== undefined) {
            scene.setDimmed(dimmedRef.current);
            scene.update(snapshotMs);
            scene.draw(ctx);
        } else {
            rafId = requestAnimationFrame(frame);
        }

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
    }, [seed, wind, preset, reducedMotion, snapshotMs]);

    return (
        <canvas
            ref={canvasRef}
            aria-hidden
            className={`pointer-events-none block h-full w-full ${className ?? ''}`}
        />
    );
};
