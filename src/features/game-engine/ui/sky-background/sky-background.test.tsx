import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { pickSkyPreset } from '../../lib/sky-preset';
import { SkyBackground } from './sky-background';

describe('SkyBackground', () => {
    it('публикует выбранный сидом пресет неба в DOM (ревью #585)', () => {
        // Пресет — производная сида, отдельного параметра боя для него нет: без
        // этого атрибута эталонные кадры сцены не могут проверить, что сняли
        // именно день/закат/ночь, и смена хеша `pickSkyPreset` схлопнула бы
        // покрытие молча.
        render(<SkyBackground seed="vrt-night-9" />);

        expect(screen.getByTestId('sky-canvas')).toHaveAttribute(
            'data-sky-preset',
            pickSkyPreset('vrt-night-9').id,
        );
    });

    it('явный пресет витрины перекрывает выбор по сиду', () => {
        render(<SkyBackground seed="vrt-night-9" preset="day" />);

        expect(screen.getByTestId('sky-canvas')).toHaveAttribute('data-sky-preset', 'day');
    });

    it('без сида берёт тот же пресет, что и сцена для сида по умолчанию', () => {
        render(<SkyBackground seed={null} />);

        expect(screen.getByTestId('sky-canvas')).toHaveAttribute(
            'data-sky-preset',
            pickSkyPreset('default').id,
        );
    });
});
