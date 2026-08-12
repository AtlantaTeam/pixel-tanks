'use client';

import { useGameStore } from '@/features/game-engine';
import { Select } from '@/shared/ui';
import { KeyboardSchemeHint } from './keyboard-scheme-hint';

/**
 * Нижняя палуба (временная): выбор оружия + клавиатурная подсказка. HP,
 * mute/пауза и телеметрия (угол/сила/ветер/пипы) переехали в `widgets/top-hud`
 * (#423) — здесь их больше нет, дублировать нечего. Селектор оружия, манёвр и
 * кнопка ОГОНЬ по макету `handoff.md` — отдельная issue трека («нижняя
 * палуба»), пока он остаётся нативным `Select`.
 */
export function GameControls() {
    const weapons = useGameStore((s) => s.weapons);
    const selectedWeapon = useGameStore((s) => s.selectedWeapon);
    const selectWeapon = useGameStore((s) => s.selectWeapon);

    return (
        <div className="flex flex-col gap-2 p-2 sm:gap-4 sm:p-4">
            <div className="flex justify-center">
                <Select
                    id="weapon-select"
                    label="Оружие"
                    className="w-36"
                    value={selectedWeapon?.id ?? ''}
                    onValueChange={(value) => {
                        const next = weapons.find((w) => w.id === Number(value));
                        if (next) selectWeapon(next);
                    }}
                >
                    {weapons.map((w) => (
                        <option key={w.id} value={w.id}>
                            {w.name} #{w.id}
                        </option>
                    ))}
                </Select>
            </div>

            <div className="border-t border-border pt-2 sm:pt-4">
                <KeyboardSchemeHint />
            </div>
        </div>
    );
}
