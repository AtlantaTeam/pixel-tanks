import type { Metadata, Viewport } from 'next';
import { QueryProvider } from '@/shared/api';
import { APP_NAME } from '@/shared/config';
import { AudioUnlock } from '@/shared/lib/audio';
import '../globals.css';

export const metadata: Metadata = {
    title: `${APP_NAME} — танковая дуэль на Canvas`,
    description: `Учебная игра ${APP_NAME}. Стреляй, считай угол, ветер и силу — побеждай.`,
};

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
};

export default function FrontendLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="ru" suppressHydrationWarning>
            <body className="font-sans antialiased">
                <QueryProvider>
                    <AudioUnlock />
                    {children}
                </QueryProvider>
            </body>
        </html>
    );
}
