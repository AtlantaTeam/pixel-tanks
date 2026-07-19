import type { CollectionConfig } from 'payload';

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
        },
        {
            name: 'opponent',
            type: 'text',
            defaultValue: 'Terminator',
            admin: { description: 'Имя противника (бот или другой игрок)' },
        },
        {
            name: 'durationSec',
            type: 'number',
            admin: { description: 'Длительность матча в секундах' },
        },
        {
            name: 'dailySeed',
            type: 'text',
            admin: {
                description: 'Seed «Боя дня» (daily-YYYY-MM-DD), если результат из daily challenge',
            },
        },
    ],
    timestamps: true,
};
