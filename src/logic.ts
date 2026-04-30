import type { CategoryId, CategoryMeta, Project, MonthRecord, InternalDebt, BudgetComputed, EndOfMonthReport } from './types';

export const CATEGORIES: Record<CategoryId, CategoryMeta> = {
  nourriture:  { name: 'Nourriture',        color: '#22c55e', emoji: '', minPct: 0.05, defPct: 0.10 },
  transport:   { name: 'Transport',          color: '#f59e0b', emoji: '', minPct: 0.08, defPct: 0.13 },
  vieCourante: { name: 'Vie courante',       color: '#3b82f6', emoji: '', minPct: 0.10, defPct: 0.13 },
  epargne:     { name: 'Épargne sécurisée',  color: '#8b5cf6', emoji: '', minPct: 0.10, defPct: 0.20 },
  projets:     { name: 'Projets',            color: '#ec4899', emoji: '', minPct: 0.00, defPct: 0.24 },
  plaisir:     { name: 'Plaisir',            color: '#06b6d4', emoji: '', minPct: 0.05, defPct: 0.15 },
  imprevus:    { name: 'Imprévus',           color: '#f43f5e', emoji: '', minPct: 0.03, defPct: 0.05 },
};

export const DEFAULT_ALLOCATIONS: Record<CategoryId, number> = {
  nourriture: 0.10, transport: 0.13, vieCourante: 0.13,
  epargne: 0.20, projets: 0.24, plaisir: 0.15, imprevus: 0.05,
};

// Répartition des % projets selon priorité
export function getProjectAllocPcts(count: number, mode: 'balanced'|'priority1'|'urgency1'): number[] {
  if (count === 0) return [];
  if (count === 1) return [0.24];
  if (count === 2) {
    if (mode === 'balanced') return [0.12, 0.12];
    if (mode === 'priority1') return [0.15, 0.09];
    return [0.18, 0.06];
  }
  // 3 projets -> 24% max total
  if (mode === 'balanced') return [0.08, 0.08, 0.08];
  if (mode === 'priority1') return [0.12, 0.07, 0.05];
  return [0.15, 0.06, 0.03];
}

// Capacité max projets = revenu_base * 15% * 60% = 9%
export function maxProjectCapacity(baseIncome: number): number {
  return baseIncome * 0.15 * 0.60;
}

// Mois restants avant deadline
export function remainingMonths(deadlineYYYYMM: string, currentDateStr: string): number {
  const [ty, tm] = deadlineYYYYMM.split('-').map(Number);
  const [cy, cm] = currentDateStr.slice(0, 7).split('-').map(Number);
  return Math.max(1, (ty - cy) * 12 + (tm - cm));
}

// Durée estimée : (cible - épargné) / moyenne cotisations 3 mois
export function estimatedDuration(project: Project, history: MonthRecord[]): number | null {
  const relevant = history.slice(0, 3).map(m => m.totalExpensesByCategory.projets || 0).filter(v => v > 0);
  if (relevant.length === 0) return null;
  const avgMonthly = relevant.reduce((a, b) => a + b, 0) / relevant.length;
  if (avgMonthly <= 0) return null;
  return Math.ceil((project.targetAmount - project.savedSoFar) / avgMonthly);
}

// Revenu de base stabilisé : moyenne 3 derniers mois si variable
export function stabilizedBaseIncome(current: number, history: MonthRecord[]): number {
  if (history.length < 2) return current;
  const last3 = [current, ...history.slice(0, 2).map(m => m.baseIncome)];
  return last3.reduce((a, b) => a + b, 0) / last3.length;
}

