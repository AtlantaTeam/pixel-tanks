import { render } from '@testing-library/react';
import { HPBar } from './hp-bar';

describe('HPBar', () => {
    it('renders success fill above the warning threshold (61+)', () => {
        const { container } = render(<HPBar label="Игрок" value={100} faction="player" />);

        const fill = container.querySelector('[data-testid="hp-bar-fill"]') as HTMLElement;
        expect(fill).toHaveClass('bg-success');
    });

    it('renders warning fill at the upper threshold boundary (60)', () => {
        const { container } = render(<HPBar label="Игрок" value={60} faction="player" />);

        const fill = container.querySelector('[data-testid="hp-bar-fill"]') as HTMLElement;
        expect(fill).toHaveClass('bg-warning');
    });

    it('renders warning fill above the danger threshold (31)', () => {
        const { container } = render(<HPBar label="Игрок" value={31} faction="player" />);

        const fill = container.querySelector('[data-testid="hp-bar-fill"]') as HTMLElement;
        expect(fill).toHaveClass('bg-warning');
    });

    it('renders danger fill at the lower threshold boundary (30)', () => {
        const { container } = render(<HPBar label="Игрок" value={30} faction="player" />);

        const fill = container.querySelector('[data-testid="hp-bar-fill"]') as HTMLElement;
        expect(fill).toHaveClass('bg-danger');
    });

    it('renders danger fill at zero HP', () => {
        const { container } = render(<HPBar label="Игрок" value={0} faction="player" />);

        const fill = container.querySelector('[data-testid="hp-bar-fill"]') as HTMLElement;
        expect(fill).toHaveClass('bg-danger');
        expect(fill.style.width).toBe('0%');
    });

    it('clamps fill width for values above 100', () => {
        const { container } = render(<HPBar label="Игрок" value={140} faction="player" />);

        const fill = container.querySelector('[data-testid="hp-bar-fill"]') as HTMLElement;
        expect(fill.style.width).toBe('100%');
    });

    it('clamps fill width for negative values', () => {
        const { container } = render(<HPBar label="Игрок" value={-20} faction="player" />);

        const fill = container.querySelector('[data-testid="hp-bar-fill"]') as HTMLElement;
        expect(fill.style.width).toBe('0%');
    });

    it('shows label and tabular HP caption', () => {
        const { getByText } = render(<HPBar label="Игрок 1" value={72} faction="player" />);

        expect(getByText('Игрок 1')).toBeInTheDocument();
        expect(getByText('72/100')).toBeInTheDocument();
    });

    it('renders the star icon for the player faction', () => {
        const { container } = render(<HPBar label="Игрок" value={72} faction="player" />);

        expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('renders the skull icon for the enemy faction', () => {
        const { container } = render(<HPBar label="Враг" value={38} faction="enemy" />);

        expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('accepts a custom className', () => {
        const { container } = render(
            <HPBar label="Игрок" value={72} faction="player" className="custom-hp-bar" />,
        );

        expect((container.firstChild as HTMLElement).className).toContain('custom-hp-bar');
    });

    it('раскладка inline держит имя, трек и число в одной строке (#450)', () => {
        const { container, getByText } = render(
            <HPBar label="Игрок" value={72} faction="player" layout="inline" />,
        );

        // Корень inline-раскладки — единый flex-ряд (items-center), а не колонка:
        // имя, трек и число лежат в один ряд, экономя высоту компактного HUD.
        const root = container.firstChild as HTMLElement;
        expect(root).toHaveClass('flex');
        expect(root).toHaveClass('items-center');
        expect(root).not.toHaveClass('flex-col');

        // Трек тянется (`flex-1`) — имя усекается, число фиксировано.
        const track = container.querySelector('[role="progressbar"]') as HTMLElement;
        expect(track).toHaveClass('flex-1');

        // Информация та же, что в stacked: имя и «72/100».
        expect(getByText('Игрок')).toBeInTheDocument();
        expect(getByText('72/100')).toBeInTheDocument();
    });

    it('раскладка по умолчанию (stacked) — колонка «заголовок над треком»', () => {
        const { container } = render(<HPBar label="Игрок" value={72} faction="player" />);

        const root = container.firstChild as HTMLElement;
        expect(root).toHaveClass('flex-col');
    });

    it('scales fill width and caption against a custom max', () => {
        const { container, getByText } = render(
            <HPBar label="Босс" value={75} faction="enemy" max={150} />,
        );

        const fill = container.querySelector('[data-testid="hp-bar-fill"]') as HTMLElement;
        expect(fill.style.width).toBe('50%');
        expect(getByText('75/150')).toBeInTheDocument();
    });

    it('computes color thresholds as percentages of a custom max', () => {
        // 75/150 = 50% → warning (не success, хотя сырое значение 75 > 60)
        const { container } = render(<HPBar label="Босс" value={75} faction="enemy" max={150} />);

        const fill = container.querySelector('[data-testid="hp-bar-fill"]') as HTMLElement;
        expect(fill).toHaveClass('bg-warning');
    });

    it('clamps fill to the custom max for overshooting values', () => {
        const { container } = render(<HPBar label="Босс" value={999} faction="enemy" max={150} />);

        const fill = container.querySelector('[data-testid="hp-bar-fill"]') as HTMLElement;
        expect(fill.style.width).toBe('100%');
    });

    it('truncates a long name with ellipsis instead of wrapping onto a second line (handoff)', () => {
        const { getByText, container } = render(
            <HPBar label="Очень длинное имя, которое не влезает" value={72} faction="player" />,
        );

        const nameSpan = getByText('Очень длинное имя, которое не влезает');
        expect(nameSpan).toHaveClass('overflow-hidden', 'text-ellipsis', 'whitespace-nowrap');

        const row = container.querySelector('.min-w-0')?.parentElement;
        expect(row).toHaveClass('justify-between');
    });

    it('exposes progressbar semantics for assistive tech', () => {
        const { getByRole } = render(<HPBar label="Игрок" value={72} faction="player" />);

        const bar = getByRole('progressbar');
        expect(bar).toHaveAttribute('aria-valuenow', '72');
        expect(bar).toHaveAttribute('aria-valuemin', '0');
        expect(bar).toHaveAttribute('aria-valuemax', '100');
    });

    describe('вспышка при попадании (issue #549)', () => {
        it('без hitNonce трек спокоен — нет ни сдвига, ни засветки', () => {
            const { getByRole, queryByTestId } = render(
                <HPBar label="Игрок" value={72} faction="player" />,
            );

            expect(getByRole('progressbar')).not.toHaveClass('animate-hp-hit-shake');
            expect(queryByTestId('hp-bar-hit-flash')).not.toBeInTheDocument();
        });

        it('hitNonce включает сдвиг трека и белую засветку заливки, гасимые reduced motion', () => {
            const { getByRole, getByTestId } = render(
                <HPBar label="Игрок" value={72} faction="player" hitNonce={1} />,
            );

            const track = getByRole('progressbar');
            expect(track).toHaveClass('animate-hp-hit-shake', 'motion-reduce:animate-none');

            const flash = getByTestId('hp-bar-hit-flash');
            expect(flash).toHaveClass('animate-hp-hit-flash', 'motion-reduce:hidden');
        });

        it('повторный hitNonce на том же значении не ломает раскладку inline', () => {
            const { getByRole } = render(
                <HPBar label="Игрок" value={72} faction="player" layout="inline" hitNonce={3} />,
            );

            const track = getByRole('progressbar');
            expect(track).toHaveClass('flex-1', 'animate-hp-hit-shake');
        });
    });
});
