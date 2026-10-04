import { useMemo, useState, type FormEvent } from 'react';
import {
  Activity,
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  Copy,
  ExternalLink,
  FileSearch,
  Filter,
  Fingerprint,
  History,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  Wallet,
  X,
} from 'lucide-react';

export type EscrowStatus =
  | 'Created'
  | 'Funded'
  | 'Delivered'
  | 'Released'
  | 'Refunded'
  | 'Disputed';

export interface SellerStats {
  completedCount?: number;
  settledCount?: number;
  disputedCount?: number;
  rating?: number;
  totalVolumeEth?: string;
}

export interface Escrow {
  id: string;
  buyer: string;
  seller: string;
  amountEth: string;
  deadlineEpoch: number;
  createdAtEpoch: number;
  status: EscrowStatus;
  description: string;
  transactionHashes: Partial<Record<string, string>>;
  sellerStats?: SellerStats;
}

export interface EscrowTransaction {
  kind: string;
  escrowId: string;
  wallet: string;
  amountEth: string;
  timestampEpoch: number;
  status: string;
  hash: string;
  explorerUrl: string;
}

export interface EscrowWallet {
  installed: boolean;
  address: string;
  networkName: string;
  chainId: number;
  balanceEth: string;
  correctNetwork: boolean;
  connecting: boolean;
}

export interface CreateEscrowFields {
  seller: string;
  deadlineEpoch: number;
  amountEth: string;
  description: string;
}

export interface TrustEscrowAppProps {
  wallet: EscrowWallet | null;
  escrows: Escrow[];
  transactions: EscrowTransaction[];
  isLoading?: boolean;
  pendingAction?: string | null;
  error?: string | null;
  successMessage?: string | null;
  demoMode?: boolean;
  walletConnectionError?: string | null;
  onConnectWallet: () => void;
  onDisconnect: () => void;
  onCreateEscrow: (fields: CreateEscrowFields) => Promise<{ id: string } | void>;
  onDeposit: (escrowId: string) => void;
  onMarkDelivered: (escrowId: string) => void;
  onRelease: (escrowId: string) => void;
  onRefund: (escrowId: string) => void;
  onRaiseDispute: (escrowId: string) => void;
  onResolveDispute: (escrowId: string, paySeller: boolean) => void;
  onSwitchNetwork: () => void;
  onToggleDemoMode: () => void;
  contractReady: boolean;
  dataAvailable: boolean;
  arbitratorAddress: string | null;
  onRetry?: () => void;
}

type Section = 'Overview' | 'Escrows' | 'Transactions' | 'Reputation' | 'How it works' | 'Create escrow' | 'Escrow detail';

const navItems: { label: Section; icon: typeof LayoutDashboard }[] = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Escrows', icon: FileSearch },
  { label: 'Transactions', icon: History },
  { label: 'Reputation', icon: BadgeCheck },
  { label: 'How it works', icon: BookOpen },
];

