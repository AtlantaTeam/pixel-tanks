import type { TSegmentedControlOption } from '@/shared/ui';

/** Общие демо-константы витрины: срезы статичны, обработчики контролов — пустые.
 *  Вынесено из frame-файлов и секций, чтобы одинаковые значения (скорость плеера,
 *  период лидерборда, «ход N/M» реплея) не расходились по копиям. */

/** Пустой обработчик для статичных срезов — контрол ничего не делает на витрине. */
export const noop = () => {};

/** Скорость воспроизведения плеера реплея (game-controls + экран реплея). */
export const SPEED_OPTIONS: TSegmentedControlOption<'0.5' | '1' | '2'>[] = [
    { value: '0.5', label: '0.5×' },
    { value: '1', label: '1×' },
    { value: '2', label: '2×' },
];

/** Период лидерборда (atomic-контролы + экран боя дня). */
export const PERIOD_OPTIONS: TSegmentedControlOption<'day' | 'all'>[] = [
    { value: 'day', label: 'День' },
    { value: 'all', label: 'Всё время' },
];

/** Демо-прогресс реплея «ход REPLAY_CURRENT_TURN / REPLAY_TOTAL_TURNS». */
export const REPLAY_TOTAL_TURNS = 12;
export const REPLAY_CURRENT_TURN = 5;
