import { attachGestureGuard } from './gesture-guard';

/** Событие touchmove с заданным числом активных касаний (для эмуляции пинча). */
function makeTouchMove(touchCount: number): Event {
    const event = new Event('touchmove', { cancelable: true });
    Object.defineProperty(event, 'touches', { value: { length: touchCount } });
    return event;
}

describe('attachGestureGuard', () => {
    let el: HTMLElement;
    let cleanup: () => void = () => {};

    beforeEach(() => {
        el = document.createElement('canvas');
    });

    afterEach(() => {
        cleanup();
        cleanup = () => {};
    });

    it('гасит iOS-жест pinch-zoom (gesturestart) на элементе', () => {
        cleanup = attachGestureGuard(el);
        const event = new Event('gesturestart', { cancelable: true });

        el.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
    });

    it('гасит iOS-жест pinch-zoom (gesturechange)', () => {
        cleanup = attachGestureGuard(el);
        const event = new Event('gesturechange', { cancelable: true });

        el.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
    });

    it('гасит мультитач-touchmove (2+ касания — пинч-зум)', () => {
        cleanup = attachGestureGuard(el);
        const event = makeTouchMove(2);

        el.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
    });

    it('не мешает одиночному touchmove (жест прицеливания)', () => {
        cleanup = attachGestureGuard(el);
        const event = makeTouchMove(1);

        el.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
    });

    it('cleanup снимает слушатели — после него жесты не гасятся', () => {
        cleanup = attachGestureGuard(el);
        cleanup();
        cleanup = () => {};
        const event = new Event('gesturestart', { cancelable: true });

        el.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
    });

    it('защита живёт только на Canvas — системные жесты вне него не тронуты', () => {
        cleanup = attachGestureGuard(el);
        const event = new Event('gesturestart', { cancelable: true });

        document.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
    });
});
