import { MUSIC_SOURCES, MUSIC_VOLUME, SFX_SOURCES, SFX_VOLUME } from './audio-assets';
import type { TMusicTrack, TSfxName } from './t-audio';

type TAudioContextCtor = typeof AudioContext;
type TWindowWithWebkitAudio = Window &
    typeof globalThis & {
        webkitAudioContext?: TAudioContextCtor;
    };

function resolveAudioContextCtor(): TAudioContextCtor | undefined {
    if (typeof window === 'undefined') return undefined;
    const w = window as TWindowWithWebkitAudio;
    // Safari до 14.1 отдаёт только префиксный webkitAudioContext.
    return window.AudioContext ?? w.webkitAudioContext;
}

/**
 * Аудио-движок на WebAudio: декодирует буферы через AudioContext, играет
 * одноразовые эффекты боя (fire/hit/miss) и зацикленную музыку сцены
 * (меню/бой) с переключением при навигации.
 *
 * Устойчив к SSR и окружениям без WebAudio (тесты, старые браузеры): при
 * отсутствии AudioContext все методы — no-op, ничего не бросают. Контекст
 * создаётся лениво при первом воспроизведении. Autoplay-политику (разблокировку
 * после первого жеста) добавляет отдельная задача.
 */
export class AudioEngine {
    private ctx: AudioContext | null = null;
    private masterGain: GainNode | null = null;
    private musicGain: GainNode | null = null;
    private sfxGain: GainNode | null = null;
    private readonly buffers = new Map<string, AudioBuffer>();
    private readonly loading = new Map<string, Promise<AudioBuffer | null>>();
    private currentMusic: TMusicTrack | null = null;
    private musicSource: AudioBufferSourceNode | null = null;
    private muted = false;

    private ensureContext(): AudioContext | null {
        if (this.ctx) return this.ctx;
        const Ctor = resolveAudioContextCtor();
        if (!Ctor) return null;

        const ctx = new Ctor();
        const masterGain = ctx.createGain();
        masterGain.gain.value = this.muted ? 0 : 1;
        masterGain.connect(ctx.destination);

        const musicGain = ctx.createGain();
        musicGain.gain.value = MUSIC_VOLUME;
        musicGain.connect(masterGain);

        const sfxGain = ctx.createGain();
        sfxGain.gain.value = SFX_VOLUME;
        sfxGain.connect(masterGain);

        this.ctx = ctx;
        this.masterGain = masterGain;
        this.musicGain = musicGain;
        this.sfxGain = sfxGain;
        return ctx;
    }

    /** Возобновить контекст (браузер держит его suspended до жеста пользователя). */
    async resume(): Promise<void> {
        const ctx = this.ensureContext();
        if (ctx && ctx.state === 'suspended') {
            await ctx.resume().catch(() => {
                // разблокировка не удалась — попробуем на следующем жесте
            });
        }
    }

    private loadBuffer(url: string): Promise<AudioBuffer | null> {
        const ctx = this.ensureContext();
        if (!ctx) return Promise.resolve(null);

        const cached = this.buffers.get(url);
        if (cached) return Promise.resolve(cached);

        const inflight = this.loading.get(url);
        if (inflight) return inflight;

        const promise = (async () => {
            try {
                const res = await fetch(url);
                const raw = await res.arrayBuffer();
                const buffer = await ctx.decodeAudioData(raw);
                this.buffers.set(url, buffer);
                return buffer;
            } catch {
                return null;
            } finally {
                this.loading.delete(url);
            }
        })();

        this.loading.set(url, promise);
        return promise;
    }

    /** Проиграть одноразовый эффект боя. Вызывается из обработчиков-жестов, */
    /** поэтому попутно разблокирует контекст. */
    async playSfx(name: TSfxName): Promise<void> {
        const ctx = this.ensureContext();
        if (!ctx || !this.sfxGain) return;
        void this.resume();
        const buffer = await this.loadBuffer(SFX_SOURCES[name]);
        if (!buffer) return;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.sfxGain);
        source.start(0);
    }

    /** Переключить фоновую музыку. Повторный вызов того же трека игнорируется. */
    async playMusic(track: TMusicTrack): Promise<void> {
        if (this.currentMusic === track) return;
        this.currentMusic = track;

        const ctx = this.ensureContext();
        if (!ctx || !this.musicGain) return;

        this.stopMusicSource();
        const buffer = await this.loadBuffer(MUSIC_SOURCES[track]);
        // Пока грузился буфер, сцена могла смениться снова — не перебиваем новый трек.
        if (!buffer || this.currentMusic !== track) return;

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(this.musicGain);
        source.start(0);
        this.musicSource = source;
    }

    /** Полностью остановить музыку (напр. при выходе из игры). */
    stopMusic(): void {
        this.currentMusic = null;
        this.stopMusicSource();
    }

    private stopMusicSource(): void {
        if (!this.musicSource) return;
        try {
            this.musicSource.stop();
        } catch {
            // источник мог ещё не стартовать — disconnect ниже всё равно освободит узел
        }
        this.musicSource.disconnect();
        this.musicSource = null;
    }

    /** Глушит весь звук разом через master-gain (состояние переживает переключения). */
    setMuted(muted: boolean): void {
        this.muted = muted;
        if (this.masterGain && this.ctx) {
            this.masterGain.gain.setValueAtTime(muted ? 0 : 1, this.ctx.currentTime);
        }
    }

    isMuted(): boolean {
        return this.muted;
    }
}

let engine: AudioEngine | null = null;

/** Единый экземпляр движка на всё приложение. */
export function getAudioEngine(): AudioEngine {
    if (!engine) engine = new AudioEngine();
    return engine;
}
