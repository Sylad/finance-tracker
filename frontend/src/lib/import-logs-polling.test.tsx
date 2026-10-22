import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useImportLogs, useUploadStatements } from './queries';
import { api } from './api';

describe('Import de relevés — historique rafraîchi pendant un envoi (L110)', () => {
  it("R11 — pendant un envoi l'historique est relu toutes les 2 s, même sans import en cours", async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([]);
    vi.spyOn(api, 'postForm').mockReturnValue(new Promise(() => {}));
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => ({ logs: useImportLogs(), up: useUploadStatements() }), { wrapper });
    await waitFor(() => expect(result.current.logs.isSuccess).toBe(true));
    act(() => { result.current.up.mutate([new File(['x'], 'a.pdf')]); });
    const before = get.mock.calls.length;
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(before), { timeout: 3500 });
  });
});
