'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatedValue, type TAnimatedValueOptions } from './animated-value';

/**
 * HUD-число, плавно догоняющее `target` вместо мгновенного скачка при смене
 * значения в сторе. Логика перехода — в AnimatedValue (чистая, тестируемая),
 * хук лишь крутит requestAnimationFrame, пока переход активен.
 */
export function useAnimatedValue(target: number, options?: TAnimatedValueOptions): number {
    const animatedRef = useRef<AnimatedValue | null>(null);
    animatedRef.current ??= new AnimatedValue(target, options);

    const [display, setDisplay] = useState(target);

    useEffect(() => {
        const animated = animatedRef.current;
        if (!animated) return;
        animated.setTarget(target);
        if (!animated.isActive()) return;

        let rafId: number;
        let lastTs = performance.now();
        const tick = (now: number) => {
            const dt = now - lastTs;
            lastTs = now;
            setDisplay(animated.update(dt));
            if (animated.isActive()) {
                rafId = requestAnimationFrame(tick);
            }
        };
        rafId = requestAnimationFrame(tick);

        return () => cancelAnimationFrame(rafId);
    }, [target]);

    return display;
}
