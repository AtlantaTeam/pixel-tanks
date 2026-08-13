import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TANK_SKIN_ID, TANK_SKINS } from '@/entities/tank-skins';
import { TankSkinPicker } from './tank-skin-picker';

describe('TankSkinPicker', () => {
    beforeEach(() => localStorage.clear());

    it('показывает весь реестр скинов, дефолт отмечен выбранным', () => {
        render(<TankSkinPicker />);

        const buttons = screen.getAllByRole('button');
        expect(buttons).toHaveLength(TANK_SKINS.length);

        const defaultSkin = TANK_SKINS.find((skin) => skin.id === DEFAULT_TANK_SKIN_ID);
        // Матчим доступное имя по подстроке функцией, а не RegExp из имён скинов:
        // имя может получить спецсимвол regex (`(`, `.`, `+`), и собранный паттерн
        // молча сломался бы или дал ложное совпадение.
        const defaultLabel = `${defaultSkin?.geometry.name} · ${defaultSkin?.palette.name}`;
        const defaultButton = screen.getByRole('button', {
            name: (accessibleName) => accessibleName.includes(defaultLabel),
        });
        expect(defaultButton).toHaveAttribute('aria-pressed', 'true');
    });

    it('клик по другому скину сохраняет выбор в localStorage и переключает aria-pressed', () => {
        render(<TankSkinPicker />);

        const target = TANK_SKINS.find((skin) => skin.id !== DEFAULT_TANK_SKIN_ID);
        if (!target) throw new Error('в реестре должно быть больше одного скина');
        const targetLabel = `${target.geometry.name} · ${target.palette.name}`;
        const targetButton = screen.getByRole('button', {
            name: (accessibleName) => accessibleName.includes(targetLabel),
        });

        fireEvent.click(targetButton);

        expect(targetButton).toHaveAttribute('aria-pressed', 'true');
        expect(localStorage.getItem('tank-skin')).toBe(target.id);
    });
});
