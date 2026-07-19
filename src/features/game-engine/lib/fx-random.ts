import { createSeededRandom, type TSeededRandom } from '@/shared/lib/random';

/**
 * Отдельный поток RNG для косметики (частицы, тряска). Его FPS-зависимое
 * потребление не должно сдвигать выборки бота на игровом потоке, поэтому это
 * ОТДЕЛЬНАЯ последовательность, детерминированная тем же seed боя.
 *
 * Живой бой (`GameCanvas`) и воспроизведение (`ReplayCanvas`) обязаны выводить
 * fx-поток из seed ОДИНАКОВО — иначе реплей разойдётся с оригиналом. Общая
 * функция гарантирует, что префикс не разъедется между этими двумя местами.
 */
export const createFxRandom = (seed: number | string): TSeededRandom =>
    createSeededRandom(`fx:${seed}`);
