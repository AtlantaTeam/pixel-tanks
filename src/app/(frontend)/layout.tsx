import type { Metadata, Viewport } from 'next';
import { Montserrat, Press_Start_2P } from 'next/font/google';
import { QueryProvider } from '@/shared/api';
import { APP_NAME } from '@/shared/config';
import { AudioUnlock } from '@/shared/lib/audio';
import '../globals.css';

const montserrat = Montserrat({
    subsets: ['latin', 'cyrillic'],
    display: 'swap',
});

const pressStart = Press_Start_2P({
    weight: '400',
    subsets: ['latin', 'cyrillic'],
    variable: '--font-press-start',
    display: 'swap',
});

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
            <body className={`${montserrat.className} ${pressStart.variable} antialiased`}>
                <QueryProvider>
                    <AudioUnlock />
                    {children}
                </QueryProvider>
            </body>
        </html>
    );
}
