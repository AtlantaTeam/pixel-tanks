import { EWeaponKind, WEAPON_KIND_ORDER, WEAPON_LABELS } from '@/shared/model';
import { WeaponFxDemo } from '@/features/game-engine';

/**
 * Короткое описание механики каждого типа — что видно на демо снаряда и взрыва.
 * Держим текстом рядом с картинкой, чтобы витрина читалась как справочник типов.
 */
const WEAPON_NOTES: Record<EWeaponKind, string> = {
    [EWeaponKind.HighExplosive]: 'Базовый взрыв — замороженный дефолт движка.',
    [EWeaponKind.Heavy]: 'Крупнее и горячее, ударная волна по фронту.',
    [EWeaponKind.Cluster]: 'Три последовательных очага — рваная канава.',
    [EWeaponKind.Digger]: 'Узкая глубокая воронка, выброс земли.',
};

/**
 * Витрина четырёх типов оружия (issue #483): снаряд в полёте и взрыв каждого типа
 * рисуются теми же числами `WEAPON_SPECS` и тем же примитивом кадра взрыва
 * `paintExplosionFocus`, что и бой — витрина не расходится с реальным видом.
 * Растрового арта нет: эффекты — примитивы, поэтому масштабируются вместе с миром.
 */
export function WeaponsSection() {
    return (
        <div className="flex flex-col gap-3">
            <p className="max-w-prose text-caption text-text-muted">
                Механика и визуал заданы таблицей{' '}
                <code className="text-text-dim">WEAPON_SPECS</code> — одна формула «растущий круг →
                кратер», отличия только в числах и палитре. Числа фугаса заморожены снапшот-тестом.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {WEAPON_KIND_ORDER.map((kind) => (
                    <figure key={kind} className="flex flex-col gap-2">
                        <div className="pixel-border bg-surface p-2">
                            <WeaponFxDemo kind={kind} />
                        </div>
                        <figcaption className="text-center text-caption font-ui text-text-muted">
                            <span className="text-text">{WEAPON_LABELS[kind]}</span>
                            <br />
                            {WEAPON_NOTES[kind]}
                        </figcaption>
                    </figure>
                ))}
            </div>
        </div>
    );
}
