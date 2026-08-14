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
    // Ветер боя МЕНЯЕТСЯ в середине боя (буря, #547) — и это не повод пересобирать сцену.
    // Пересборка вернула бы поле частиц к t=0 ровно в тот кадр, когда игрок читает плашку
    // «Буря сменила ветер»: осадки скачком телепортируются, вместо того чтобы сменить
    // наклон. Поэтому ветер живёт в ref (стартовое значение) и доносится сеттером —
    // тот же приём, что уже применён к `dimmed` выше.
    const windRef = useRef(wind);
    const sceneRef = useRef<Precipitation | null>(null);
    useEffect(() => {
        windRef.current = wind;
        sceneRef.current?.setWind(wind ?? 0);
    }, [wind]);

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
            wind: windRef.current,
            reducedMotion: reduced,
            preset,
        });
        sceneRef.current = scene;

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
            // Анимировать нечего (пресет «ясно» — ~60% боёв, либо reduced-motion) —
            // один кадр и выход, вместо холостого `clearRect` 60 раз в секунду.
            if (!scene.animated) return;
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
            sceneRef.current = null;
            cancelAnimationFrame(rafId);
            observer?.disconnect();
        };
    }, [seed, preset, reducedMotion, snapshotMs]);

    return (
        <canvas
            ref={canvasRef}
            aria-hidden
            className={`pointer-events-none block h-full w-full ${className ?? ''}`}
        />
    );
};
