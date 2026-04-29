import React, { useState, useMemo, useEffect } from 'react';
import { 
  TrendingUp, TrendingDown, Plus, ArrowRight, AlertTriangle, 
  CheckCircle, Flag, RotateCcw, ShieldCheck, X, Calendar, 
  Landmark, History, Banknote, Home, Target, Settings,
  Briefcase, Zap, Handshake, Gift, Utensils, Car, House, 
  Shield, Rocket, PartyPopper, Siren, Loader2
} from 'lucide-react';
import { supabase } from './supabase';
import type { CategoryId, IncomeType, Expense, Project, InternalDebt, MonthRecord, AppState, TabId } from './types';
import { CATEGORIES, DEFAULT_ALLOCATIONS, computeBudgets, computeEndOfMonth, computeHealthScore, stabilizedBaseIncome, fmt } from './logic';

const CATEGORY_ICONS: Record<CategoryId, React.ReactNode> = {
  nourriture: <Utensils size={16} />,
  transport: <Car size={16} />,
  vieCourante: <House size={16} />,
  epargne: <Shield size={16} />,
  projets: <Rocket size={16} />,
  plaisir: <PartyPopper size={16} />,
  imprevus: <Siren size={16} />,
};

function App() {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('home');
  const [state, setState] = useState<AppState>({
    appDate: new Date().toISOString().slice(0, 10),
    baseIncome: 0,
    expenses: [],
    allocations: DEFAULT_ALLOCATIONS,
    projects: [],
    internalDebts: [],
    emergencyFund: 0,
    bankBalance: 0,
    liquidBalance: 0,
    monthHistory: []
  });

  // Charger les données depuis Supabase
  useEffect(() => {
    async function loadData() {
      try {
        const { data: profile } = await supabase.from('user_profiles').select('*').single();
        const { data: expenses } = await supabase.from('expenses').select('*').order('date', { ascending: false });
        const { data: projects } = await supabase.from('projects').select('*');

        if (profile) {
          setState(prev => ({
            ...prev,
            baseIncome: profile.base_income || 0,
            emergencyFund: profile.emergency_fund || 0,
            bankBalance: profile.bank_balance || 0,
            liquid_balance: profile.liquid_balance || 0,
            appDate: profile.app_date || prev.appDate
          }));
        }
        if (expenses) {
          setState(prev => ({ ...prev, expenses: expenses.map(e => ({ id: e.id, categoryId: e.category_id as CategoryId, amount: e.amount, label: e.label, date: e.date })) }));
        }
        if (projects) {
          setState(prev => ({ ...prev, projects: projects.map(p => ({ id: p.id, name: p.name, targetAmount: p.target_amount, savedSoFar: p.saved_so_far, deadline: p.deadline, priority: p.priority as any, allocPct: 0 })) }));
        }
      } catch (err) {
        console.error("Erreur de chargement Supabase:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Synchroniser les changements vers Supabase (Debounced ou via actions)
  const syncProfile = async (updates: any) => {
    await supabase.from('user_profiles').upsert({ id: '00000000-0000-0000-0000-000000000000', ...updates }); // Note: Utiliser ID réel si Auth activé
  };

  const [uiState, setUiState] = useState({
    showAddMoney: false,
    showAddExpense: false,
    showAddProject: false,
    moneyAmount: '',
    incomeType: 'base' as IncomeType,
    expenseAmount: '',
    expenseLabel: '',
    expenseCategory: 'nourriture' as CategoryId,
    projName: '',
    projTarget: '',
    projDeadline: '',
    projPriority: 1 as 1 | 2 | 3,
    isMonthClosed: false,
    endOfMonthReport: null as any
  });

  const appDateObj = new Date(state.appDate);
  const formattedMonth = appDateObj.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const stabilizedBase = useMemo(() => stabilizedBaseIncome(state.baseIncome, state.monthHistory), [state.baseIncome, state.monthHistory]);
  
  const { budgets, alerts, totalSpent, epargneTriggered, debts } = useMemo(() => 
    computeBudgets(stabilizedBase, state.expenses, state.allocations, state.projects),
  [stabilizedBase, state.expenses, state.allocations, state.projects]);

  const healthScore = useMemo(() => computeHealthScore({
    epargneTriggered,
    projectsOnTrack: true,
    hasSurplus: (stabilizedBase - totalSpent) > 0,
    plaisirPreserved: budgets.plaisir.remaining >= (stabilizedBase * 0.05),
    emergencyFundOk: state.emergencyFund >= (stabilizedBase * 0.4 * 3)
  }), [epargneTriggered, stabilizedBase, totalSpent, budgets, state.emergencyFund]);

  const handleAddMoney = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(uiState.moneyAmount);
    if (isNaN(amount) || amount <= 0) return;
    
    setState(prev => {
      const next = { ...prev };
      let updates: any = {};
      
      if (uiState.incomeType === 'base') { 
        next.baseIncome += amount; 
        updates.base_income = next.baseIncome;
      }
      else if (uiState.incomeType === 'irregulier') { 
        next.bankBalance += amount * 0.5; 
        next.liquidBalance += amount * 0.5; 
        updates.bank_balance = next.bankBalance;
        updates.liquid_balance = next.liquidBalance;
      }
      else if (uiState.incomeType === 'remboursement') { 
        next.liquidBalance += amount; 
        updates.liquid_balance = next.liquidBalance;
      }
      else if (uiState.incomeType === 'bonus') {
        next.bankBalance += amount * 0.7;
        updates.bank_balance = next.bankBalance;
        if (next.projects.length > 0) {
          const share = (amount * 0.3) / next.projects.length;
          next.projects = next.projects.map(p => ({ ...p, savedSoFar: p.savedSoFar + share }));
          // Note: Il faudrait sync chaque projet individuellement ici
        } else { 
          next.liquidBalance += amount * 0.3; 
          updates.liquid_balance = next.liquidBalance;
        }
      }
      syncProfile(updates);
      return next;
    });
    setUiState(s => ({ ...s, moneyAmount: '', showAddMoney: false }));
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(uiState.expenseAmount);
    const label = uiState.expenseLabel.trim();
    if (isNaN(amount) || amount <= 0 || !label) return;

    const { data: newExpSup } = await supabase.from('expenses').insert({
      user_id: '00000000-0000-0000-0000-000000000000', // ID fictif sans auth
      category_id: uiState.expenseCategory,
      amount,
      label,
      date: new Date().toISOString()
    }).select().single();

    if (newExpSup) {
      const newExp: Expense = { id: newExpSup.id, categoryId: uiState.expenseCategory, amount, label, date: newExpSup.date };
      setState(prev => ({ 
        ...prev, 
        expenses: [newExp, ...prev.expenses],
        internalDebts: [...prev.internalDebts, ...debts.map(d => ({...d, id: crypto.randomUUID(), date: new Date().toISOString(), reimbursed: false}))]
      }));
    }
    setUiState(s => ({ ...s, expenseAmount: '', expenseLabel: '', showAddExpense: false }));
  };

  const handleAddProject = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = parseFloat(uiState.projTarget);
    if (t > 0 && uiState.projName) {
      const { data: newProjSup } = await supabase.from('projects').insert({
        user_id: '00000000-0000-0000-0000-000000000000',
        name: uiState.projName,
        target_amount: t,
        deadline: uiState.projDeadline,
        priority: uiState.projPriority
      }).select().single();

      if (newProjSup) {
        setState(p => ({
          ...p,
          projects: [
            ...p.projects,
            { id: newProjSup.id, name: uiState.projName, targetAmount: t, deadline: uiState.projDeadline, savedSoFar: 0, priority: uiState.projPriority, allocPct: 0 }
          ]
        }));
      }
      setUiState(s => ({ ...s, projName: '', projTarget: '', projDeadline: '', projPriority: 1, showAddProject: false }));
    }
  };

  const handleCloseMonth = () => {
    const report = computeEndOfMonth({ baseIncome: stabilizedBase, budgets, projects: state.projects, internalDebts: state.internalDebts, emergencyFund: state.emergencyFund, urgencyTarget: stabilizedBase * 0.4 * 3 });
    setUiState(s => ({ ...s, isMonthClosed: true, endOfMonthReport: report }));
  };

  const handleNextMonth = () => {
    const r = uiState.endOfMonthReport;
    if (!r) return;
    setState(prev => {
      const nextDate = new Date(appDateObj); nextDate.setMonth(nextDate.getMonth() + 1);
      const nextProjects = prev.projects.map(p => ({ ...p, savedSoFar: p.savedSoFar + (r.projectBoosts[p.id] || 0) })).filter(p => p.savedSoFar < p.targetAmount);
      return {
        ...prev, appDate: nextDate.toISOString().slice(0, 10), baseIncome: 0, expenses: [],
        bankBalance: prev.bankBalance + r.toBank, liquidBalance: prev.liquidBalance + r.toLiquid, emergencyFund: prev.emergencyFund + r.toEmergency,
        projects: nextProjects, monthHistory: [{ id: crypto.randomUUID(), monthKey: appDateObj.toISOString().slice(0, 7), monthName: formattedMonth, baseIncome: prev.baseIncome, totalExpensesByCategory: (Object.keys(CATEGORIES) as CategoryId[]).reduce((a, c) => ({...a, [c]: prev.expenses.filter(e => e.categoryId === c).reduce((s, x) => s + x.amount, 0)}), {} as any), toBank: r.toBank, toLiquid: r.toLiquid, toProjects: r.toProjects, toEmergency: r.toEmergency, healthScore, surplus: r.surplus }, ...prev.monthHistory]
      };
    });
    setUiState(s => ({ ...s, isMonthClosed: false, endOfMonthReport: null }));
  };

  if (loading) {
    return (
      <div className="app-container" style={{justifyContent:'center', alignItems:'center'}}>
        <Loader2 className="animate-spin" size={48} color="var(--accent-primary)"/>
        <p style={{marginTop:16, color:'var(--text-secondary)'}}>Connexion à Supabase...</p>
      </div>
    );
  }

  if (uiState.isMonthClosed && uiState.endOfMonthReport) {
    return (
      <div className="app-container" style={{ justifyContent: 'center' }}>
        <div className="glass-panel" style={{ padding: 32, textAlign: 'center' }}>
          {uiState.endOfMonthReport.status === 'success' ? <CheckCircle size={64} color="var(--success)" style={{margin:'0 auto 16px'}} /> : <AlertTriangle size={64} color="var(--warning)" style={{margin:'0 auto 16px'}} />}
          <h2>Bilan de {formattedMonth}</h2>
          <p style={{margin:'16px 0'}}>{uiState.endOfMonthReport.message}</p>
          <button className="btn btn-primary" onClick={handleNextMonth} style={{width:'100%'}}><RotateCcw size={18} /> Mois suivant</button>
        </div>
      </div>
    );
  }

  const scoreColor = healthScore > 70 ? 'var(--success)' : 'var(--warning)';

  return (
    <div className="app-container">
      {activeTab === 'home' && (
        <div className="tab-content">
          <header className="header">
            <div>
              <h1 className="gradient-text">Finance AI</h1>
              <div style={{fontSize:'0.85rem', color:'var(--text-secondary)', display:'flex', alignItems:'center', gap:4}}>
                <Calendar size={14}/> {formattedMonth}
              </div>
            </div>
          </header>
          
          {alerts.map((al, i) => (
            <div key={i} className="glass-panel" style={{padding:12, borderLeft:'4px solid var(--warning)', marginBottom:8, fontSize:'0.9rem'}}>
              {al}
            </div>
          ))}
          
          <section className="glass-panel balance-card">
            <div style={{display:'flex', justifyContent:'space-between', fontSize:'0.9rem'}}><span>Reste à vivre</span><span>Score: {healthScore}</span></div>
            <h2 className="balance-amount">{fmt(stabilizedBase - totalSpent)} F</h2>
            <div style={{display:'flex', gap:16, fontSize:'0.85rem', marginTop:12}}>
              <span style={{color:'var(--success)', display:'flex', alignItems:'center', gap:4}}><TrendingUp size={14}/> {fmt(stabilizedBase)} F</span>
              <span style={{color:'var(--danger)', display:'flex', alignItems:'center', gap:4}}><TrendingDown size={14}/> {fmt(totalSpent)} F</span>
            </div>
          </section>

          <section className="quick-actions">
            <button className="btn btn-primary" onClick={() => setUiState(s=>({...s, showAddMoney:!s.showAddMoney, showAddExpense:false}))}>+ Revenu</button>
            <button className="btn btn-secondary" onClick={() => setUiState(s=>({...s, showAddExpense:!s.showAddExpense, showAddMoney:false}))} disabled={stabilizedBase===0}>- Dépense</button>
          </section>

          {uiState.showAddMoney && (
            <form className="glass-panel" style={{padding:20, marginBottom:16}} onSubmit={handleAddMoney}>
              <select className="input-field" style={{width:'100%', marginBottom:4}} value={uiState.incomeType} onChange={e=>setUiState(s=>({...s, incomeType:e.target.value as any}))}>
                <option value="base">Revenu de Base</option>
                <option value="irregulier">Revenu Irrégulier</option>
                <option value="remboursement">Remboursement</option>
                <option value="bonus">Bonus / Prime</option>
              </select>
              <div style={{fontSize:'0.8rem', color:'var(--text-secondary)', marginBottom:16, padding:'12px', background:'rgba(0,0,0,0.2)', borderRadius:'12px', border:'1px solid var(--glass-border)'}}>
                {uiState.incomeType === 'base' && (
                  <div>
                    <strong style={{color:'var(--accent-primary)', display:'flex', alignItems:'center', gap:6, marginBottom:4}}>
                      <Briefcase size={14}/> DÉFINITION : SALAIRE
                    </strong>
                    <p>Revenu mensuel prévisible.</p>
                    <div style={{marginTop:8, fontSize:'0.75rem', borderTop:'1px solid var(--glass-border)', paddingTop:8}}>
                      RÈGLE : 100% réparti entre vos 7 poches.
                    </div>
                  </div>
                )}
                {uiState.incomeType === 'irregulier' && (
                  <div>
                    <strong style={{color:'var(--accent-secondary)', display:'flex', alignItems:'center', gap:6, marginBottom:4}}>
                      <Zap size={14}/> DÉFINITION : VENTES
                    </strong>
                    <p>Argent gagné de manière ponctuelle.</p>
                    <div style={{marginTop:8, fontSize:'0.75rem', borderTop:'1px solid var(--glass-border)', paddingTop:8}}>
                      RÈGLE : 50% Épargne directe / 50% Libre.
                    </div>
                  </div>
                )}
                {uiState.incomeType === 'remboursement' && (
                  <div>
                    <strong style={{color:'var(--success)', display:'flex', alignItems:'center', gap:6, marginBottom:4}}>
                      <Handshake size={14}/> DÉFINITION : RETOUR
                    </strong>
                    <p>Argent prêté qui vous revient.</p>
                    <div style={{marginTop:8, fontSize:'0.75rem', borderTop:'1px solid var(--glass-border)', paddingTop:8}}>
                      RÈGLE : 100% disponible immédiatement.
                    </div>
                  </div>
                )}
                {uiState.incomeType === 'bonus' && (
                  <div>
                    <strong style={{color:'var(--accent-tertiary)', display:'flex', alignItems:'center', gap:6, marginBottom:4}}>
                      <Gift size={14}/> DÉFINITION : CADEAUX
                    </strong>
                    <p>Argent reçu exceptionnellement.</p>
                    <div style={{marginTop:8, fontSize:'0.75rem', borderTop:'1px solid var(--glass-border)', paddingTop:8}}>
                      RÈGLE : 70% Banque / 30% Projets.
                    </div>
                  </div>
                )}
              </div>
              <input type="number" className="input-field" style={{width:'100%', marginBottom:8}} value={uiState.moneyAmount} onChange={e=>setUiState(s=>({...s, moneyAmount:e.target.value}))} placeholder="Montant" required />
              <button className="btn btn-primary" style={{width:'100%'}}>Ajouter</button>
            </form>
          )}

          {uiState.showAddExpense && (
            <form className="glass-panel" style={{padding:20, marginBottom:16}} onSubmit={handleAddExpense}>
              <input className="input-field" style={{width:'100%', marginBottom:8}} value={uiState.expenseLabel} onChange={e=>setUiState(s=>({...s, expenseLabel:e.target.value}))} placeholder="Libellé" required />
              <input type="number" className="input-field" style={{width:'100%', marginBottom:8}} value={uiState.expenseAmount} onChange={e=>setUiState(s=>({...s, expenseAmount:e.target.value}))} placeholder="Montant" required />
              <select className="input-field" style={{width:'100%', marginBottom:8}} value={uiState.expenseCategory} onChange={e=>setUiState(s=>({...s, expenseCategory:e.target.value as any}))}>
                {(Object.keys(CATEGORIES) as CategoryId[]).map(k=>(
                  <option key={k} value={k}>{CATEGORIES[k].name}</option>
                ))}
              </select>
              <button className="btn btn-primary" style={{width:'100%'}}>Déduire</button>
            </form>
          )}

          <section className="glass-panel" style={{padding:20}}>
            <h3 style={{marginBottom:16, fontSize:'1.1rem', fontWeight:600}}>Budgets mensuels</h3>
            {(Object.keys(CATEGORIES) as CategoryId[]).map(k => {
              const b = budgets[k]; const c = CATEGORIES[k];
              return (
                <div key={k} style={{marginBottom:16}}>
                  <div style={{display:'flex', justifyContent:'space-between', fontSize:'0.9rem', marginBottom:4}}>
                    <span style={{display:'flex', alignItems:'center', gap:8}}>{CATEGORY_ICONS[k]} {c.name}</span>
                    <span style={{color:b.overBudget?'var(--danger)':'inherit', fontWeight:600}}>{fmt(b.remaining)} F</span>
                  </div>
                  <div className="category-progress-container"><div className="category-progress-bar" style={{width:`${b.pct}%`, backgroundColor:b.overBudget?'var(--danger)':c.color}}/></div>
                </div>
              );
            })}
          </section>
          <button className="btn btn-secondary" style={{width:'100%', marginTop:16}} onClick={handleCloseMonth} disabled={stabilizedBase===0}>Clôturer le mois</button>
        </div>
      )}

      {activeTab === 'projects' && (
        <div className="tab-content">
          <header className="header"><h1>Projets</h1></header>
          <button className="btn btn-primary" style={{width:'100%', marginBottom:16}} onClick={()=>setUiState(s=>({...s, showAddProject:!s.showAddProject}))}>+ Nouveau projet</button>
          {uiState.showAddProject && (
            <form className="glass-panel" style={{padding:20, marginBottom:16}} onSubmit={handleAddProject}>
              <div style={{display:'grid', gap:8, marginBottom:12}}>
                <input className="input-field" value={uiState.projName} onChange={e=>setUiState(s=>({...s, projName:e.target.value}))} placeholder="Nom du projet" required/>
                <input type="number" className="input-field" value={uiState.projTarget} onChange={e=>setUiState(s=>({...s, projTarget:e.target.value}))} placeholder="Montant cible (F)" required/>
                <div style={{display:'flex', gap:8}}>
                   <input type="month" className="input-field" style={{flex:1}} value={uiState.projDeadline} onChange={e=>setUiState(s=>({...s, projDeadline:e.target.value}))} required/>
                   <select className="input-field" style={{flex:1}} value={uiState.projPriority} onChange={e=>setUiState(s=>({...s, projPriority:parseInt(e.target.value) as any}))}>
                      <option value="1">Priorité : Basse</option>
                      <option value="2">Priorité : Moyenne</option>
                      <option value="3">Priorité : Urgente</option>
                   </select>
                </div>
              </div>
              <button className="btn btn-primary" style={{width:'100%'}}>Créer le projet</button>
            </form>
          )}
          {state.projects.map(p => (
            <div key={p.id} className="glass-panel" style={{padding:16, marginBottom:12}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
                <div>
                   <strong style={{fontSize:'1.1rem'}}>{p.name}</strong>
                   <div style={{fontSize:'0.75rem', color:'var(--text-secondary)', display:'flex', alignItems:'center', gap:4, marginTop:2}}>
                     <Calendar size={12}/> Échéance : {p.deadline || 'Non définie'}
                   </div>
                </div>
                <button onClick={()=>setState(s=>({...s, projects:s.projects.filter(x=>x.id!==p.id)}))} style={{padding:4}}><X size={16}/></button>
              </div>
              <div className="category-progress-container" style={{marginTop:12, height:8}}><div className="category-progress-bar" style={{width:`${Math.min(100, (p.savedSoFar/p.targetAmount)*100)}%`, backgroundColor:CATEGORIES.projets.color}}/></div>
              <div style={{display:'flex', justifyContent:'space-between', fontSize:'0.85rem', marginTop:8}}>
                 <span>{fmt(p.savedSoFar)} F / {fmt(p.targetAmount)} F</span>
                 <span style={{fontWeight:600}}>{Math.round((p.savedSoFar/p.targetAmount)*100)}%</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'vault' && (
        <div className="tab-content">
          <header className="header"><h1>Coffre</h1></header>
          <div className="glass-panel balance-card" style={{marginBottom:16}}>
            <span style={{fontSize:'0.9rem'}}>Patrimoine total sécurisé</span>
            <h2>{fmt(state.bankBalance + state.liquidBalance + state.emergencyFund)} F</h2>
          </div>
          <div style={{display:'flex', flexDirection:'column', gap:12}}>
            <div className="glass-panel" style={{padding:16, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <span style={{display:'flex', alignItems:'center', gap:8}}><Shield size={18} color="var(--accent-secondary)"/> Fonds d'Urgence</span>
              <strong style={{fontSize:'1.1rem'}}>{fmt(state.emergencyFund)} F</strong>
            </div>
            <div className="glass-panel" style={{padding:16, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <span style={{display:'flex', alignItems:'center', gap:8}}><Landmark size={18} color="var(--accent-primary)"/> Banque</span>
              <strong style={{fontSize:'1.1rem'}}>{fmt(state.bankBalance)} F</strong>
            </div>
            <div className="glass-panel" style={{padding:16, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <span style={{display:'flex', alignItems:'center', gap:8}}><Banknote size={18} color="var(--success)"/> Argent Liquide</span>
              <strong style={{fontSize:'1.1rem'}}>{fmt(state.liquidBalance)} F</strong>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'score' && (
        <div className="tab-content">
          <header className="header"><h1>Santé Financière</h1></header>
          <div className="glass-panel" style={{padding:40, textAlign:'center'}}>
            <div style={{position:'relative', display:'inline-block'}}>
              <h2 style={{fontSize:'5rem', fontWeight:800, color: scoreColor, lineHeight:1}}>{healthScore}</h2>
              <div style={{fontSize:'1rem', color:'var(--text-secondary)', marginTop:8}}>Sur 100 points</div>
            </div>
            <div style={{marginTop:32, padding:'16px', background:'rgba(255,255,255,0.05)', borderRadius:'16px', fontSize:'0.9rem', textAlign:'left'}}>
              <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8}}>
                <CheckCircle size={16} color={!epargneTriggered ? 'var(--success)' : 'var(--text-secondary)'}/> Bouclier intact (+30)
              </div>
              <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8}}>
                <CheckCircle size={16} color={stabilizedBase - totalSpent > 0 ? 'var(--success)' : 'var(--text-secondary)'}/> Budget équilibré (+20)
              </div>
              <div style={{display:'flex', alignItems:'center', gap:8}}>
                <CheckCircle size={16} color={state.emergencyFund >= (stabilizedBase * 0.4 * 3) ? 'var(--success)' : 'var(--text-secondary)'}/> Fonds d'urgence OK (+10)
              </div>
            </div>
          </div>
        </div>
      )}

      <nav className="bottom-nav">
        <button className={`nav-item ${activeTab==='home'?'active':''}`} onClick={()=>setActiveTab('home')}><Home size={20}/><span>Accueil</span></button>
        <button className={`nav-item ${activeTab==='projects'?'active':''}`} onClick={()=>setActiveTab('projects')}><Target size={20}/><span>Projets</span></button>
        <button className={`nav-item ${activeTab==='vault'?'active':''}`} onClick={()=>setActiveTab('vault')}><Landmark size={20}/><span>Coffre</span></button>
        <button className={`nav-item ${activeTab==='score'?'active':''}`} onClick={()=>setActiveTab('score')}><History size={20}/><span>Score</span></button>
      </nav>
    </div>
  );
}

export default App;