// Calcul du budget et du bouclier anti-déficit
export function computeBudgets(
  baseIncome: number,
  expenses: { categoryId: CategoryId; amount: number }[],
  allocations: Record<CategoryId, number>,
  projects: Project[]
): {
  budgets: Record<CategoryId, BudgetComputed>;
  debts: Array<{ from: CategoryId; to: CategoryId; amount: number }>;
  alerts: string[];
  totalSpent: number;
  epargneTriggered: boolean;
} {
  // Si pas de projets → pas d'allocation projet
  const hasProjects = projects.length > 0;
  const projetsAlloc = hasProjects ? (allocations.projets ?? 0.24) : 0;
  const epargneBonus = 0; // On ne bascule plus automatiquement sur l'épargne

  const raw: Record<CategoryId, number> = {
    nourriture:  baseIncome * (allocations.nourriture  ?? 0.10),
    transport:   baseIncome * (allocations.transport   ?? 0.13),
    vieCourante: baseIncome * (allocations.vieCourante ?? 0.13),
    epargne:     baseIncome * ((allocations.epargne    ?? 0.20) + epargneBonus),
    projets:     baseIncome * projetsAlloc,
    plaisir:     baseIncome * (allocations.plaisir     ?? 0.15),
    imprevus:    baseIncome * (allocations.imprevus    ?? 0.05),
  };

  const spentByCat: Record<CategoryId, number> = { nourriture: 0, transport: 0, vieCourante: 0, epargne: 0, projets: 0, plaisir: 0, imprevus: 0 };
  let totalSpent = 0;
  expenses.forEach(e => { spentByCat[e.categoryId] += e.amount; totalSpent += e.amount; });

  // Bouclier : copie mutable des budgets disponibles
  const avail = { ...raw };
  const newDebts: Array<{ from: CategoryId; to: CategoryId; amount: number }> = [];
  const alerts: string[] = [];
  let epargneTriggered = false;

  const shield = (cat: CategoryId) => {
    let deficit = spentByCat[cat] - avail[cat];
    if (deficit <= 0) return;
    avail[cat] += deficit; // renfloue la poche en dépassement

    alerts.push(`⚠️ Dépassement ${CATEGORIES[cat].name}.`);

    // 0. Imprévus (Premier rempart)
    const imprevusAvail = Math.max(0, avail.imprevus - spentByCat.imprevus);
    if (deficit > 0 && imprevusAvail > 0 && cat !== 'imprevus') {
      const t = Math.min(deficit, imprevusAvail);
      avail.imprevus -= t; deficit -= t;
      newDebts.push({ from: 'imprevus', to: cat, amount: t });
    }

    if (deficit > 0) {
      alerts.push(`🛡️ Bouclier anti-déficit activé pour ${CATEGORIES[cat].name}.`);
    }

    // 1. Plaisir (plancher 5%)
    const plaisirFloor = baseIncome * CATEGORIES.plaisir.minPct;
    const plaisirAvail = Math.max(0, avail.plaisir - spentByCat.plaisir - plaisirFloor);
    if (deficit > 0 && plaisirAvail > 0 && cat !== 'plaisir') {
      const t = Math.min(deficit, plaisirAvail);
      avail.plaisir -= t; deficit -= t;
      newDebts.push({ from: 'plaisir', to: cat, amount: t });
    }

    // 2. Projets (cotisations uniquement)
    const projAvail = Math.max(0, avail.projets - spentByCat.projets);
    if (deficit > 0 && projAvail > 0 && cat !== 'projets') {
      const t = Math.min(deficit, projAvail);
      avail.projets -= t; deficit -= t;
      newDebts.push({ from: 'projets', to: cat, amount: t });
    }

    // 3. Vie courante (part non vitale, plancher 10%)
    const vieFloor = baseIncome * CATEGORIES.vieCourante.minPct;
    const vieAvail = Math.max(0, avail.vieCourante - spentByCat.vieCourante - vieFloor);
    if (deficit > 0 && vieAvail > 0 && cat !== 'vieCourante') {
      const t = Math.min(deficit, vieAvail);
      avail.vieCourante -= t; deficit -= t;
      newDebts.push({ from: 'vieCourante', to: cat, amount: t });
    }

    // 4. Épargne → Alerte rouge
    const epargneAvail = Math.max(0, avail.epargne - spentByCat.epargne);
    if (deficit > 0 && epargneAvail > 0 && cat !== 'epargne') {
      const t = Math.min(deficit, epargneAvail);
      avail.epargne -= t;
      newDebts.push({ from: 'epargne', to: cat, amount: t });
      epargneTriggered = true;
      alerts.push(`🔴 ALERTE : Épargne ponctionnée pour couvrir ${CATEGORIES[cat].name} (${Math.round(t).toLocaleString('fr-FR')} F)`);
    }
  };

  (['nourriture', 'transport', 'vieCourante', 'plaisir', 'projets', 'imprevus'] as CategoryId[]).forEach(shield);

  // Alertes mi-mois
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthProgress = dayOfMonth / daysInMonth;
  
  Object.entries(spentByCat).forEach(([cat, spent]) => {
    const budget = avail[cat as CategoryId];
    if (budget <= 0) return;
    const ratio = spent / budget;
    if (ratio >= 0.8 && ratio < 1 && monthProgress < 0.6) {
      alerts.push(`⏰ Tu as dépensé ${Math.round(ratio*100)}% de ${CATEGORIES[cat as CategoryId].name} au ${dayOfMonth} du mois.`);
    }
    if (cat === 'plaisir' && spent === 0 && monthProgress >= 0.5) {
      alerts.push(`💡 Ton Plaisir est intact à mi-mois. Profites-en !`);
    }
  });

  const budgets: Record<CategoryId, BudgetComputed> = {} as any;
  (Object.keys(CATEGORIES) as CategoryId[]).forEach(cat => {
    const allocated = avail[cat];
    const spent = spentByCat[cat];
    budgets[cat] = {
      allocated, spent,
      remaining: allocated - spent,
      pct: allocated > 0 ? Math.min((spent / allocated) * 100, 100) : 0,
      overBudget: spent > raw[cat],
    };
  });

  return { budgets, debts: newDebts, alerts, totalSpent, epargneTriggered };
}

