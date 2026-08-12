/**
 * Угол ствола (радианы, конвенция движка — см. `Tank.gunpointAngle`) в градусы
 * для HUD: отрицательные радианы читаются напрямую, положительные — как
 * дополнение до полного круга. Перенесено из `widgets/game-controls` без
 * изменений — телеметрии верхнего оверлея (`widgets/top-hud`) нужна та же
 * формула, а дублировать её нельзя (единый источник форматирования).
 */
export const formatAngle = (radians: number): number => {
    const normalized = radians < 0 ? -radians : 2 * Math.PI - radians;

    return ((normalized * 180) / Math.PI) | 0;
};
