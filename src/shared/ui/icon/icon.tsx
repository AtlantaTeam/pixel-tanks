import type { SVGAttributes } from 'react';

type TIconPrimitive =
    | { type: 'path'; d: string }
    | { type: 'rect'; x: number; y: number; width: number; height: number };

/** Набор 1:1 c docs/design-system-theming/design-inventory.dc.html (секция «07 — Иконки»):
 *  сетка 16×16, `d`/`rect` — координаты этой сетки, штрих 2px. Имена оружия (`wpn-*`) — на
 *  русском намеренно, они совпадают с канонiческими названиями из GDD (фугас/мощный/кластер/
 *  роющий), а не переведены. */
const ICON_PATHS = {
    play: [{ type: 'path', d: 'M4 3 L12 8 L4 13 Z' }],
    pause: [
        { type: 'rect', x: 4, y: 3, width: 3, height: 10 },
        { type: 'rect', x: 9, y: 3, width: 3, height: 10 },
    ],
    mute: [
        { type: 'path', d: 'M3 6 L6 6 L9 3 L9 13 L6 10 L3 10 Z' },
        { type: 'path', d: 'M11 6 L14 10 M14 6 L11 10' },
    ],
    sound: [
        { type: 'path', d: 'M3 6 L6 6 L9 3 L9 13 L6 10 L3 10 Z' },
        { type: 'path', d: 'M11 5 Q13 8 11 11' },
    ],
    share: [
        { type: 'rect', x: 11, y: 2, width: 3, height: 3 },
        { type: 'rect', x: 2, y: 7, width: 3, height: 3 },
        { type: 'rect', x: 11, y: 11, width: 3, height: 3 },
        { type: 'path', d: 'M11 4 L5 8 M5 9 L11 12' },
    ],
    replay: [
        { type: 'path', d: 'M13 8 A5 5 0 1 1 8 3' },
        { type: 'path', d: 'M8 1 L8 5 L11 3 Z' },
    ],
    'arrow-l': [{ type: 'path', d: 'M10 3 L5 8 L10 13' }],
    'arrow-r': [{ type: 'path', d: 'M6 3 L11 8 L6 13' }],
    'arrow-u': [{ type: 'path', d: 'M3 10 L8 5 L13 10' }],
    'arrow-d': [{ type: 'path', d: 'M3 6 L8 11 L13 6' }],
    target: [
        { type: 'rect', x: 7, y: 2, width: 2, height: 3 },
        { type: 'rect', x: 7, y: 11, width: 2, height: 3 },
        { type: 'rect', x: 2, y: 7, width: 3, height: 2 },
        { type: 'rect', x: 11, y: 7, width: 3, height: 2 },
        { type: 'rect', x: 7, y: 7, width: 2, height: 2 },
    ],
    settings: [
        { type: 'rect', x: 6, y: 1, width: 4, height: 2 },
        { type: 'rect', x: 6, y: 13, width: 4, height: 2 },
        { type: 'rect', x: 1, y: 6, width: 2, height: 4 },
        { type: 'rect', x: 13, y: 6, width: 2, height: 4 },
        { type: 'rect', x: 5, y: 5, width: 6, height: 6 },
    ],
    fire: [{ type: 'path', d: 'M8 2 L11 7 L9 7 L11 11 L5 11 L7 7 L5 7 Z' }],
    star: [{ type: 'path', d: 'M8 1 L10 6 L15 6 L11 9 L12 14 L8 11 L4 14 L5 9 L1 6 L6 6 Z' }],
    skull: [
        { type: 'path', d: 'M4 3 H12 V10 H10 V13 H6 V10 H4 Z' },
        { type: 'rect', x: 5, y: 5, width: 2, height: 2 },
        { type: 'rect', x: 9, y: 5, width: 2, height: 2 },
        { type: 'rect', x: 7, y: 8, width: 2, height: 2 },
    ],
    check: [{ type: 'path', d: 'M3 8 L7 12 L13 4' }],
    close: [{ type: 'path', d: 'M4 4 L12 12 M12 4 L4 12' }],
    clock: [
        { type: 'path', d: 'M8 2 A6 6 0 1 1 8 14 A6 6 0 1 1 8 2' },
        { type: 'path', d: 'M8 5 L8 8 L10 10' },
    ],
    warning: [
        { type: 'path', d: 'M8 2 L14 13 L2 13 Z' },
        { type: 'rect', x: 7, y: 6, width: 2, height: 3 },
        { type: 'rect', x: 7, y: 10, width: 2, height: 2 },
    ],
    edit: [{ type: 'path', d: 'M3 11 L10 4 L12 6 L5 13 L3 13 Z' }],
    info: [
        { type: 'path', d: 'M8 2 A6 6 0 1 1 8 14 A6 6 0 1 1 8 2' },
        { type: 'rect', x: 7, y: 5, width: 2, height: 2 },
        { type: 'rect', x: 7, y: 8, width: 2, height: 4 },
    ],
    wind: [
        { type: 'path', d: 'M2 6 H10 A2 2 0 1 0 8 4' },
        { type: 'path', d: 'M2 10 H12 A2 2 0 1 1 10 12' },
    ],
    lock: [
        { type: 'path', d: 'M5 7 V5 A3 3 0 0 1 11 5 V7' },
        { type: 'rect', x: 4, y: 7, width: 8, height: 7 },
    ],
    'wpn-фугас': [
        { type: 'rect', x: 6, y: 4, width: 4, height: 8 },
        { type: 'path', d: 'M6 4 L8 1 L10 4' },
    ],
    'wpn-мощный': [{ type: 'path', d: 'M8 1 V15 M1 8 H15 M4 4 L12 12 M12 4 L4 12' }],
    'wpn-кластер': [
        { type: 'rect', x: 3, y: 3, width: 3, height: 3 },
        { type: 'rect', x: 10, y: 3, width: 3, height: 3 },
        { type: 'rect', x: 6, y: 8, width: 3, height: 3 },
        { type: 'rect', x: 3, y: 11, width: 2, height: 2 },
        { type: 'rect', x: 11, y: 11, width: 2, height: 2 },
    ],
    'wpn-роющий': [
        { type: 'path', d: 'M8 1 V9 M5 6 L8 9 L11 6' },
        { type: 'rect', x: 2, y: 12, width: 12, height: 2 },
    ],
    eye: [
        { type: 'path', d: 'M1 8 Q8 2 15 8 Q8 14 1 8 Z' },
        { type: 'rect', x: 6, y: 6, width: 4, height: 4 },
    ],
    'eye-off': [
        { type: 'path', d: 'M1 8 Q8 2 15 8 Q8 14 1 8 Z' },
        { type: 'rect', x: 6, y: 6, width: 4, height: 4 },
        { type: 'path', d: 'M2 2 L14 14' },
    ],
} as const satisfies Record<string, TIconPrimitive[]>;

