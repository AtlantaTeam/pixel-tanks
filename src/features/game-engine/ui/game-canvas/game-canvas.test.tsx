import { render } from '@testing-library/react';
import { GameCanvas } from './game-canvas';

describe('GameCanvas', () => {
    it('disables native touch gestures (scroll/zoom) on the canvas element', () => {
        const { container } = render(<GameCanvas seed={42} />);
        const canvas = container.querySelector('canvas');

        expect(canvas).toHaveClass('touch-none');
    });
});
