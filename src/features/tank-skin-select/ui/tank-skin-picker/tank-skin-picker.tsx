'use client';

import { clsx } from 'clsx';
import { TANK_SKINS, TankSkinPreview, useTankSkinPreference } from '@/entities/tank-skins';

/**
 * Пикер скина танка (issue #481) — «выбор в настройках». Косметика: выбор
 * влияет только на вид (см. `tank-skin-parity.test.ts`), сохраняется в
 * `localStorage` (профиля/бэкенда ещё нет, шаг 7 роадмапа) и переживает
 * перезагрузку страницы. Показывает весь реестр — та же витрина выбора,
 * что и на `/design-system` (секция «Скины танков»), но интерактивная.
 */
export function TankSkinPicker() {
    const { skinId, setSkinId } = useTankSkinPreference();

    return (
        <fieldset className="flex flex-col gap-3">
            <legend className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                Скин танка
            </legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
                {TANK_SKINS.map((skin) => {
                    const isSelected = skin.id === skinId;
                    return (
                        <button
                            key={skin.id}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => setSkinId(skin.id)}
                            className={clsx(
                                'flex flex-col items-center gap-2 border-[length:var(--border-w)] bg-surface px-2 py-3 transition-colors',
                                isSelected
                                    ? 'border-[color:var(--accent)] shadow-[var(--glow)]'
                                    : 'border-border hover:border-border-strong',
                            )}
                        >
                            <TankSkinPreview skin={skin} className="w-full" />
                            <span className="text-center font-ui text-[10px] text-text-muted">
                                {skin.geometry.name} · {skin.palette.name}
                            </span>
                        </button>
                    );
                })}
            </div>
        </fieldset>
    );
}
