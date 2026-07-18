'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { QUERY_CLIENT_OPTIONS } from './query-client';

export function QueryProvider({ children }: { children: React.ReactNode }) {
    const [queryClient] = useState(() => new QueryClient(QUERY_CLIENT_OPTIONS));

    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
