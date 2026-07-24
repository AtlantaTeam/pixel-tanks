import type { TWeaponSelectorWeapon } from './weapon-selector';

/** Демо-набор оружия для витрины `/design-system` и тестов WeaponSelector — единый
 *  источник, чтобы фикстура не разъезжалась между showcase и тестом. */
export const DEMO_WEAPONS: TWeaponSelectorWeapon[] = [
    { name: 'Фугас', icon: 'wpn-фугас', ammo: 12 },
    { name: 'Мощный заряд', icon: 'wpn-мощный', ammo: 4 },
    { name: 'Кластер', icon: 'wpn-кластер', ammo: 6 },
    { name: 'Роющий', icon: 'wpn-роющий', ammo: 3 },
];