const shortAddress = (value?: string | null) => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : 'Unavailable';
const asDate = (epoch?: number) => epoch ? new Date(epoch * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unavailable';
const asDateTime = (epoch?: number) => epoch ? new Date(epoch * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Unavailable';

function StatusPill({ status }: { status: EscrowStatus | string }) {
  const key = status.toLowerCase();
  return <span className={`status-pill status-${key}`} data-testid={`status-${key}`}>{status}</span>;
}

function Mono({ children, className = '' }: { children: string; className?: string }) {
  return <span className={`mono ${className}`}>{children}</span>;
}

function EmptyState({ title, detail, action }: { title: string; detail: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><LockKeyhole size={21} strokeWidth={1.7} /></span>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action && <button className="button button-secondary" onClick={action.onClick} data-testid="button-empty-action">{action.label}<ArrowRight size={15} /></button>}
    </div>
  );
}

export function TrustEscrowApp({
  wallet,
  escrows,
  transactions,
  isLoading = false,
  pendingAction = null,
  error = null,
  successMessage = null,
  demoMode = false,
  walletConnectionError = null,
  onConnectWallet,
  onDisconnect,
  onCreateEscrow,
  onDeposit,
  onMarkDelivered,
  onRelease,
  onRefund,
  onRaiseDispute,
  onResolveDispute,
  onSwitchNetwork,
  onToggleDemoMode,
  contractReady,
  dataAvailable,
  arbitratorAddress,
  onRetry,
}: TrustEscrowAppProps) {
  const [section, setSection] = useState<Section>('Overview');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All statuses');
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState<CreateEscrowFields>({ seller: '', amountEth: '', deadlineEpoch: 0, description: '' });
  const [deadlineInput, setDeadlineInput] = useState('');
  const [formError, setFormError] = useState('');
  const selected = escrows.find((item) => item.id === selectedId) ?? null;

  const activeCount = escrows.filter((item) => ['Created', 'Funded', 'Delivered', 'Disputed'].includes(item.status)).length;
  const fundsInEscrow = escrows.filter((item) => ['Funded', 'Delivered', 'Disputed'].includes(item.status))
    .reduce((sum, item) => sum + (Number(item.amountEth) || 0), 0);
  const nearestDeadline = escrows
    .filter((item) => ['Funded', 'Delivered'].includes(item.status) && item.deadlineEpoch * 1000 > Date.now())
    .sort((a, b) => a.deadlineEpoch - b.deadlineEpoch)[0];
  const deadlineHoursRemaining = nearestDeadline
    ? (nearestDeadline.deadlineEpoch * 1000 - Date.now()) / 3_600_000
    : null;
  const filteredEscrows = useMemo(() => escrows.filter((item) => {
    const textMatch = `${item.id} ${item.description} ${item.buyer} ${item.seller}`.toLowerCase().includes(query.toLowerCase());
    const statusMatch = statusFilter === 'All statuses'
      || (statusFilter === 'Active' && ['Created', 'Funded', 'Delivered', 'Disputed'].includes(item.status))
      || (statusFilter === 'Completed' && item.status === 'Released')
      || item.status === statusFilter;
    return textMatch && statusMatch;
  }), [escrows, query, statusFilter]);

  const isConnected = !!wallet?.address;
  const networkReady = !!wallet?.correctNetwork;
  const walletId = wallet?.address.toLowerCase() ?? '';
  const isArbitrator = !!walletId && !!arbitratorAddress && walletId === arbitratorAddress.toLowerCase();
  const isParticipant = (escrow: Escrow) => walletId !== '' && (escrow.buyer.toLowerCase() === walletId || escrow.seller.toLowerCase() === walletId);
  const isBuyer = (escrow: Escrow) => walletId !== '' && escrow.buyer.toLowerCase() === walletId;
  const isSeller = (escrow: Escrow) => walletId !== '' && escrow.seller.toLowerCase() === walletId;
  const deadlinePassed = (escrow: Escrow) => Date.now() > escrow.deadlineEpoch * 1000;
  const busyFor = (action: string, id: string) => pendingAction === action || pendingAction === `${action}:${id}` || pendingAction === id;

  const goToDetail = (id: string) => {
    setSelectedId(id);
    setSection('Escrow detail');
    setMenuOpen(false);
  };
  const navigate = (item: Section) => {
    setSection(item);
    setMenuOpen(false);
    if (item !== 'Escrow detail') setSelectedId(null);
  };
  const disconnectAndReset = () => {
    onDisconnect();
    setQuery('');
    setStatusFilter('All statuses');
    setForm({ seller: '', amountEth: '', deadlineEpoch: 0, description: '' });
    setDeadlineInput('');
    setFormError('');
    navigate('Overview');
  };
  const copyAddress = async () => {
    if (!wallet?.address) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const deadlineEpoch = deadlineInput ? Math.floor(new Date(deadlineInput).getTime() / 1000) : 0;
    if (demoMode) {
      setFormError('Demo records cannot create or send blockchain transactions.');
      return;
    }
    if (!contractReady) {
      setFormError('Live escrow creation is unavailable until a supported testnet contract is configured.');
      return;
    }
    if (!wallet || !wallet.correctNetwork) {
      setFormError('Connect a wallet on the supported testnet before creating an escrow.');
      return;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(form.seller.trim()) || !form.amountEth || Number(form.amountEth) <= 0 || !deadlineEpoch || deadlineEpoch <= Math.floor(Date.now() / 1000) || !form.description.trim()) {
      setFormError('Enter a seller address, a positive amount, a future deadline, and a short description.');
      return;
    }
    setFormError('');
    try {
      const result = await onCreateEscrow({ ...form, seller: form.seller.trim(), deadlineEpoch });
      if (result?.id) {
        setSelectedId(result.id);
        setSection('Escrow detail');
        setForm({ seller: '', amountEth: '', deadlineEpoch: 0, description: '' });
        setDeadlineInput('');
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'The escrow could not be created.');
    }
  };

  const actionReason = (label: string, reason: string) => <span className="action-hint"><CircleHelp size={13} />{label}: {reason}</span>;
  const actionButton = (label: string, action: () => void, enabled: boolean, reason: string, primary = false, pending = false) => (
    <div className="action-wrap" key={label}>
      <button className={`button ${primary ? 'button-primary' : 'button-secondary'} ${!enabled ? 'button-disabled' : ''}`} disabled={!enabled || pending || demoMode || !contractReady} onClick={action} title={demoMode ? 'Demo records cannot send transactions.' : !contractReady ? 'The deployed contract address is not configured.' : !enabled ? reason : undefined} data-testid={`button-${label.toLowerCase().replaceAll(' ', '-')}`}>
        {pending ? <span className="button-dots"><i /><i /><i /></span> : null}{label}
      </button>
      {!enabled && actionReason(label, reason)}
    </div>
  );
  const renderActions = (escrow: Escrow) => {
    const net = isConnected && networkReady;
    const participant = isParticipant(escrow);
    const awaiting = pendingAction !== null;
    const actions = [];
    if (escrow.status === 'Created') {
      actions.push(actionButton('Deposit funds', () => onDeposit(escrow.id), net && isBuyer(escrow) && !deadlinePassed(escrow), !isConnected ? 'Connect your buyer wallet.' : !networkReady ? 'Connect to the correct testnet.' : !isBuyer(escrow) ? 'Only the listed buyer can fund this escrow.' : deadlinePassed(escrow) ? 'The funding deadline has passed; this escrow can no longer be funded.' : 'This escrow cannot be funded.', true, busyFor('deposit', escrow.id)));
    }
    if (escrow.status === 'Funded') {
      actions.push(actionButton('Mark delivered', () => onMarkDelivered(escrow.id), net && isSeller(escrow) && !deadlinePassed(escrow), !isConnected ? 'Connect your seller wallet.' : !networkReady ? 'Connect to the correct testnet.' : !isSeller(escrow) ? 'Only the listed seller can mark delivery.' : deadlinePassed(escrow) ? 'The delivery deadline has passed; the buyer may request a refund.' : 'This action is not available.', true, busyFor('markDelivered', escrow.id)));
      actions.push(actionButton('Refund buyer', () => onRefund(escrow.id), net && isBuyer(escrow) && deadlinePassed(escrow), !isConnected ? 'Connect the buyer wallet.' : !networkReady ? 'Connect to the correct testnet.' : !isBuyer(escrow) ? 'Only the listed buyer can request a refund.' : !deadlinePassed(escrow) ? 'Refund is available after the agreed deadline.' : 'Refund is not available.', false, busyFor('refund', escrow.id)));
    }
    if (escrow.status === 'Delivered') {
      actions.push(actionButton('Release payment', () => onRelease(escrow.id), net && isBuyer(escrow), !isConnected ? 'Connect the buyer wallet.' : !networkReady ? 'Connect to the correct testnet.' : !isBuyer(escrow) ? 'Only the listed buyer can release funds.' : 'Payment cannot be released yet.', true, busyFor('release', escrow.id)));
    }
    if (['Funded', 'Delivered'].includes(escrow.status)) {
      actions.push(actionButton('Raise a dispute', () => onRaiseDispute(escrow.id), net && participant, !isConnected ? 'Connect a buyer or seller wallet.' : !networkReady ? 'Connect to the correct testnet.' : !participant ? 'Only a listed participant can open a dispute.' : 'Disputes are not available in this state.', false, busyFor('raiseDispute', escrow.id)));
    }
    if (escrow.status === 'Disputed') {
      actions.push(actionButton('Release to seller', () => onResolveDispute(escrow.id, true), net && isArbitrator, !isConnected ? 'Connect the designated arbitrator wallet.' : !networkReady ? 'Connect to the correct testnet.' : !isArbitrator ? 'Only the designated arbitrator can resolve this dispute.' : 'Resolution is not available.', true, busyFor('resolveDispute', escrow.id)));
      actions.push(actionButton('Refund buyer', () => onResolveDispute(escrow.id, false), net && isArbitrator, !isConnected ? 'Connect the designated arbitrator wallet.' : !networkReady ? 'Connect to the correct testnet.' : !isArbitrator ? 'Only the designated arbitrator can resolve this dispute.' : 'Resolution is not available.', false, busyFor('resolveDispute', escrow.id)));
      if (!isArbitrator) actions.push(<p className="quiet-note" key="arbitrator-note"><ShieldAlert size={15} /> Normal release and refund are blocked while this dispute awaits its designated arbitrator.</p>);
    }
    return <div className="action-list">{actions.length ? actions : <p className="quiet-note"><CheckCircle2 size={15} /> No participant action is available for this escrow state.</p>}{awaiting && <p className="pending-note"><span className="pulse-dot" /> Waiting for wallet confirmation or chain response…</p>}</div>;
  };

  const title = section === 'Escrow detail' ? 'Escrow details' : section;
  return (
    <div className="trust-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><ShieldCheck size={20} strokeWidth={2.1} /></div>
          <div><strong>TrustEscrow</strong><span>SETTLEMENT WORKSPACE</span></div>
        </div>
        <div className="side-network"><span className="network-dot" /><span>{wallet?.networkName || 'Wallet not connected'}</span><span className="network-chevron"><ChevronDown size={13} /></span></div>
        <div className="side-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map(({ label, icon: Icon }) => (
            <button key={label} className={`nav-item ${section === label || (section === 'Escrow detail' && label === 'Escrows') ? 'nav-active' : ''}`} onClick={() => navigate(label)} data-testid={`nav-${label.toLowerCase().replaceAll(' ', '-')}`}>
              <Icon size={17} strokeWidth={1.8} /><span>{label}</span>{label === 'Escrows' && activeCount > 0 && <span className="nav-count">{activeCount}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-lower">
          <div className="security-note"><div className="security-emblem"><Fingerprint size={19} /></div><div><strong>On-chain by design</strong><p>Funds remain governed by the escrow contract—not us.</p></div></div>
          <div className="side-footer"><span>TESTNET ENVIRONMENT</span><span className="build-mark"><span /> READY</span></div>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMenuOpen((open) => !open)} aria-label="Toggle navigation" data-testid="button-toggle-navigation">{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>{title}</strong></div>
          <div className="topbar-right">
            <div className={`network-indicator ${wallet?.correctNetwork ? 'network-good' : ''}`}><span className="network-dot" />{wallet?.networkName || 'Network unavailable'}</div>
            {isConnected ? (
              <div className="wallet-control">
                <button className="wallet-chip" onClick={copyAddress} title="Copy connected wallet address" data-testid="button-copy-wallet"><span className="wallet-identicon"><Wallet size={14} /></span><Mono>{shortAddress(wallet.address)}</Mono><span className="copy-label">{copied ? 'Copied' : <Copy size={12} />}</span></button>
                 <button className="icon-button" onClick={disconnectAndReset} title="Reset the wallet display in this app" aria-label="Reset wallet view" data-testid="button-disconnect"><LogOut size={16} /></button>
              </div>
              ) : <div className="connect-actions">{!wallet?.installed && <><span className="metamask-required">MetaMask is required to interact with the blockchain.</span><a href="https://metamask.io/download/" target="_blank" rel="noreferrer" className="metamask-link header-metamask-link" data-testid="link-install-metamask">Get MetaMask <ExternalLink size={12} /></a></>}<button type="button" className="button button-primary connect-button" disabled={wallet?.connecting} aria-busy={wallet?.connecting || undefined} onClick={onConnectWallet} data-testid="button-connect-wallet"><Wallet size={15} />{wallet?.connecting ? 'Connecting…' : 'Connect wallet'}</button></div>}
            <button className={`button button-secondary demo-toggle ${demoMode ? 'demo-toggle-on' : ''}`} onClick={onToggleDemoMode} data-testid="button-toggle-demo">{demoMode ? 'Exit demo' : 'Demo data'}</button>
          </div>
        </header>

        <main className="workspace">
          {demoMode && <div className="demo-ribbon"><ShieldAlert size={15} /><strong>DEMO DATA — NOT REAL TRANSACTIONS</strong><span>Illustrative records only. Nothing shown here represents a live chain event.</span></div>}
          {!contractReady && !demoMode && <div className="error-banner" role="status"><ShieldAlert size={17} /><div><strong>Live contract not configured.</strong><span>Deploy Escrow.sol to Sepolia, then set VITE_CONTRACT_ADDRESS and restart the app. Live balances, records, and actions are unavailable until then.</span></div></div>}
          {wallet?.address && !wallet.correctNetwork && <div className="error-banner network-warning" role="alert"><ShieldAlert size={17} /><div><strong>Wrong network. Please switch to the supported testnet.</strong><span>Transactions are disabled until MetaMask is connected to {wallet.networkName === 'Not connected' ? 'the supported testnet' : wallet.networkName}.</span></div><button onClick={onSwitchNetwork} className="button button-secondary error-retry" data-testid="button-switch-network">Switch network</button></div>}
          {walletConnectionError && <div className="error-banner" role="alert"><ShieldAlert size={17} /><div><strong>Wallet connection failed.</strong><span>{walletConnectionError}</span></div></div>}
          {error && <div className="error-banner" role="alert"><ShieldAlert size={17} /><div><strong>We couldn’t refresh this workspace.</strong><span>{error}</span></div>{onRetry && <button onClick={onRetry} className="button button-secondary error-retry"><RefreshCw size={14} />Retry</button>}</div>}
          {successMessage && !demoMode && <div className="success-banner" role="status"><CheckCircle2 size={16} /><span>{successMessage}</span></div>}
          {isLoading ? (
            <div className="loading-view"><div className="loading-heading"><div className="skeleton skeleton-title" /><div className="skeleton skeleton-action" /></div><div className="skeleton-grid">{[1, 2, 3].map((item) => <div className="skeleton skeleton-card" key={item} />)}</div><div className="skeleton skeleton-table" /><p>Reading escrow records from the connected chain…</p></div>
          ) : (
            <>
              {section === 'Overview' && (
                <section className="page-enter">
                  <div className="page-heading">
                    <div><div className="eyebrow"><span className="eyebrow-line" />SETTLEMENT OVERVIEW</div><h1>Money moves. <em>Trust holds.</em></h1><p className="page-subtitle">A clear view of your agreements, funds, and next steps.</p></div>
                    <button className="button button-primary new-escrow" onClick={() => navigate('Create escrow')} data-testid="button-create-escrow"><Plus size={16} />New escrow</button>
                  </div>
                  <section className="overview-banner">
                    <div className="banner-copy"><div className="banner-kicker"><span className="banner-dot" />THE SETTLEMENT PRINCIPLE</div><h2>Funds stay locked<br />until the terms are met.</h2><p>Both sides can see what happens next. Every change is recorded on-chain.</p><button onClick={() => navigate('How it works')} className="banner-link">See how TrustEscrow works <ArrowRight size={15} /></button></div>
                    <div className="settlement-graphic" aria-hidden="true">
                      <div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" />
                      <div className="graphic-node node-buyer"><UserRound size={16} /><span>BUYER</span></div><div className="graphic-node node-seller"><UserRound size={16} /><span>SELLER</span></div>
                      <div className="graphic-vault"><LockKeyhole size={23} /><span>ESCROW</span></div><div className="flow-path path-left" /><div className="flow-path path-right" />
                      <div className="chain-caption"><span className="chain-caption-dot" />VERIFIABLE ON-CHAIN</div>
                    </div>
                  </section>
                  <div className="metric-grid">
                    <div className="metric-card"><div className="metric-label">TOTAL ESCROWS <span className="metric-symbol"><FileSearch size={15} /></span></div><div className="metric-value">{dataAvailable ? escrows.length : '—'}</div><div className="metric-foot">{dataAvailable ? 'Records on the configured contract' : 'Unavailable until chain data loads'}</div></div>
                    <div className="metric-card"><div className="metric-label">ACTIVE <span className="metric-symbol"><Activity size={15} /></span></div><div className="metric-value">{dataAvailable ? activeCount : '—'}</div><div className="metric-foot">Created, funded, delivered, or disputed</div></div>
                    <div className="metric-card"><div className="metric-label">COMPLETED <span className="metric-symbol"><CheckCircle2 size={15} /></span></div><div className="metric-value">{dataAvailable ? escrows.filter((item) => item.status === 'Released').length : '—'}</div><div className="metric-foot">Released to the seller</div></div>
                    <div className="metric-card"><div className="metric-label">DISPUTED <span className="metric-symbol"><ShieldAlert size={15} /></span></div><div className="metric-value">{dataAvailable ? escrows.filter((item) => item.status === 'Disputed').length : '—'}</div><div className="metric-foot">Awaiting arbitrator resolution</div></div>
                    <div className="metric-card"><div className="metric-label">WALLET BALANCE <span className="metric-symbol"><Wallet size={15} /></span></div><div className="metric-value">{demoMode ? '—' : wallet?.balanceEth || '—'} <small>ETH</small></div><div className="metric-foot">{demoMode ? 'Hidden while viewing sample records' : wallet?.correctNetwork ? `${wallet.networkName} · Chain ${wallet.chainId}` : 'Unavailable · verify network connection'}</div></div>
                    <div className="metric-card metric-funds"><div className="metric-label">FUNDS IN ESCROW <span className="metric-symbol"><LockKeyhole size={15} /></span></div><div className="metric-value">{dataAvailable ? fundsInEscrow.toLocaleString(undefined, { maximumFractionDigits: 5 }) : '—'} <small>ETH</small></div><div className="metric-foot">{dataAvailable ? 'Funded, delivered, and disputed rows' : 'Unavailable until chain data loads'}</div></div>
                  </div>
                  <div className="safety-strip">
                    <section className="panel safety-panel">
                      <div className="panel-heading"><div><span className="eyebrow">CONTRACT SAFEGUARDS</span><h2>Escrow safety insights</h2></div><ShieldCheck size={19} /></div>
                      <ul>
                        <li><CheckCircle2 size={14} /> Deposited funds remain in the smart contract until settlement.</li>
                        <li><CheckCircle2 size={14} /> The seller cannot release funds to themselves.</li>
                        <li><CheckCircle2 size={14} /> The buyer can refund only after the deadline and before delivery.</li>
                        <li><CheckCircle2 size={14} /> Disputes block normal release and refund until arbitrator resolution.</li>
                        <li><CheckCircle2 size={14} /> Major state changes emit on-chain events.</li>
                      </ul>
                      <p>These are contract rules, not a guarantee of safe outcomes. The arbitrator is a trusted MVP role.</p>
                    </section>
                    <section className="panel deadline-panel">
                      <span className="eyebrow">DEADLINE RISK</span>
                      {deadlineHoursRemaining === null ? <><h2>{dataAvailable ? 'No active deadline' : 'Unavailable'}</h2><p>{dataAvailable ? 'No funded or delivered escrow has a future deadline.' : 'Load on-chain records to assess upcoming deadlines.'}</p></> : <>
                        <h2>{deadlineHoursRemaining < 24 ? `${Math.max(1, Math.floor(deadlineHoursRemaining))}h remaining` : `${Math.ceil(deadlineHoursRemaining / 24)} days remaining`}</h2>
                        <span className={`risk-level ${deadlineHoursRemaining < 24 ? 'risk-high' : deadlineHoursRemaining < 72 ? 'risk-medium' : 'risk-low'}`}>{deadlineHoursRemaining < 24 ? 'HIGH RISK' : deadlineHoursRemaining < 72 ? 'WATCH' : 'LOW RISK'}</span>
                        <p>Nearest open deadline · Escrow #{nearestDeadline?.id}</p>
                      </>}
                    </section>
                  </div>
                  <div className="dashboard-columns">
                    <section className="panel recent-panel">
                      <div className="panel-heading"><div><span className="eyebrow">IN MOTION</span><h2>Recent escrows</h2></div><button className="text-link" onClick={() => navigate('Escrows')} data-testid="link-all-escrows">All escrows <ArrowRight size={14} /></button></div>
                      {escrows.length === 0 ? <EmptyState title="No escrow records yet" detail="When the connected workspace provides on-chain agreements, they’ll appear here." action={{ label: 'Create an escrow', onClick: () => navigate('Create escrow') }} /> : (
                        <div className="escrow-list">
                          {escrows.slice(0, 4).map((item) => <button key={item.id} className="escrow-row" onClick={() => goToDetail(item.id)} data-testid={`row-escrow-${item.id}`}>
                            <span className="escrow-row-icon"><LockKeyhole size={15} /></span><span className="escrow-main"><span className="escrow-title">{item.description || 'Escrow agreement'}</span><span className="escrow-meta"><Mono>{shortAddress(item.id)}</Mono><span>·</span>Seller {shortAddress(item.seller)}</span></span>
                            <span className="escrow-amount"><strong>{item.amountEth} ETH</strong><span>{asDate(item.createdAtEpoch)}</span></span><StatusPill status={item.status} /><ArrowRight className="row-arrow" size={15} />
                          </button>)}
                        </div>
                      )}
                    </section>
                    <aside className="panel next-panel">
                      <div className="panel-heading"><div><span className="eyebrow">YOUR SIDE OF THE DEAL</span><h2>Next steps</h2></div><span className="step-count">{escrows.filter((item) => isParticipant(item) && ['Created', 'Funded', 'Delivered', 'Disputed'].includes(item.status)).length.toString().padStart(2, '0')}</span></div>
                       {!isConnected ? <div className="next-empty"><span className="next-icon"><Wallet size={17} /></span><strong>Connect to see your actions</strong><p>Your wallet determines which escrow actions you’re eligible to take.</p>{wallet?.installed ? <button className="inline-button" onClick={onConnectWallet} data-testid="button-connect-for-actions">Connect wallet <ArrowRight size={14} /></button> : <span className="quiet-note">MetaMask is required to interact with the blockchain. <a href="https://metamask.io/download/" target="_blank" rel="noreferrer" className="metamask-link inline-metamask-link">Get MetaMask <ExternalLink size={12} /></a></span>}</div>
                        : escrows.filter((item) => isParticipant(item) && ['Created', 'Funded', 'Delivered', 'Disputed'].includes(item.status)).length === 0 ? <div className="next-empty"><span className="next-icon"><Check size={17} /></span><strong>Nothing needs your attention</strong><p>Eligible actions will show here when an escrow needs you.</p></div> :
                          <div className="next-list">{escrows.filter((item) => isParticipant(item) && ['Created', 'Funded', 'Delivered', 'Disputed'].includes(item.status)).slice(0, 3).map((item) => <button className="next-row" onClick={() => goToDetail(item.id)} key={item.id}><span className={`next-state state-${item.status.toLowerCase()}`}><Activity size={14} /></span><span><strong>{item.status === 'Created' && isBuyer(item) ? 'Fund this agreement' : item.status === 'Funded' && isSeller(item) ? 'Confirm delivery' : item.status === 'Delivered' && isBuyer(item) ? 'Review and release' : item.status === 'Disputed' ? 'Dispute in progress' : 'Agreement in progress'}</strong><small>{item.description || `Escrow ${shortAddress(item.id)}`}</small></span><ArrowRight size={14} /></button>)}</div>}
                    </aside>
                  </div>
                  <div className="trust-footnote"><ShieldCheck size={16} /><span><strong>Trustless transactions. Secure payments. No middleman.</strong> Your funds are controlled by the escrow contract and its published rules.</span><button onClick={() => navigate('How it works')}>Transparency <ArrowRight size={13} /></button></div>
                </section>
              )}

              {section === 'Escrows' && (
                <section className="page-enter">
                  <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />ON-CHAIN AGREEMENTS</div><h1>Escrows</h1><p className="page-subtitle">Search agreements, see who can act, and follow settlement status.</p></div><button className="button button-primary" onClick={() => navigate('Create escrow')} data-testid="button-new-escrow"><Plus size={16} />New escrow</button></div>
                   <div className="toolbar"><label className="search-field"><Search size={16} /><input type="search" placeholder="Search ID, participant, description…" value={query} onChange={(event) => setQuery(event.target.value)} data-testid="input-search-escrows" /><kbd>/</kbd></label><label className="filter-field"><Filter size={15} /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter escrow status" data-testid="select-escrow-status"><option>All statuses</option>{['Active', 'Created', 'Funded', 'Delivered', 'Completed', 'Released', 'Refunded', 'Disputed'].map((status) => <option key={status}>{status}</option>)}</select><ChevronDown size={14} /></label><span className="results-count">{filteredEscrows.length} RECORD{filteredEscrows.length === 1 ? '' : 'S'}</span></div>
                  <div className="panel table-panel">{escrows.length === 0 ? <EmptyState title="No escrow records to show" detail="This view only displays records supplied by the connected chain workspace." action={{ label: 'Create an escrow', onClick: () => navigate('Create escrow') }} /> : filteredEscrows.length === 0 ? <EmptyState title="No matching agreements" detail="Try a different search term or clear the status filter." action={{ label: 'Clear filters', onClick: () => { setQuery(''); setStatusFilter('All statuses'); } }} /> : <div className="table-scroll"><table><thead><tr><th>AGREEMENT</th><th>PARTIES</th><th>AMOUNT</th><th>DEADLINE</th><th>STATUS</th><th /></tr></thead><tbody>{filteredEscrows.map((item) => <tr key={item.id} onClick={() => goToDetail(item.id)} data-testid={`row-escrow-list-${item.id}`}><td><span className="table-title">{item.description || 'Escrow agreement'}</span><Mono>{shortAddress(item.id)}</Mono></td><td><span>Buyer {shortAddress(item.buyer)}</span><span>Seller {shortAddress(item.seller)}</span></td><td><strong>{item.amountEth} ETH</strong></td><td>{asDate(item.deadlineEpoch)}</td><td><StatusPill status={item.status} /></td><td><ArrowRight size={15} /></td></tr>)}</tbody></table></div>}</div>
                  <p className="privacy-note"><Shield size={15} /> Addresses are shortened for readability. Open a record to inspect its full party addresses and transaction references.</p>
                </section>
              )}

              {section === 'Create escrow' && (
                <section className="page-enter">
                  <div className="back-line"><button className="back-button" onClick={() => navigate('Escrows')}><ArrowLeft size={15} />Back to escrows</button></div>
                  <div className="page-heading compact-heading"><div><div className="eyebrow"><span className="eyebrow-line" />START AN AGREEMENT</div><h1>Create an escrow</h1><p className="page-subtitle">Set the terms before any funds move. Review each detail with the other party.</p></div></div>
                  <div className="create-layout">
                    <form className="panel create-form" onSubmit={submitCreate}>
                      <div className="form-section-title"><span className="form-step">01</span><div><h2>Agreement terms</h2><p>These details define what both parties agree to.</p></div></div>
                      <label className="form-label">Seller wallet address <span>REQUIRED</span><div className="form-input-wrap"><UserRound size={16} /><input value={form.seller} onChange={(event) => setForm({ ...form, seller: event.target.value })} placeholder="0x…" autoComplete="off" data-testid="input-seller-address" /></div><small>Confirm the address directly with the seller before creating.</small></label>
                      <div className="form-two"><label className="form-label">Amount in ETH <span>REQUIRED</span><div className="form-input-wrap"><span className="currency-sign">Ξ</span><input type="number" min="0" step="any" value={form.amountEth} onChange={(event) => setForm({ ...form, amountEth: event.target.value })} placeholder="0.00" data-testid="input-amount-eth" /><span className="input-unit">ETH</span></div></label><label className="form-label">Delivery deadline <span>REQUIRED</span><div className="form-input-wrap"><Clock3 size={16} /><input type="datetime-local" value={deadlineInput} onChange={(event) => setDeadlineInput(event.target.value)} data-testid="input-deadline" /></div></label></div>
                       <label className="form-label">What is being exchanged? <span>REQUIRED</span><textarea rows={4} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Describe the goods, service, or deliverable in specific terms." data-testid="input-description" /><small>Stored in this browser only; not written to the contract. Do not include sensitive information.</small></label>
                      {!isConnected && <div className="inline-alert"><Wallet size={16} /><span>Connect a wallet to submit an on-chain agreement. Your wallet address will be the buyer.</span>{wallet?.installed && <button type="button" onClick={onConnectWallet} data-testid="button-connect-create">Connect</button>}</div>}
                      {isConnected && !networkReady && <div className="inline-alert alert-warning"><ShieldAlert size={16} /><span>Wallet detected on {wallet?.networkName || 'an unknown network'}. Connect to the supported testnet before continuing.</span></div>}
                       {formError && <div className="form-error" role="alert">{formError}</div>}
                     <div className="form-submit-row"><p><LockKeyhole size={14} />Creating an escrow does not deposit funds.</p><button className="button button-primary" type="submit" disabled={!isConnected || !networkReady || !contractReady || demoMode || !!pendingAction} title={demoMode ? 'Exit demo mode before creating a real escrow.' : !contractReady ? 'The deployed contract address is not configured.' : !isConnected ? 'Connect a wallet first.' : !networkReady ? 'Connect to the supported testnet first.' : undefined} data-testid="button-submit-escrow">{pendingAction === 'create' ? 'Waiting for wallet…' : 'Review & create'}<ArrowRight size={15} /></button></div>
                    </form>
                    <aside className="create-aside">
                      <div className="panel review-card"><div className="review-top"><ShieldCheck size={18} /><span>BEFORE YOU SIGN</span></div><h3>Know the rules first.</h3><ul><li><CheckCircle2 size={15} />Funds lock only after the buyer deposits.</li><li><CheckCircle2 size={15} />The seller confirms delivery on-chain.</li><li><CheckCircle2 size={15} />The buyer releases payment after review.</li><li><CheckCircle2 size={15} />Disputes follow contract-defined rules.</li></ul><button className="text-link" onClick={() => navigate('How it works')}>Read how settlement works <ArrowRight size={14} /></button></div>
                      <div className="aside-note"><Fingerprint size={17} /><p><strong>No middleman.</strong> TrustEscrow’s interface does not custody funds. Contract rules and your connected wallet govern each action.</p></div>
                    </aside>
                  </div>
                </section>
              )}

              {section === 'Escrow detail' && (
                <section className="page-enter">
                  <div className="back-line"><button className="back-button" onClick={() => navigate('Escrows')}><ArrowLeft size={15} />All escrows</button></div>
                  {!selected ? <div className="panel"><EmptyState title="Escrow record unavailable" detail="The selected record is not present in the current on-chain data provided to this workspace." action={{ label: 'Return to escrows', onClick: () => navigate('Escrows') }} /></div> : <>
                    <div className="detail-heading"><div><div className="eyebrow"><span className="eyebrow-line" />ESCROW RECORD <Mono>{shortAddress(selected.id)}</Mono></div><h1>{selected.description || 'Escrow agreement'}</h1><p className="page-subtitle">Created {asDate(selected.createdAtEpoch)} · Deadline {asDate(selected.deadlineEpoch)}</p></div><StatusPill status={selected.status} /></div>
                    <div className="detail-grid">
                      <div className="detail-main">
                        <div className="panel amount-panel"><div><span className="eyebrow">AGREED AMOUNT</span><div className="detail-amount">{selected.amountEth}<small> ETH</small></div></div><div className="lock-stamp"><LockKeyhole size={18} /><span>{['Funded', 'Delivered', 'Disputed'].includes(selected.status) ? 'LOCKED IN ESCROW' : selected.status.toUpperCase()}</span></div><div className="amount-parties"><div><span>BUYER</span><Mono>{selected.buyer}</Mono>{isBuyer(selected) && <b>YOU</b>}</div><ArrowRight size={15} /><div><span>SELLER</span><Mono>{selected.seller}</Mono>{isSeller(selected) && <b>YOU</b>}</div></div></div>
                        <div className="panel timeline-panel"><div className="panel-heading"><div><span className="eyebrow">AUDIT TRAIL</span><h2>Escrow timeline</h2></div><span className="onchain-badge"><span />ON-CHAIN DATA</span></div>
                          <div className="timeline">
                             {[{ key: 'created', label: 'Agreement created', time: selected.createdAtEpoch, hash: selected.transactionHashes.create ?? selected.transactionHashes.created, detail: 'Buyer, seller, amount, and deadline recorded by the contract.' }, { key: 'funded', label: 'Funds deposited', time: undefined, hash: selected.transactionHashes.deposit ?? selected.transactionHashes.funded, detail: 'Buyer funds held by the contract.' }, { key: 'delivered', label: 'Delivery confirmed', time: undefined, hash: selected.transactionHashes.markDelivered ?? selected.transactionHashes.delivered, detail: 'Seller marked the agreed work as delivered.' }, { key: 'settled', label: selected.status === 'Refunded' ? 'Funds refunded' : selected.status === 'Disputed' ? 'Dispute raised' : 'Payment released', time: undefined, hash: selected.transactionHashes.release ?? selected.transactionHashes.released ?? selected.transactionHashes.refund ?? selected.transactionHashes.refunded ?? selected.transactionHashes.resolveDispute ?? selected.transactionHashes.raiseDispute ?? selected.transactionHashes.disputed, detail: 'Final settlement action recorded by the contract.' }].map((entry, index) => {
                               const visible = index === 0 || (index === 1 && ['Funded', 'Delivered', 'Released', 'Refunded', 'Disputed'].includes(selected.status)) || (index === 2 && ['Delivered', 'Released', 'Disputed'].includes(selected.status)) || (index === 3 && ['Released', 'Refunded', 'Disputed'].includes(selected.status));
                              const done = visible;
                              return <div className={`timeline-item ${done ? 'timeline-done' : 'timeline-future'}`} key={entry.key}><div className="timeline-marker">{done ? <Check size={12} /> : <span />}</div><div className="timeline-content"><div className="timeline-title"><strong>{entry.label}</strong>{visible && <span>{entry.time ? asDateTime(entry.time) : 'Timestamp unavailable'}</span>}</div><p>{visible ? entry.detail : 'Not recorded yet.'}</p>{visible && <div className="timeline-hash">{entry.hash ? <><Mono>{shortAddress(entry.hash)}</Mono><span>Transaction hash supplied</span></> : <span className="hash-unavailable">Transaction reference unavailable</span>}</div>}</div></div>;
                            })}
                          </div>
                        </div>
                        <div className="panel terms-panel"><span className="eyebrow">AGREED DESCRIPTION</span><p>{selected.description || 'No description supplied.'}</p><div className="term-details"><span><Clock3 size={14} />Deadline</span><strong>{asDateTime(selected.deadlineEpoch)}</strong></div></div>
                      </div>
                      <aside className="detail-aside"><div className="panel action-panel"><div className="panel-heading"><div><span className="eyebrow">PARTICIPANT CONTROLS</span><h2>Available actions</h2></div><span className="action-shield"><ShieldCheck size={17} /></span></div>{renderActions(selected)}</div>
                        <div className="panel participants-panel"><span className="eyebrow">PARTICIPANTS</span><div className="participant"><span className="participant-avatar"><UserRound size={16} /></span><div><small>BUYER</small><Mono>{shortAddress(selected.buyer)}</Mono></div>{isBuyer(selected) && <span className="you-tag">YOU</span>}</div><div className="participant"><span className="participant-avatar seller-avatar"><UserRound size={16} /></span><div><small>SELLER</small><Mono>{shortAddress(selected.seller)}</Mono></div>{isSeller(selected) && <span className="you-tag">YOU</span>}</div><div className="participant-deadline"><Clock3 size={14} />Deadline {asDate(selected.deadlineEpoch)}</div></div>
                        <div className="transparency-callout"><Shield size={18} /><div><strong>Every action has a chain record.</strong><p>TrustEscrow cannot change escrow terms or move funds outside the contract rules.</p></div></div>
                      </aside>
                    </div>
                  </>}
                </section>
              )}

              {section === 'Transactions' && (
                <section className="page-enter">
                  <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />CHAIN ACTIVITY</div><h1>Transactions</h1><p className="page-subtitle">Wallet activity passed in by the on-chain workspace. Hashes link to their explorer record.</p></div><span className="activity-count"><Activity size={15} />{transactions.length} RECORD{transactions.length === 1 ? '' : 'S'}</span></div>
                  <div className="panel table-panel transaction-table">{transactions.length === 0 ? <EmptyState title="No transaction records available" detail="Transactions appear here only when the parent workspace supplies chain activity." /> : <div className="table-scroll"><table><thead><tr><th>ACTION</th><th>ESCROW</th><th>WALLET</th><th>AMOUNT</th><th>TIME</th><th>STATUS</th><th>HASH</th></tr></thead><tbody>{transactions.map((tx, index) => <tr key={`${tx.hash}-${index}`} data-testid={`row-transaction-${index}`}><td><span className="transaction-kind"><span className={`tx-icon tx-${tx.kind.toLowerCase()}`}>{tx.kind.toLowerCase().includes('deposit') ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}</span><strong>{tx.kind}</strong></span></td><td><button className="mono table-link" onClick={() => goToDetail(tx.escrowId)}>{shortAddress(tx.escrowId)}</button></td><td><Mono>{shortAddress(tx.wallet)}</Mono></td><td>{tx.amountEth ? `${tx.amountEth} ETH` : 'Unavailable'}</td><td>{asDateTime(tx.timestampEpoch)}</td><td><span className={`transaction-status tx-status-${tx.status.toLowerCase()}`}><span />{tx.status}</span></td><td>{tx.explorerUrl ? <a className="explorer-link" href={tx.explorerUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}><Mono>{shortAddress(tx.hash)}</Mono><ExternalLink size={13} /></a> : <span className="hash-unavailable">{tx.hash ? shortAddress(tx.hash) : 'Unavailable'}</span>}</td></tr>)}</tbody></table></div>}</div>
                  <div className="transaction-foot"><ShieldCheck size={16} /><span>Displayed activity is read-only. Transaction status and explorer links are provided by the connected chain layer.</span></div>
                </section>
              )}

              {section === 'Reputation' && (
                <section className="page-enter">
                  <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />PUBLIC COUNTERPARTY SIGNALS</div><h1>Seller reputation</h1><p className="page-subtitle">A view of observed escrow outcomes—not a guarantee or endorsement.</p></div><span className="reputation-mark"><BadgeCheck size={17} />CHAIN-DERIVED</span></div>
                  <div className="reputation-intro"><div className="rep-icon"><Fingerprint size={21} /></div><div><strong>Reputation is evidence, not assurance.</strong><p>Only activity and seller statistics included in the supplied escrow data are shown. No external identity checks or off-chain reviews are implied.</p></div></div>
                   {escrows.length === 0 ? <div className="panel"><EmptyState title="No reputation data available" detail="Seller history will appear when escrow records or seller statistics are provided." /></div> : <div className="panel reputation-table"><div className="table-scroll"><table><thead><tr><th>SELLER</th><th>OBSERVED RECORDS</th><th>COMPLETED</th><th>SETTLED</th><th>COMPLETION RATE</th><th>DISPUTED</th><th>RATING</th><th>VOLUME</th></tr></thead><tbody>{Array.from(new Set(escrows.map((item) => item.seller))).map((seller) => {
                    const records = escrows.filter((item) => item.seller.toLowerCase() === seller.toLowerCase());
                    const stats = records.find((item) => item.sellerStats)?.sellerStats;
                    const completed = stats?.completedCount ?? records.filter((item) => ['Released', 'Resolved'].includes(item.status)).length;
                     const settled = stats?.settledCount;
                     const completionRate = settled && settled > 0 ? `${((completed / settled) * 100).toFixed(1)}%` : null;
                    const disputes = stats?.disputedCount ?? records.filter((item) => item.status === 'Disputed').length;
                     return <tr key={seller} data-testid={`row-reputation-${seller}`}><td><span className="seller-cell"><span className="seller-avatar"><UserRound size={15} /></span><Mono>{shortAddress(seller)}</Mono></span></td><td>{records.length}</td><td>{stats?.completedCount !== undefined ? completed : `${completed} observed`}</td><td>{settled !== undefined ? settled : <span className="unavailable">Unavailable</span>}</td><td>{completionRate ?? <span className="unavailable">{settled === 0 ? 'No settlements' : 'Unavailable'}</span>}</td><td>{stats?.disputedCount !== undefined ? disputes : `${disputes} observed`}</td><td>{stats?.rating !== undefined ? `${stats.rating.toFixed(1)} / 5` : <span className="unavailable">Unavailable</span>}</td><td>{stats?.totalVolumeEth !== undefined ? `${stats.totalVolumeEth} ETH` : <span className="unavailable">Unavailable</span>}</td></tr>;
                  })}</tbody></table></div><div className="rep-legend"><span><span className="legend-dot legend-derived" />Derived from provided escrow statuses</span><span><span className="legend-dot legend-provided" />Explicit seller stats from chain layer</span></div></div>}
                   <div className="reputation-caveat"><CircleHelp size={16} /><p><strong>Read the context.</strong> Completion rate is successful settlements divided by all settled escrows from this deployment. A low record count is not a reliable predictor; ratings and volume remain unavailable unless explicitly supplied.</p></div>
                </section>
              )}

              {section === 'How it works' && (
                <section className="page-enter">
                  <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />OPEN RULES. VISIBLE OUTCOMES.</div><h1>How it works</h1><p className="page-subtitle">Trustless transactions. Secure payments. No middleman.</p></div><span className="reputation-mark"><ShieldCheck size={17} />TRANSPARENCY</span></div>
                  <div className="how-hero"><div className="how-hero-copy"><span className="banner-kicker"><span className="banner-dot" />THE ESCROW PROMISE</span><h2>Clarity before<br />the first transfer.</h2><p>The contract holds the agreed funds and exposes the steps each side can take. TrustEscrow is the workspace; your connected wallet authorizes the action.</p></div><div className="how-equation"><div><span>BUYER</span><UserRound size={20} /></div><span className="equation-line" /><div className="equation-lock"><LockKeyhole size={21} /><span>CONTRACT</span></div><span className="equation-line" /><div><span>SELLER</span><UserRound size={20} /></div></div></div>
                  <div className="steps-list">
                      {[{ n: '01', title: 'Agree on terms', body: 'The buyer creates an escrow with seller address, amount, deadline, and a description. The contract records the parties, amount, and deadline. The description stays in the creator’s browser.', icon: FileSearch, role: 'BUYER SETS THE TERMS' }, { n: '02', title: 'Lock the funds', body: 'The buyer deposits the agreed amount from their connected wallet. Until a deposit is confirmed on-chain, no funds are held by the escrow.', icon: LockKeyhole, role: 'BUYER FUNDS THE ESCROW' }, { n: '03', title: 'Confirm delivery', body: 'The seller marks the deliverable as sent or complete. The buyer can then review the work against the original agreement.', icon: CheckCircle2, role: 'SELLER CONFIRMS' }, { n: '04', title: 'Settle or escalate', body: 'The buyer releases funds when satisfied. If there is a problem, eligible participants can raise a dispute. Normal settlement is blocked until the designated trusted arbitrator chooses a payout. This is a centralized MVP role, not decentralized arbitration.', icon: ShieldAlert, role: 'PARTICIPANTS + ARBITRATOR' }].map(({ n, title: stepTitle, body, icon: Icon, role }) => <article className="how-step" key={n}><span className="step-number">{n}</span><span className="step-icon"><Icon size={19} /></span><div className="step-content"><span>{role}</span><h3>{stepTitle}</h3><p>{body}</p></div><ArrowRight className="step-arrow" size={16} /></article>)}
                  </div>
                   <div className="transparency-grid"><div className="transparency-box"><div className="transparency-icon"><Fingerprint size={19} /></div><h3>What the chain proves</h3><p>Transactions and contract state changes are visible to the connected chain layer. A hash or explorer link is shown only when provided.</p></div><div className="transparency-box"><div className="transparency-icon"><UserRound size={19} /></div><h3>Arbitration is centralized</h3><p>The deployed contract names one trusted arbitrator who controls disputed payouts. This is a centralized MVP component, not decentralized arbitration. The app cannot verify identities or guarantee deliverables.</p></div><div className="transparency-box"><div className="transparency-icon"><CircleHelp size={19} /></div><h3>What to check before signing</h3><p>Verify both addresses, amount, deadline, and the escrow contract rules using trusted sources before authorizing a transaction.</p></div></div>
                  <div className="trust-footnote"><ShieldCheck size={16} /><span><strong>Trustless transactions. Secure payments. No middleman.</strong> Read the contract and understand its dispute model before depositing.</span><button onClick={() => navigate('Escrows')}>View escrows <ArrowRight size={13} /></button></div>
                </section>
              )}
            </>
          )}
          <footer className="workspace-footer"><span>TrustEscrow <span className="footer-sep">/</span> TESTNET WORKSPACE</span><span>Transaction values reflect only data provided by the connected chain layer.</span></footer>
        </main>
      </div>
    </div>
  );
}

export default TrustEscrowApp;