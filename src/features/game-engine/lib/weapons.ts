import type { TWeapon } from '@/shared/model';
import { Bullet } from './bullet';
import type { TTanksWeapons } from './game-play';

/** Оружия на бой суммарно: по половине каждому танку. */
export const WEAPONS_AMOUNT = 10;

/**
 * Раздаёт оружие обоим танкам: чётные id — левому (игрок), нечётные — правому
 * (бот). Раздача детерминирована (без random, вопреки старому имени
 * `generateRandomWeapons`), поэтому бой и его реплей получают идентичные
 * арсеналы без записи оружия в код реплея.
 */
export const dealWeapons = (amount: number = WEAPONS_AMOUNT): TTanksWeapons => {
    const weapons: TWeapon[] = [];
    for (let i = 0; i < amount; i++) {
        weapons[i] = { id: i, name: Bullet.label };
    }
    return {
        leftTankWeapons: weapons.filter((_, index) => index % 2 === 0),
        rightTankWeapons: weapons.filter((_, index) => index % 2 === 1),
    };
};
