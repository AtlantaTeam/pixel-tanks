import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine, getAudioEngine } from './audio-engine';
import { MUSIC_SOURCES, SFX_SOURCES } from './audio-assets';

// Минимальные моки WebAudio: проверяем маршрутизацию (какой url грузится, что
// узлы создаются и стартуют), не реальное декодирование. Полный набор сценариев
// «правильный трек на правильное событие» — в задаче с unit-тестами модуля.
type TMockNode = {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    gain: { value: number; setValueAtTime: ReturnType<typeof vi.fn> };
    buffer: AudioBuffer | null;
    loop: boolean;
};

function createNode(): TMockNode {
    return {
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        gain: { value: 1, setValueAtTime: vi.fn() },
        buffer: null,
        loop: false,
    };
}

class MockAudioContext {
    state: 'suspended' | 'running' = 'suspended';
    currentTime = 0;
    destination = {};
    sources: TMockNode[] = [];
    resume = vi.fn(async () => {
        this.state = 'running';
    });
    createGain = vi.fn(() => createNode());
    createBufferSource = vi.fn(() => {
        const node = createNode();
        this.sources.push(node);
        return node;
    });
    decodeAudioData = vi.fn(async () => ({}) as AudioBuffer);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('getAudioEngine', () => {
    it('returns the same singleton instance', () => {
        expect(getAudioEngine()).toBe(getAudioEngine());
    });
});

describe('AudioEngine without WebAudio support', () => {
    const originalAudioContext = window.AudioContext;

    beforeEach(() => {
        // @ts-expect-error — намеренно убираем AudioContext для проверки no-op
        delete window.AudioContext;
    });

    afterEach(() => {
        window.AudioContext = originalAudioContext;
    });

    it('does not throw and stays silent when AudioContext is unavailable', async () => {
        const engine = new AudioEngine();
        await expect(engine.playSfx('fire')).resolves.toBeUndefined();
        await expect(engine.playMusic('menu')).resolves.toBeUndefined();
        expect(() => engine.stopMusic()).not.toThrow();
        expect(() => engine.setMuted(true)).not.toThrow();
        expect(engine.isMuted()).toBe(true);
    });
});

describe('AudioEngine with mocked WebAudio', () => {
    let ctx: MockAudioContext;
    const originalAudioContext = window.AudioContext;

    beforeEach(() => {
        ctx = new MockAudioContext();
        // @ts-expect-error — подменяем конструктор на мок
        window.AudioContext = vi.fn(() => ctx);
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })),
        );
    });

    afterEach(() => {
        window.AudioContext = originalAudioContext;
        vi.unstubAllGlobals();
    });

    it('plays the fire effect from the fire source', async () => {
        const engine = new AudioEngine();
        await engine.playSfx('fire');
        expect(fetch).toHaveBeenCalledWith(SFX_SOURCES.fire);
        expect(ctx.sources).toHaveLength(1);
        expect(ctx.sources[0].start).toHaveBeenCalled();
        expect(ctx.sources[0].loop).toBe(false);
    });

    it('loops the battle track from the battle source', async () => {
        const engine = new AudioEngine();
        await engine.playMusic('battle');
        expect(fetch).toHaveBeenCalledWith(MUSIC_SOURCES.battle);
        expect(ctx.sources[0].loop).toBe(true);
        expect(ctx.sources[0].start).toHaveBeenCalled();
    });

    it('switches music: stops the previous source before starting the new one', async () => {
        const engine = new AudioEngine();
        await engine.playMusic('menu');
        await flush();
        const menuSource = ctx.sources[0];
        await engine.playMusic('battle');
        expect(menuSource.stop).toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledWith(MUSIC_SOURCES.battle);
    });

    it('ignores replaying the already-current track', async () => {
        const engine = new AudioEngine();
        await engine.playMusic('menu');
        (fetch as ReturnType<typeof vi.fn>).mockClear();
        await engine.playMusic('menu');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('resumes the suspended context on playback', async () => {
        const engine = new AudioEngine();
        await engine.playSfx('hit');
        await flush();
        expect(ctx.resume).toHaveBeenCalled();
    });
});
