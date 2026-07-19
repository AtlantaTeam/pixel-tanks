import type { CollectionConfig } from 'payload';
import { BOT_NAME } from '@/shared/config';

/** Верхний предел очков за бой — синхронно с MAX_DAILY_POINTS в submit-daily-score. */
const MAX_SCORE_POINTS = 100_000;

export const Scores: CollectionConfig = {
    slug: 'scores',
    admin: {
        useAsTitle: 'id',
        defaultColumns: ['user', 'points', 'opponent', 'dailySeed', 'createdAt'],
    },
    access: {
        // Чтение публично — это лидерборд
        read: () => true,
        // Создавать может только авторизованный игрок. Записи «Боя дня» до
        // появления auth идут через Local API (overrideAccess), которая этот
        // гейт обходит — REST для анонимов остаётся закрыт.
        create: ({ req }) => Boolean(req.user),
        // Изменять / удалять — только админ
        update: ({ req }) => req.user?.role === 'admin',
        delete: ({ req }) => req.user?.role === 'admin',
    },
    fields: [
        {
            name: 'user',
            type: 'relationship',
            relationTo: 'users',
            // Опционально: до фазы Auth «Бой дня» пишет результат анонимно через Local API.
            required: false,
            hasMany: false,
        },
        {
            name: 'points',
            type: 'number',
            required: true,
            min: 0,
            max: MAX_SCORE_POINTS,
        },
        {
            name: 'opponent',
            type: 'text',
            defaultValue: BOT_NAME,
            admin: { description: 'Имя противника (бот или другой игрок)' },
        },
        {
            name: 'dailySeed',
            type: 'text',
            // Лидерборд дня фильтрует scores по dailySeed — без индекса это
            // full-scan по мере роста таблицы.
            index: true,
            admin: {
                description: 'Seed «Боя дня» (daily-YYYY-MM-DD), если результат из daily challenge',
            },
        },
    ],
    timestamps: true,
};
