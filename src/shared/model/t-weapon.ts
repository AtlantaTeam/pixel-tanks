import type { EWeaponKind } from './e-weapon-kind';

export type TWeapon = {
    id: number;
    name: string;
    /**
     * Тип оружия (issue #483) — определяет и механику взрыва (спек в
     * `features/game-engine/lib/weapon-specs.ts`), и иконку палубы. Связь идёт
     * по `kind`-enum, а не по строке `name`: имя — только для показа человеку.
     */
    kind: EWeaponKind;
};
