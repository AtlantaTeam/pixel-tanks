'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import { clsx } from 'clsx';
import { usePrefersReducedMotion } from '@/shared/lib/animation';
import type { TSide } from '../../model/game.store';

/** Подъём и затухание числа урона, мс (handoff §7.2 разбора #534). */
const RISE_DURATION_MS = 400;
/** При prefers-reduced-motion число держится неподвижным дольше — движения нет,
 *  время на прочтение компенсирует отсутствие анимации. */
const REDUCED_MOTION_DURATION_MS = 800;

/** Цвет числа — по СТОРОНЕ попадания (не по тому, кто стрелял): задет игрок —
 *  danger, задет бот — warning (issue #549). */
const TARGET_COLOR: Record<TSide, string> = {
    player: 'var(--color-danger)',
    enemy: 'var(--color-warning)',
};

export type TDamageHit = {
    target: TSide;
    amount: number;
    x: number;
    y: number;
};

type TDamageNumberProps = {
    hit: TDamageHit;
    onExpire?: () => void;
    className?: string;
};

/** DOM-слой поверх Canvas: число урона над задетым танком (issue #549, §7.2
 *  разбора #534) — попадание должно читаться в месте события, а не только по
 *  панели HP, которая на широких экранах может быть на сотни пикселей выше.
 *  Якорится нижним краем на (x, y) — центр очага взрыва (`bullet.
 *  explosionCenterX/Y`), тот же приём, что у `ChatBubble` над танком бота. */
export function DamageNumber({ hit, onExpire, className }: TDamageNumberProps) {
    const reducedMotion = usePrefersReducedMotion();
    const durationMs = reducedMotion ? REDUCED_MOTION_DURATION_MS : RISE_DURATION_MS;

    // onExpire держим в ref по тому же мотиву, что и ChatBubble: инлайн-колбэк
    // родителя не должен пересоздавать таймер на каждый ре-рендер.
    const onExpireRef = useRef(onExpire);
    useEffect(() => {
        onExpireRef.current = onExpire;
    }, [onExpire]);

    useEffect(() => {
        const timer = setTimeout(() => onExpireRef.current?.(), durationMs);
        return () => clearTimeout(timer);
        // `hit` в deps намеренно (как `reply` у ChatBubble): новый объект
        // попадания — новый экземпляр, даже если координаты совпали с
        // предыдущим — перезапускает таймер жизни, а не досчитывает старый.
    }, [hit, durationMs]);

    return (
        <div
            aria-hidden="true"
            className={clsx(
                'pointer-events-none absolute -translate-x-1/2 -translate-y-full',
                className,
            )}
            style={{ left: hit.x, top: hit.y }}
        >
            <span
                className={clsx(
                    'block font-ui text-[20px] font-bold',
                    'animate-damage-rise motion-reduce:animate-none',
                )}
                style={{ color: TARGET_COLOR[hit.target] } as CSSProperties}
            >
                -{hit.amount}
            </span>
        </div>
    );
}