export type TIconName = keyof typeof ICON_PATHS;

export const ICON_NAMES = Object.keys(ICON_PATHS) as TIconName[];

type TIconProps = Omit<SVGAttributes<SVGSVGElement>, 'viewBox' | 'children'> & {
    name: TIconName;
    size?: number;
};

/** SVG на сетке 16×16 из design-inventory.dc.html (§07). `currentColor` — цвет наследуется от
 *  текста, поэтому иконка меняется вместе с темой/фракцией без своего варианта. По умолчанию
 *  декоративная (`aria-hidden`); передай `aria-label`, если иконка несёт смысл сама по себе
 *  (например, единственное содержимое кнопки). */
export function Icon({ name, size = 24, className, ...props }: TIconProps) {
    const isDecorative = props['aria-label'] == null && props['aria-labelledby'] == null;

    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 16 16"
            shapeRendering="crispEdges"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            role={isDecorative ? undefined : 'img'}
            aria-hidden={isDecorative ? true : undefined}
            className={className}
            {...props}
        >
            {ICON_PATHS[name].map((primitive, index) =>
                primitive.type === 'rect' ? (
                    <rect
                        key={index}
                        x={primitive.x}
                        y={primitive.y}
                        width={primitive.width}
                        height={primitive.height}
                        fill="currentColor"
                        stroke="none"
                    />
                ) : (
                    <path key={index} d={primitive.d} />
                ),
            )}
        </svg>
    );
}
