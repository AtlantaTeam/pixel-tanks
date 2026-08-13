'use client';

import { useEffect, useRef } from 'react';
import { floor, getDevicePixelRatio, toDevicePixels } from '@/shared/lib/canvas';
import { prefersReducedMotion } from '../../lib/prefers-reduced-motion';
import { SkyScene, type TSkyImages } from '../../lib/sky-scene';
import type { TSkyPresetId } from '../../lib/sky-preset';

/** Пути арта неба (файлы в `public/art/`, коммитятся человеком — #478). */
const SKY_ASSET_PATHS: Record<keyof TSkyImages, string> = {
    mountains: '/art/mountains.png',
    far: '/art/clouds-far.png',
    near: '/art/clouds-near.png',
};

/**
 * Модульный кеш арта неба: элементы `Image` живут между инстансами (витрина
 * показывает три сцены разом — грузим спрайты один раз). Каждый инстанс
 * подписывается на догрузку через `listeners`, чтобы перерисоваться, когда
 * спрайт долетел после первого кадра.
 */
const skyImages: TSkyImages = {};
const loadListeners = new Set<() => void>();
let loadStarted = false;
let loadedCount = 0;

const ensureSkyImagesLoaded = () => {
    if (loadStarted || typeof Image === 'undefined') return;
    loadStarted = true;
    const entries = Object.entries(SKY_ASSET_PATHS) as [keyof TSkyImages, string][];
    for (const [key, src] of entries) {
        const img = new Image();
        img.onload = () => {
            loadedCount += 1;
            loadListeners.forEach((cb) => cb());
        };
        img.src = src;
        skyImages[key] = img;
    }
};

const allSkyImagesLoaded = () => loadedCount >= Object.keys(SKY_ASSET_PATHS).length;

type TSkyBackgroundProps = {
    /** Сид боя: тот же сид — тот же пресет и то же положение облаков на старте. */
    seed: number | string | null | undefined;
    /** Явный пресет — для витрины `/design-system`. */
    preset?: TSkyPresetId;
    /**
     * Override `prefers-reduced-motion` — только для витрины/тестов. По умолчанию
     * читается из системной настройки.
     */
    reducedMotion?: boolean;
    className?: string;
};

/**
 * Фоновый слой неба под игровым канвасом: градиент → дальние горы → параллакс
 * облаков. Отдельный `<canvas>` за игровым (тот прозрачен: его `clearRect`
 * открывает это небо вместо чёрного). Свой rAF-цикл двигает лишь смещения слоёв;
 * статичный фон перестраивается только при ресайзе (`SkyScene`).
 */
export const SkyBackground = ({ seed, preset, reducedMotion, className }: TSkyBackgroundProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        // Нет 2D-контекста (happy-dom/SSR) — тихо выходим, фон не рисуем.
        if (!ctx) return;

        ensureSkyImagesLoaded();
        const reduced = reducedMotion ?? prefersReducedMotion();
        const resolvedSeed = seed ?? 'default';
        const scene = new SkyScene({
            seed: resolvedSeed,
            reducedMotion: reduced,
            preset,
            images: skyImages,
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
            scene.update(dt);
            scene.draw(ctx);
            // reduced-motion: облака стоят — после загрузки арта цикл можно
            // остановить, кадр не гоняется зря. Пока арт грузится, крутим, чтобы
            // догруженные спрайты появились.
            if (reduced && allSkyImagesLoaded()) return;
            rafId = requestAnimationFrame(frame);
        };

        // Догрузка спрайта после остановки (reduced-motion) — один добор кадра.
        const redraw = () => {
            if (disposed) return;
            scene.draw(ctx);
        };
        loadListeners.add(redraw);

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
            loadListeners.delete(redraw);
            observer?.disconnect();
        };
    }, [seed, preset, reducedMotion]);

    return (
        <canvas
            ref={canvasRef}
            aria-hidden
            className={`pointer-events-none block h-full w-full ${className ?? ''}`}
        />
    );
};
