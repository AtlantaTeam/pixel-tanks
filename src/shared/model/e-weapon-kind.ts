/**
 * Тип оружия боя (GDD §9, issue #483). Четыре типа отличаются механикой и
 * визуалом взрыва (см. `features/game-engine/lib/weapon-specs.ts`), но НЕ
 * подсистемой эффектов: различия — числа и палитра одной и той же формулы
 * «растущий круг → кратер».
 *
 * Строковые значения читаемы в отладке и стабильны как ключ `Record`. Порядок
 * для сериализации и раздачи задаёт `WEAPON_KIND_ORDER` (не порядок членов
 * enum): фугас — нулевой (дефолт совместимости реплеев).
 */
export enum EWeaponKind {
    /** Базовый радиус урона — «замороженный» дефолтный взрыв движка. */
    HighExplosive = 'high-explosive',
    /** Больше импульс и радиус, горячее ядро, ударная волна по фронту. */
    Heavy = 'heavy',
    /** Дробление на три последовательных очага — рваная канава вместо воронки. */
    Cluster = 'cluster',
    /** Прокоп рельефа: узкая глубокая воронка, выброс земли вместо огня. */
    Digger = 'digger',
}

/**
 * Канонический порядок типов — источник ординала (индекс = порядковый номер).
 * По нему `dealWeapons` раздаёт арсенал (`floor(id/2) % 4`), а кодек реплея
 * пишет `weaponId`. Фугас нулевой: отсутствующий `weaponId` в старой записи
 * (до issue #483) читается как фугас — идентичность старых реплеев сохраняется.
 * Менять порядок нельзя — сдвинет расшифровку уже сохранённых ссылок.
 */
export const WEAPON_KIND_ORDER: readonly EWeaponKind[] = [
    EWeaponKind.HighExplosive,
    EWeaponKind.Heavy,
    EWeaponKind.Cluster,
    EWeaponKind.Digger,
];

/** Человекочитаемое имя типа для палубы (`WeaponSelector`) и витрины. */
export const WEAPON_LABELS: Record<EWeaponKind, string> = {
    [EWeaponKind.HighExplosive]: 'Фугас',
    [EWeaponKind.Heavy]: 'Мощный заряд',
    [EWeaponKind.Cluster]: 'Кластер',
    [EWeaponKind.Digger]: 'Роющий',
};
