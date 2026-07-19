import type { Metadata } from 'next';
import { decodeReplay } from '@/entities/replays';
import { APP_NAME } from '@/shared/config';
import { ReplayPage } from '@/views/replay-page';

type TPageProps = {
    params: Promise<{ code: string }>;
};

/**
 * OG-метаданные для расшёртенной ссылки: вся суть фичи — «поделиться ссылкой»,
 * поэтому в мессенджере она должна разворачиваться со своим заголовком.
 * Невалидный код (мусор, обрезанная ссылка) — `noindex`, чтобы битые URL не
 * попадали в поисковую выдачу.
 */
export async function generateMetadata({ params }: TPageProps): Promise<Metadata> {
    const { code } = await params;
    if (decodeReplay(code) === null) {
        return {
            title: `Реплей не найден — ${APP_NAME}`,
            robots: { index: false, follow: false },
        };
    }
    return {
        title: `Реплей боя — ${APP_NAME}`,
        description: `Покадровое воспроизведение боя в ${APP_NAME}.`,
    };
}

export default async function Page({ params }: TPageProps) {
    const { code } = await params;
    return <ReplayPage code={code} />;
}
