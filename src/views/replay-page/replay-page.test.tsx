import { render } from '@testing-library/react';
import { encodeReplay } from '@/entities/replays';
import { ReplayPage } from './replay-page';

const VALID_CODE = encodeReplay({
    seed: 42,
    width: 800,
    height: 600,
    moves: [{ kind: 'fire', angle: -0.75, power: 12 }],
});

describe('ReplayPage', () => {
    it('рендерит canvas боя для валидного кода реплея', () => {
        const { container } = render(<ReplayPage code={VALID_CODE} />);

        expect(container.querySelector('canvas')).not.toBeNull();
    });

    it('использует высоту dvh и обрезает overflow, как страница игры', () => {
        const { container } = render(<ReplayPage code={VALID_CODE} />);
        const main = container.querySelector('main');

        expect(main).toHaveClass('h-dvh');
        expect(main).toHaveClass('overflow-hidden');
        expect(main).toHaveClass('safe-area-inset');
    });

    it('показывает error-state со ссылкой на игру для невалидного кода', () => {
        const { container, getByText, getByRole } = render(<ReplayPage code="***мусор***" />);

        expect(container.querySelector('canvas')).toBeNull();
        expect(getByText('Реплей не найден')).toBeInTheDocument();
        expect(getByRole('link', { name: 'Сыграть самому' })).toHaveAttribute('href', '/game');
    });
});
