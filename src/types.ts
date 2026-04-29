export type CategoryId = 'nourriture' | 'transport' | 'vieCourante' | 'epargne' | 'projets' | 'plaisir' | 'imprevus';
export type IncomeType = 'base' | 'irregulier' | 'remboursement' | 'bonus';
export type ProjectPriority = 'balanced' | 'priority1' | 'urgency1';
export type TabId = 'home' | 'projects' | 'vault' | 'score';

export interface Expense {
  id: string;
  categoryId: CategoryId;
  amount: number;
  label: string;
  date: string; // ISO string
  projectId?: string;
}

export interface Project {
  id: string;
  name: string;
  targetAmount: number;
  deadline: string; // YYYY-MM
  savedSoFar: number;
  priority: 1 | 2 | 3; // 1=highest
  allocPct: number; // current % of base income allocated
}

export interface InternalDebt {
  id: string;
  from: CategoryId; // who got ponctured
  to: CategoryId;   // who benefited
  amount: number;
  date: string;
  reimbursed: boolean;
}

export interface MonthRecord {
  id: string;
  monthKey: string; // YYYY-MM
  monthName: string;
  baseIncome: number;
  totalExpensesByCategory: Record<CategoryId, number>;
  toBank: number;
  toLiquid: number;
  toProjects: number;
  toEmergency: number;
  healthScore: number;
  surplus: number;
}

export interface CategoryMeta {
  name: string;
  color: string;
  emoji: string;
  minPct: number;
  defPct: number;
}

export interface BudgetComputed {
  allocated: number;
  spent: number;
  remaining: number;
  pct: number;
  overBudget: boolean;
}

export interface EndOfMonthReport {
  surplus: number;
  toBank: number;
  toLiquid: number;
  toProjects: number;
  toEmergency: number;
  debtReimbursed: number;
  unusedEpargne: number;
  status: 'success' | 'warning' | 'neutral';
  message: string;
  suggestedAllocations?: Partial<Record<CategoryId, number>>;
  projectBoosts: Record<string, number>; // projectId -> amount
}

export interface AppState {
  appDate: string; // YYYY-MM-DD
  baseIncome: number;
  expenses: Expense[];
  allocations: Record<CategoryId, number>;
  projects: Project[];
  internalDebts: InternalDebt[];
  emergencyFund: number;
  bankBalance: number;
  liquidBalance: number;
  monthHistory: MonthRecord[];
}