// Suggestions de rééquilibrage basées sur 2 mois consécutifs
export function computeRebalanceSuggestions(
  history: MonthRecord[],
  allocations: Record<CategoryId, number>
): Partial<Record<CategoryId, { action: 'up' | 'down'; reason: string }>> {
  if (history.length < 2) return {};
  const [m1, m2] = history.slice(0, 2);
  const suggestions: Partial<Record<CategoryId, { action: 'up' | 'down'; reason: string }>> = {};
  
  (Object.keys(CATEGORIES) as CategoryId[]).forEach(cat => {
    const alloc = allocations[cat] ?? DEFAULT_ALLOCATIONS[cat];
    const used1 = m1.baseIncome > 0 ? (m1.totalExpensesByCategory[cat] ?? 0) / m1.baseIncome : 0;
    const used2 = m2.baseIncome > 0 ? (m2.totalExpensesByCategory[cat] ?? 0) / m2.baseIncome : 0;
    if (used1 < alloc * 0.7 && used2 < alloc * 0.7) {
      suggestions[cat] = { action: 'down', reason: `Sous-utilisé 2 mois consécutifs (moy. ${Math.round((used1+used2)/2*100)}%)` };
    } else if (used1 > alloc && used2 > alloc) {
      suggestions[cat] = { action: 'up', reason: `Dépassé 2 mois consécutifs (moy. ${Math.round((used1+used2)/2*100)}%)` };
    }
  });
  return suggestions;
}

// Score de santé financière
export function computeHealthScore(params: {
  epargneTriggered: boolean;
  projectsOnTrack: boolean;
  hasSurplus: boolean;
  plaisirPreserved: boolean;
  emergencyFundOk: boolean;
}): number {
  let score = 0;
  if (!params.epargneTriggered)  score += 30;
  if (params.projectsOnTrack)    score += 25;
  if (params.hasSurplus)         score += 20;
  if (params.plaisirPreserved)   score += 15;
  if (params.emergencyFundOk)    score += 10;
  return score;
}

