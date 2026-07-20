import { NextResponse } from 'next/server';

// FIRE-DRILL автооткатa (#118): временно отдаём 500 на / чтобы healthcheck упал.
// Убирается revert-PR сразу после проверки. НЕ оставлять в main.
export function middleware(): NextResponse {
    return new NextResponse('rollback drill: forced 500', { status: 500 });
}

export const config = {
    matcher: '/',
};
