import { clsx } from 'clsx';
import type { TTankSkin } from '../../t-tank-skin';

type TTankSkinPreviewProps = {
    skin: TTankSkin;
    className?: string;
};

/**
 * Статичное превью скина (корпус + ствол) для пикера настроек и витрины
 * `/design-system` — issue #481. Inline SVG (не канвас): та же строка
 * геометрии, что уходит в кэш отрисовки (`lib/tank-skin-image-cache.ts`),
 * только без подстановки в `data:` URL — здесь она безопасно вставляется как
 * разметка (`dangerouslySetInnerHTML`), потому что палитра берётся из
 * фиксированного реестра (`tank-skins.data.ts`), а не от пользовательского ввода.
 */
export function TankSkinPreview({ skin, className }: TTankSkinPreviewProps) {
    const hullSvg = skin.geometry.buildHullSvg(skin.palette);
    const barrelSvg = skin.geometry.buildBarrelSvg(skin.palette);

    return (
        <div className={clsx('relative aspect-[2/1]', className)}>
            <div
                className="absolute inset-0 [&>svg]:h-full [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: hullSvg }}
            />
            <div
                className="absolute top-[20%] left-[36%] w-[58%] [&>svg]:h-full [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: barrelSvg }}
            />
        </div>
    );
}
