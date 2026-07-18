import type { CollectionConfig } from 'payload';

export const Scores: CollectionConfig = {
    slug: 'scores',
    admin: {
        useAsTitle: 'id',
        defaultColumns: ['user', 'points', 'opponent', 'createdAt'],
    },
    access: {
        // Чтение публично — это лидерборд
        read: () => true,
        // Создавать может только авторизованный игрок
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
            required: true,
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
    ],
    timestamps: true,
};
