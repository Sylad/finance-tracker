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
  SavingsAccount,
  SavingsAccountInput,
  BalanceHistoryEntry,
  Loan,
  LoanInput,
  LoanSuggestion,
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

export const qkSavings = {
  all: () => ['savings'] as const,
  one: (id: string) => ['savings', id] as const,
  history: (id: string, months: number) => ['savings', id, 'history', months] as const,
};

export function useSavingsAccounts() {
  return useQuery({ queryKey: qkSavings.all(), queryFn: () => api.get<SavingsAccount[]>('/savings-accounts') });
}

export function useSavingsAccount(id: string | undefined) {
  return useQuery({
    queryKey: qkSavings.one(id ?? ''),
    queryFn: () => api.get<SavingsAccount>(`/savings-accounts/${id}`),
    enabled: !!id,
  });
}

export function useSavingsHistory(id: string | undefined, months = 12) {
  return useQuery({
    queryKey: qkSavings.history(id ?? '', months),
    queryFn: () => api.get<BalanceHistoryEntry[]>(`/savings-accounts/${id}/balance-history?months=${months}`),
    enabled: !!id,
  });
}

export function useCreateSavingsAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SavingsAccountInput) => api.post<SavingsAccount>('/savings-accounts', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qkSavings.all() }),
  });
}

export function useUpdateSavingsAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: SavingsAccountInput }) =>
      api.put<SavingsAccount>(`/savings-accounts/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qkSavings.all() }),
  });
}

export function useDeleteSavingsAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/savings-accounts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qkSavings.all() }),
  });
}

export function useAddSavingsMovement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: { date: string; amount: number; note?: string } }) =>
      api.post<SavingsAccount>(`/savings-accounts/${id}/movements`, body),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qkSavings.all() });
      qc.invalidateQueries({ queryKey: qkSavings.one(vars.id) });
    },
  });
}

export const qkLoans = {
  all: () => ['loans'] as const,
  one: (id: string) => ['loans', id] as const,
};

export function useLoans() {
  return useQuery({ queryKey: qkLoans.all(), queryFn: () => api.get<Loan[]>('/loans') });
}

export function useCreateLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoanInput) => api.post<Loan>('/loans', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qkLoans.all() }),
  });
}

export function useUpdateLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: LoanInput }) =>
      api.put<Loan>(`/loans/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qkLoans.all() }),
  });
}

export function useDeleteLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/loans/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qkLoans.all() }),
  });
}

export function useResetRevolving() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, usedAmount }: { id: string; usedAmount: number }) =>
      api.post<Loan>(`/loans/${id}/reset-revolving`, { usedAmount }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qkLoans.all() }),
  });
}

export const qkSuggestions = { all: () => ['loan-suggestions'] as const };

export function useLoanSuggestions() {
  return useQuery({
    queryKey: qkSuggestions.all(),
    queryFn: () => api.get<LoanSuggestion[]>('/loan-suggestions'),
  });
}

export function useAcceptSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, loanId }: { id: string; loanId: string }) =>
      api.post<LoanSuggestion>(`/loan-suggestions/${id}/accept`, { loanId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkSuggestions.all() });
      qc.invalidateQueries({ queryKey: qkLoans.all() });
    },
  });
}

export function useRejectSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<LoanSuggestion>(`/loan-suggestions/${id}/reject`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qkSuggestions.all() }),
  });
}

export function useSnoozeSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<LoanSuggestion>(`/loan-suggestions/${id}/snooze`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qkSuggestions.all() }),
  });
}
