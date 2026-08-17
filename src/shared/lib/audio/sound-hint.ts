'use client';

import { createPersistentFlag } from '@/shared/lib/storage';

/**
 * Разовый флаг подсказки звука (issue #584): раньше `SoundPrompt` держал
 * видимость в локальном `useState` — гасла по клику, но появлялась заново на
 * КАЖДОМ маунте, включая переход на `/game` (новый `AudioContext`, снова
 * suspended). Теперь факт «уже видел» переживает переход между экранами и
 * перезагрузку.
 *
 * Механика хранения — общая фабрика `createPersistentFlag` (`shared/lib/storage`,
 * ревью #585): раньше этот модуль был построчной копией `aim-hint.ts`, и правка
 * семантики (синхронизация вкладок, отказ storage) требовала помнить про обе.
 */
const soundHintFlag = createPersistentFlag('pt-sound-hint-seen');

/** Ключ хранилища — наружу, чтобы тесты не дублировали строку литералом. */
export const SOUND_HINT_STORAGE_KEY = soundHintFlag.key;

/**
 * Пометить подсказку показанной (идемпотентно): следующий бой, другой экран и
 * перезагрузка её больше не покажут.
 */
export const markSoundHintSeen = soundHintFlag.mark;

/** Реактивный флаг «подсказку уже видели» для рендера `SoundPrompt`. */
export const useSoundHintSeen = soundHintFlag.useFlag;
