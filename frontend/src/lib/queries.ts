import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type {
  Budget,
  ClaudeUsage,
  Declaration,
  DeclarationInput,
  ForecastMonth,
  ImportLoanStatementResult,
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
  Subscription,
  SubscriptionInput,
  NetWorth,
  DashboardAlert,
  YearlyOverview,
  ImportLog,
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

export const qkImportLogs = { all: () => ['import-logs'] as const };

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
      qc.invalidateQueries({ queryKey: qkImportLogs.all() });
    },
  });
}

export interface CreditStatementImportResult {
  results: Array<{
    filename: string;
    loanId?: string;
    created?: boolean;
    matched?: boolean;
    creditor?: string;
    accountNumber?: string | null;
    monthlyPayment?: number;
    error?: string;
  }>;
}

/**
 * Upload multi-PDF de relevés de crédit avec matching automatique.
 * Pour chaque PDF, le backend extrait le N° de contrat (Claude) et matche
 * un Loan existant via contractRef. S'il n'y a pas de match, crée un
 * nouveau Loan pré-rempli. Pas de choix manuel à faire côté UI.
 */
export function useImportCreditStatements() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (files: File[]) => {
      const form = new FormData();
      for (const f of files) form.append('files', f);
      return api.postForm<CreditStatementImportResult>('/loans/import-credit-statements', form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loans'] });
      qc.invalidateQueries({ queryKey: qk.statements() });
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

export function useSplitLoanByAmount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ split: boolean; createdCount: number; groups: { amount: number; count: number }[] }>(`/loans/${id}/split-by-amount`),
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

export function useAcceptSubscriptionSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, subscriptionId }: { id: string; subscriptionId: string }) =>
      api.post<LoanSuggestion>(`/loan-suggestions/${id}/accept`, { subscriptionId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkSuggestions.all() });
      qc.invalidateQueries({ queryKey: qkSubscriptions.all() });
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

export function useUnsnoozeSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<LoanSuggestion>(`/loan-suggestions/${id}/unsnooze`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qkSuggestions.all() }),
  });
}

export const qkSubscriptions = {
  all: () => ['subscriptions'] as const,
  one: (id: string) => ['subscriptions', id] as const,
};

export function useSubscriptions() {
  return useQuery({
    queryKey: qkSubscriptions.all(),
    queryFn: () => api.get<Subscription[]>('/subscriptions'),
  });
}

export function useCreateSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SubscriptionInput) => api.post<Subscription>('/subscriptions', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qkSubscriptions.all() }),
  });
}

export function useUpdateSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: SubscriptionInput }) =>
      api.put<Subscription>(`/subscriptions/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qkSubscriptions.all() }),
  });
}

export function useDeleteSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/subscriptions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qkSubscriptions.all() }),
  });
}

export function useResyncSavings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ rescanned: number }>(`/auto-sync/savings/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkSavings.all() });
    },
  });
}

export function useResyncLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, baselineUsedAmount }: { id: string; baselineUsedAmount?: number }) =>
      api.post<{ rescanned: number }>(
        `/auto-sync/loans/${id}`,
        baselineUsedAmount !== undefined ? { baselineUsedAmount } : undefined,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkLoans.all() });
    },
  });
}

export function useImportLoanStatement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => {
      const form = new FormData();
      form.append('file', file);
      return api.postForm<ImportLoanStatementResult>(`/loans/${id}/import-statement`, form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkLoans.all() });
    },
  });
}

export function useNetWorth() {
  return useQuery({ queryKey: ['dashboard', 'net-worth'], queryFn: () => api.get<NetWorth>('/dashboard/net-worth') });
}
export function useAlerts() {
  return useQuery({ queryKey: ['dashboard', 'alerts'], queryFn: () => api.get<DashboardAlert[]>('/dashboard/alerts') });
}
export function useYearlyOverview(months = 12) {
  return useQuery({ queryKey: ['dashboard', 'yearly', months], queryFn: () => api.get<YearlyOverview>(`/dashboard/yearly-overview?months=${months}`) });
}

export function useImportLogs() {
  return useQuery({
    queryKey: qkImportLogs.all(),
    queryFn: () => api.get<ImportLog[]>('/import-logs'),
    // Polling rapide quand au moins 1 import est en cours, sinon mou.
    refetchInterval: (q) => {
      const data = q.state.data as ImportLog[] | undefined;
      return data?.some((l) => l.status === 'in-progress') ? 2000 : 10000;
    },
  });
}
