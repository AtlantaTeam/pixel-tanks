import { EWeaponKind, WEAPON_KIND_ORDER, WEAPON_LABELS, type TWeapon } from '@/shared/model';
import type { TTanksWeapons } from './game-play';

/** Оружия на бой суммарно: по половине каждому танку. */
export const WEAPONS_AMOUNT = 10;

/**
 * Тип оружия по его id. Раздача чётные/нечётные (левый/правый танк) означает, что
 * `id % 4` дал бы каждому танку лишь два типа из четырёх — поэтому делим по
 * `floor(id / 2) % 4`: у левого id 0,2,4,6,8 → типы 0,1,2,3,0, у правого
 * 1,3,5,7,9 → 0,1,2,3,0. Оба получают весь арсенал. Детерминировано от сида боя
 * (без random), поэтому реплей получает те же типы без записи каждого оружия.
 */
export const weaponKindForId = (id: number): EWeaponKind =>
    WEAPON_KIND_ORDER[Math.floor(id / 2) % WEAPON_KIND_ORDER.length];

/**
 * Раздаёт оружие обоим танкам: чётные id — левому (игрок), нечётные — правому
 * (бот). Тип оружия — от id (`weaponKindForId`), имя — человекочитаемая метка
 * типа. Раздача детерминирована (без random), поэтому бой и его реплей получают
 * идентичные арсеналы без записи оружия в код реплея.
 */
export const dealWeapons = (amount: number = WEAPONS_AMOUNT): TTanksWeapons => {
    const weapons: TWeapon[] = [];
    for (let i = 0; i < amount; i++) {
        const kind = weaponKindForId(i);
        weapons[i] = { id: i, name: WEAPON_LABELS[kind], kind };
    }
    return {
        leftTankWeapons: weapons.filter((_, index) => index % 2 === 0),
        rightTankWeapons: weapons.filter((_, index) => index % 2 === 1),
    };
};
