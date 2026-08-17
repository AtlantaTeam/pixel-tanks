import { createSeededRandom } from '@/shared/lib/random';
import { getTankSkinById, type TTankSkinId } from '@/entities/tank-skins';
import { Ground } from '../../lib/ground';
import { Tank } from '../../lib/tank';
import { WORLD_UNITS } from '../../lib/world-scale';

/**
 * Геометрия демо-кадра флажка (#579). Логическая система — CSS-пиксели, и канвас
 * рисуется в неё ОДИН К ОДНОМУ (см. докблок `WindFlagDemo`): витрина обязана
 * показывать флажок ровно того размера, каким он виден в бою.
 */
export const WIND_FLAG_DEMO_FRAME = {
    /** Логическая ширина/высота кадра (CSS px). */
    width: 180,
    height: 116,
    /** Высота поверхности песка над низом кадра. */
    groundHeight: 24,
    /**
     * Масштаб мира десктопного кадра (арена ≈1280 px) — ровно тот, на котором
     * флажок замеряли на проде (#579).
     */
    scale: 1.28,
    /** Ствол чуть вверх — не заслоняет мачту и читается как боевая поза. */
    barrelAngle: -Math.PI / 7,
} as const;

export type TWindFlagSceneImages = {
    hull?: HTMLImageElement;
    barrel?: HTMLImageElement;
    wheel?: HTMLImageElement;
};

export type TWindFlagSceneOptions = {
    /** Ветер боя (поле `wind` движка): знак — направление, модуль — сила. */
    wind: number;
    skinId: TTankSkinId;
    images?: TWindFlagSceneImages;
    sandImg?: HTMLImageElement;
};

/**
 * Собирает сцену демо-кадра: плоский рельеф + танк со скином и выставленным по
 * модели флажком. Чистая функция без канваса (ревью #579) — так проверяемо
 * главное, ради чего демо существует: что флажок доехал до танка ИМЕННО из модели
 * ветра и что рельеф плоский (демо про флажок, а не про дюны).
 */
export function buildWindFlagScene({ wind, skinId, images = {}, sandImg }: TWindFlagSceneOptions): {
    ground: Ground;
    tank: Tank;
} {
    const { width, height, groundHeight, scale, barrelAngle } = WIND_FLAG_DEMO_FRAME;

    const ground = new Ground(width, height, createSeededRandom(1), sandImg);
    // Плоская полоса: наклон корпуса не должен спорить с наклоном полотнища.
    // Через `flatten`, а не присваиванием `heights` (ревью #579): метод помечает
    // offscreen-слой грязным, прямая мутация поля шла мимо инвалидации.
    //
    // Профиль, посчитанный конструктором `Ground`, при этом выбрасывается. Оставлено
    // осознанно (ревью #579): цена — сид и клэмпы по 180 столбцам демо-кадра, то есть
    // микросекунды на карточку, а альтернатива — «пустой» режим в конструкторе боевого
    // `Ground` ради витрины, то есть новая ветка в горячем классе движка.
    ground.flatten(groundHeight);

    const tank = new Tank(
        Math.round((width - WORLD_UNITS.tankWidth * scale) / 2),
        height - groundHeight,
        width,
        height,
        barrelAngle,
        [],
        images.hull,
        images.barrel,
        scale,
        images.wheel,
        getTankSkinById(skinId).geometry.wheels,
        false,
    );
    tank.setWindFlag(wind);

    return { ground, tank };
}
