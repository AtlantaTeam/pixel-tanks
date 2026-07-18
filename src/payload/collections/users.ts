import type { CollectionConfig } from 'payload';

export const Users: CollectionConfig = {
    slug: 'users',
    auth: true,
    admin: {
        useAsTitle: 'email',
        defaultColumns: ['email', 'nickname', 'role'],
    },
    fields: [
        {
            name: 'nickname',
            type: 'text',
            required: true,
            unique: true,
            minLength: 2,
            maxLength: 24,
        },
        {
            name: 'role',
            type: 'select',
            defaultValue: 'player',
            options: [
                { label: 'Игрок', value: 'player' },
                { label: 'Админ', value: 'admin' },
            ],
            access: {
                update: ({ req }) => req.user?.role === 'admin',
            },
        },
    ],
};
