import { ReplayPage } from '@/views/replay-page';

type TPageProps = {
    params: Promise<{ code: string }>;
};

export default async function Page({ params }: TPageProps) {
    const { code } = await params;
    return <ReplayPage code={code} />;
}
