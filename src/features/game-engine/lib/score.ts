/** Исход попадания, который движок сообщает в onPointsCalc. */
export type TPointsEvent = {
    hittedIsLeft: boolean;
    leftActive: boolean;
    power: number;
};

/**
 * Чьи очки меняются и на сколько: попадание в противника даёт стрелявшему
 * `+power`, самострел отнимает `power` у самого стрелявшего. Левый танк —
 * игрок, правый — бот (enemy). Чистая функция — общая для живого боя и реплея.
 */
export const resolvePointsDelta = ({
    hittedIsLeft,
    leftActive,
    power,
}: TPointsEvent): { isPlayer: boolean; delta: number } => {
    if (hittedIsLeft) {
        return leftActive ? { isPlayer: true, delta: -power } : { isPlayer: false, delta: power };
    }
    return leftActive ? { isPlayer: true, delta: power } : { isPlayer: false, delta: -power };
};
