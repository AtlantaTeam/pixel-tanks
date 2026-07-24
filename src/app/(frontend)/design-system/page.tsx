import type { Metadata } from 'next';
import { APP_NAME } from '@/shared/config';
import { DesignSystemPage } from '@/views/design-system';

// Внутренняя витрина дизайн-системы (мишень визрегрессии), не публичная страница —
// закрываем от индексации, чтобы не попадала в поисковую выдачу.
export const metadata: Metadata = {
    title: `Дизайн-система — ${APP_NAME}`,
    robots: { index: false, follow: false },
};

export default function Page() {
    return <DesignSystemPage />;
}
