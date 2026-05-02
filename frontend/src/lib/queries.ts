import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type {
  Budget,
  ClaudeUsage,
  Declaration,
  DeclarationInput,
  ForecastMonth,
  MonthlyStatement,
  RecurringCredit,
  ScoreHistoryEntry,
  StatementSummary,
  UploadResult,
  YearlySummary,
} from '@/types/api';

export const qk = {
  statements: () => ['statements'] as const,
  statement: (id: string) => ['statements', id] as const,
  scoreHistory: () => ['statements', 'score-history'] as const,
  recurring: () => ['statements', 'recurring-credits'] as const,
  yearly: (year?: number) => year ? ['statements', 'yearly', year] as const : ['statements', 'yearly'] as const,
  budget: () => ['budgets'] as const,
  declarations: () => ['declarations'] as const,
  forecast: (months: number) => ['forecast', months] as const,
  claudeUsage: () => ['claude', 'usage'] as const,
};

export function useStatements() {
  return useQuery({
    queryKey: qk.statements(),
    queryFn: () => api.get<StatementSummary[]>('/statements'),
  });
}

export function useStatement(id: string | undefined) {
  return useQuery({
    queryKey: qk.statement(id ?? ''),
    queryFn: () => api.get<MonthlyStatement>(`/statements/${id}`),
    enabled: !!id,
  });
}

export function useScoreHistory() {
  return useQuery({
    queryKey: qk.scoreHistory(),
    queryFn: () => api.get<ScoreHistoryEntry[]>('/statements/score-history'),
  });
}

export function useRecurringCredits() {
  return useQuery({
    queryKey: qk.recurring(),
    queryFn: () => api.get<RecurringCredit[]>('/statements/recurring-credits'),
  });
}

export function useYearlySummaries() {
  return useQuery({
    queryKey: qk.yearly(),
    queryFn: () => api.get<YearlySummary[]>('/statements/yearly'),
  });
}

export function useYearlySummary(year: number | undefined) {
  return useQuery({
    queryKey: qk.yearly(year),
    queryFn: () => api.get<YearlySummary>(`/statements/yearly/${year}`),
    enabled: !!year,
  });
}

export function useBudget() {
  return useQuery({
    queryKey: qk.budget(),
    queryFn: () => api.get<Budget>('/budgets'),
  });
}

export function useUpdateBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (budget: Budget) => api.put<Budget>('/budgets', budget),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.budget() }),
  });
}

export function useDeclarations() {
  return useQuery({
    queryKey: qk.declarations(),
    queryFn: () => api.get<Declaration[]>('/declarations'),
  });
}

export function useCreateDeclaration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DeclarationInput) => api.post<Declaration>('/declarations', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.declarations() });
      qc.invalidateQueries({ queryKey: ['forecast'] });
    },
  });
}

export function useUpdateDeclaration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: DeclarationInput }) =>
      api.put<Declaration>(`/declarations/${id}`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.declarations() });
      qc.invalidateQueries({ queryKey: ['forecast'] });
    },
  });
}

export function useDeleteDeclaration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/declarations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.declarations() });
      qc.invalidateQueries({ queryKey: ['forecast'] });
    },
  });
}

export function useForecast(months = 12) {
  return useQuery({
    queryKey: qk.forecast(months),
    queryFn: () => api.get<ForecastMonth[]>(`/forecast?months=${months}`),
  });
}

export function useClaudeUsage() {
  return useQuery({
    queryKey: qk.claudeUsage(),
    queryFn: () => api.get<ClaudeUsage>('/claude/usage'),
  });
}

export function useUpdateClaudeBalance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (balanceUsd: number) => api.put<ClaudeUsage>('/claude/balance', { balanceUsd }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.claudeUsage() }),
  });
}

export function useUploadStatements() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (files: File[]) => {
      const form = new FormData();
      for (const f of files) form.append('files', f);
      return api.postForm<UploadResult>('/statements/upload', form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.statements() });
      qc.invalidateQueries({ queryKey: qk.scoreHistory() });
    },
  });
}

export function useDeleteStatement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/statements/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.statements() });
      qc.invalidateQueries({ queryKey: qk.scoreHistory() });
    },
  });
}

export function useReanalyzeStatement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const form = new FormData();
      form.append('file', file);
      return api.postForm<MonthlyStatement>(`/statements/${id}/reanalyze`, form);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: qk.statement(vars.id) });
      qc.invalidateQueries({ queryKey: qk.statements() });
      qc.invalidateQueries({ queryKey: qk.scoreHistory() });
    },
  });
}