// Calcul du rapport de clôture mensuelle
export function computeEndOfMonth(params: {
  baseIncome: number;
  budgets: Record<CategoryId, BudgetComputed>;
  projects: Project[];
  internalDebts: InternalDebt[];
  emergencyFund: number;
  urgencyTarget: number;
}): EndOfMonthReport {
  const { baseIncome, budgets, projects, internalDebts, emergencyFund, urgencyTarget } = params;
  
  const totalSpent = Object.values(budgets).reduce((s, b) => s + b.spent, 0);
  let surplus = baseIncome - totalSpent;
  
  let toBank = 0, toLiquid = 0, toProjects = 0, toEmergency = 0, debtReimbursed = 0;
  const projectBoosts: Record<string, number> = {};

  // Épargne non consommée → liquide
  const unusedEpargne = Math.max(0, budgets.epargne.remaining);
  
  // Plaisir restant → épargne (sauf < 500F → liquide)
  const leftPlaisir = Math.max(0, budgets.plaisir.remaining);
  
  // Reliquats Nourriture, Transport, Vie courante, Imprévus → Épargne
  ['nourriture', 'transport', 'vieCourante', 'imprevus'].forEach(cat => {
    const left = Math.max(0, budgets[cat as CategoryId].remaining);
    toBank += left;
  });
  if (leftPlaisir < 500) {
    toLiquid += leftPlaisir;
  } else {
    toBank += leftPlaisir;
  }

  // Reliquat Projets → capital des projets
  const leftProjets = Math.max(0, budgets.projets.remaining);
  if (projects.length > 0 && leftProjets > 0) {
    const share = leftProjets / projects.length;
    projects.forEach(p => { projectBoosts[p.id] = (projectBoosts[p.id] ?? 0) + share; });
    toProjects += leftProjets;
  }

  // Épargne non consommée → liquide (selon règle)
  toLiquid += unusedEpargne;

  // Étape 1 : reconstitution épargne ponctionnée
  const totalDebt = internalDebts.filter(d => d.from === 'epargne' && !d.reimbursed)
    .reduce((s, d) => s + d.amount, 0);
  if (totalDebt > 0 && surplus > 0) {
    const remb = Math.min(surplus, totalDebt);
    debtReimbursed = remb;
    toBank += remb;
    surplus -= remb;
  }

  // Étape 2a : Fonds d'urgence en priorité
  const urgencyNeed = Math.max(0, urgencyTarget - emergencyFund);
  if (surplus > 0 && urgencyNeed > 0) {
    const alloc = Math.min(surplus, urgencyNeed);
    toEmergency += alloc;
    surplus -= alloc;
  }

  // Étape 2b : Redistribution surplus restant
  let status: 'success' | 'warning' | 'neutral' = 'neutral';
  let message = '';

  if (surplus > 0) {
    status = 'success';
    if (projects.length > 0) {
      toBank += surplus * 0.50;
      const boostShare = surplus * 0.50;
      projects.forEach(p => { projectBoosts[p.id] = (projectBoosts[p.id] ?? 0) + boostShare / projects.length; });
      toProjects += boostShare;
      message = `Surplus de ${Math.round(surplus).toLocaleString('fr-FR')} F : 50% Banque, 50% Projets.`;
    } else {
      // Si pas de projets, tout va à la banque pour sécuriser
      toBank += surplus;
      message = `Surplus de ${Math.round(surplus).toLocaleString('fr-FR')} F intégralement versé à la Banque.`;
    }
  } else {
    status = 'warning';
    message = `Déficit ce mois. Suggestion : −10% Plaisir, +10% Épargne le mois prochain.`;
  }

  return { surplus, toBank, toLiquid, toProjects, toEmergency, debtReimbursed, unusedEpargne, status, message, projectBoosts };
}

export const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');
