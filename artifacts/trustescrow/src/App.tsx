import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';
import TrustEscrowApp, {
  type CreateEscrowFields,
  type Escrow,
  type EscrowTransaction,
  type EscrowWallet,
} from '@/components/trust-escrow-app';
import {
  connectWallet,
  contractIsConfigured,
  createEscrow,
  depositFunds,
  isMetaMaskInstalled,
  loadEscrowData,
  markDelivered,
  raiseDispute,
  readWalletSnapshot,
  refundFunds,
  releaseFunds,
  resolveDispute,
  storeDescription,
  subscribeWallet,
  switchToSupportedNetwork,
  type EscrowRow,
} from '@/lib/escrow-chain';

const queryClient = new QueryClient();

const emptyWallet = (): EscrowWallet => ({
  installed: isMetaMaskInstalled(),
  address: '',
  networkName: 'Not connected',
  chainId: 0,
  balanceEth: '',
  correctNetwork: false,
  connecting: false,
});

const toUiWallet = (
  snapshot: Awaited<ReturnType<typeof readWalletSnapshot>>,
  connecting = false,
): EscrowWallet => ({
  ...snapshot,
  address: snapshot.address ?? '',
  chainId: snapshot.chainId ?? 0,
  balanceEth: snapshot.balanceEth ?? '',
  connecting,
});

const rowToUiEscrow = (row: EscrowRow): Escrow => ({
  ...row,
  transactionHashes: {
    ...row.transactionHashes,
    create: row.transactionHashes.created,
    deposit: row.transactionHashes.funded,
    markDelivered: row.transactionHashes.delivered,
    release: row.transactionHashes.released,
    refund: row.transactionHashes.refunded,
    raiseDispute: row.transactionHashes.disputed,
    resolveDispute: row.transactionHashes.resolution,
  },
  sellerStats: {
    completedCount: row.successfulSales,
    settledCount: row.settledSales,
    disputedCount: row.disputedSales,
  },
});

function makeDemoRows(): { escrows: Escrow[]; transactions: EscrowTransaction[] } {
  const now = Math.floor(Date.now() / 1000);
  const escrows: Escrow[] = [
    {
      id: 'DEMO-001',
      buyer: '0x1234567890abcdef1234567890abcdef12345678',
      seller: '0xabcdef1234567890abcdef1234567890abcdef12',
      amountEth: '0.50',
      deadlineEpoch: now + 12 * 86400,
      createdAtEpoch: now - 86400,
      status: 'Funded',
      description: 'Website development',
      transactionHashes: {},
      sellerStats: { completedCount: 8, settledCount: 9, disputedCount: 1 },
    },
    {
      id: 'DEMO-002',
      buyer: '0xabcdef1234567890abcdef1234567890abcdef12',
      seller: '0x234567890abcdef1234567890abcdef123456789',
      amountEth: '0.12',
      deadlineEpoch: now + 3 * 3600,
      createdAtEpoch: now - 2 * 86400,
      status: 'Delivered',
      description: 'Logo design',
      transactionHashes: {},
      sellerStats: { completedCount: 4, settledCount: 4, disputedCount: 0 },
    },
    {
      id: 'DEMO-003',
      buyer: '0x34567890abcdef1234567890abcdef1234567890',
      seller: '0x4567890abcdef1234567890abcdef12345678901',
      amountEth: '0.34',
      deadlineEpoch: now - 4 * 86400,
      createdAtEpoch: now - 14 * 86400,
      status: 'Released',
      description: 'Mobile app UI',
      transactionHashes: {},
      sellerStats: { completedCount: 11, settledCount: 12, disputedCount: 1 },
    },
    {
      id: 'DEMO-004',
      buyer: '0x567890abcdef1234567890abcdef123456789012',
      seller: '0x67890abcdef1234567890abcdef1234567890123',
      amountEth: '0.20',
      deadlineEpoch: now + 5 * 86400,
      createdAtEpoch: now - 3 * 86400,
      status: 'Disputed',
      description: 'Data analysis project',
      transactionHashes: {},
      sellerStats: { completedCount: 2, settledCount: 3, disputedCount: 1 },
    },
  ];
  const transactions: EscrowTransaction[] = [
    { kind: 'Funds deposited', escrowId: 'DEMO-001', wallet: escrows[0].buyer, amountEth: '0.50', timestampEpoch: now - 86400, status: 'Demo only', hash: '', explorerUrl: '' },
    { kind: 'Delivery marked', escrowId: 'DEMO-002', wallet: escrows[1].seller, amountEth: '0.12', timestampEpoch: now - 3600, status: 'Demo only', hash: '', explorerUrl: '' },
    { kind: 'Funds released', escrowId: 'DEMO-003', wallet: escrows[2].buyer, amountEth: '0.34', timestampEpoch: now - 5 * 86400, status: 'Demo only', hash: '', explorerUrl: '' },
    { kind: 'Dispute raised', escrowId: 'DEMO-004', wallet: escrows[3].buyer, amountEth: '0.20', timestampEpoch: now - 1800, status: 'Demo only', hash: '', explorerUrl: '' },
  ];
  return { escrows, transactions };
}

function Home() {
  const [wallet, setWallet] = useState<EscrowWallet>(emptyWallet);
  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [transactions, setTransactions] = useState<EscrowTransaction[]>([]);
  const [arbitratorAddress, setArbitratorAddress] = useState<string | null>(null);
  const [dataAvailable, setDataAvailable] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [walletConnectionError, setWalletConnectionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState(() => !contractIsConfigured());
  const manuallyDisconnected = useRef(false);
  const contractReady = contractIsConfigured();

  const refreshChainData = useCallback(async () => {
    if (!contractReady || !isMetaMaskInstalled()) {
      setDataAvailable(false);
      setEscrows([]);
      setTransactions([]);
      setArbitratorAddress(null);
      setIsLoading(false);
      return;
    }
    const snapshot = await readWalletSnapshot();
    if (!snapshot.correctNetwork) {
      setDataAvailable(false);
      setEscrows([]);
      setTransactions([]);
      setArbitratorAddress(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const result = await loadEscrowData();
      setEscrows(result.escrows.map(rowToUiEscrow));
      setTransactions(result.transactions);
      setArbitratorAddress(result.arbitratorAddress);
      setDataAvailable(true);
      setError(null);
    } catch (loadError) {
      setDataAvailable(false);
      const message = loadError instanceof Error ? loadError.message : 'Unable to load contract data.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [contractReady]);

  const refreshWalletAndData = useCallback(async (accountOverride?: string | null) => {
    try {
      const snapshot = await readWalletSnapshot(accountOverride);
      const visibleSnapshot = manuallyDisconnected.current
        ? { ...snapshot, address: null, balanceEth: null }
        : snapshot;
      setWallet(toUiWallet(visibleSnapshot, false));
      if (snapshot.correctNetwork) await refreshChainData();
      else {
        setDataAvailable(false);
        setEscrows([]);
        setTransactions([]);
        setArbitratorAddress(null);
      }
    } catch (walletError) {
      setError(walletError instanceof Error ? walletError.message : 'Unable to read the wallet connection.');
    }
  }, [refreshChainData]);

  useEffect(() => {
    const unsubscribe = subscribeWallet(
      (accounts) => {
        manuallyDisconnected.current = accounts.length === 0;
        void refreshWalletAndData(accounts[0] ?? null);
      },
      () => void refreshWalletAndData(),
    );
    void refreshWalletAndData();
    return unsubscribe;
  }, [refreshWalletAndData]);

  const runAction = useCallback(async <T,>(
    action: string,
    success: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    setPendingAction(action);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await operation();
      setSuccessMessage(success);
      await refreshWalletAndData();
      return result;
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : 'The transaction could not be completed.';
      setError(message);
      throw actionError;
    } finally {
      setPendingAction(null);
    }
  }, [refreshWalletAndData]);

  const onConnectWallet = async () => {
    setConnecting(true);
    setError(null);
    setWalletConnectionError(null);
    manuallyDisconnected.current = false;
    try {
      const snapshot = await connectWallet();
      setWallet(toUiWallet(snapshot, false));
      await refreshChainData();
    } catch (connectError) {
      setWalletConnectionError(connectError instanceof Error ? connectError.message : 'Wallet connection was not completed.');
    } finally {
      setConnecting(false);
    }
  };

  const onDisconnect = () => {
    manuallyDisconnected.current = true;
    setWallet((current) => ({ ...current, address: '', balanceEth: '' }));
    setSuccessMessage('Wallet display reset. This app cannot revoke wallet permissions in MetaMask.');
  };

  const onSwitchNetwork = async () => {
    try {
      setError(null);
      await switchToSupportedNetwork();
      await refreshWalletAndData();
    } catch (switchError) {
      setError(switchError instanceof Error ? switchError.message : 'The network could not be switched.');
    }
  };

  const onCreateEscrow = async (fields: CreateEscrowFields) => {
    const created = await runAction(
      'create',
      `Escrow record created on ${wallet.networkName}. The buyer must deposit funds in a separate transaction.`,
      async () => {
        const result = await createEscrow(fields);
        storeDescription(result.id, fields.description);
        return result;
      },
    );
    return { id: created.id };
  };

  const getAmount = (id: string) => {
    const escrow = escrows.find((item) => item.id === id);
    if (!escrow) throw new Error('This escrow is not present in the current on-chain data.');
    return escrow.amountEth;
  };
  const onDeposit = (id: string) => {
    void runAction('deposit', `Deposit confirmed on ${wallet.networkName}.`, () => depositFunds(id, getAmount(id))).catch(() => undefined);
  };
  const onMarkDelivered = (id: string) => {
    void runAction('markDelivered', `Delivery status recorded on ${wallet.networkName}.`, () => markDelivered(id)).catch(() => undefined);
  };
  const onRelease = (id: string) => {
    void runAction('release', `Payment released to the seller on ${wallet.networkName}.`, () => releaseFunds(id)).catch(() => undefined);
  };
  const onRefund = (id: string) => {
    void runAction('refund', `Refund confirmed on ${wallet.networkName}.`, () => refundFunds(id)).catch(() => undefined);
  };
  const onRaiseDispute = (id: string) => {
    void runAction('raiseDispute', `Dispute raised on ${wallet.networkName}. Normal release and refund are now blocked.`, () => raiseDispute(id)).catch(() => undefined);
  };
  const onResolveDispute = (id: string, paySeller: boolean) => {
    void runAction(
      'resolveDispute',
      paySeller ? `Arbitrator resolution paid the seller on ${wallet.networkName}.` : `Arbitrator resolution refunded the buyer on ${wallet.networkName}.`,
      () => resolveDispute(id, paySeller),
    ).catch(() => undefined);
  };

  const demoRef = useRef<ReturnType<typeof makeDemoRows> | null>(null);
  if (demoRef.current === null) demoRef.current = makeDemoRows();
  const demo = demoRef.current;
  const visibleEscrows = demoMode ? demo.escrows : escrows;
  const visibleTransactions = demoMode ? demo.transactions : transactions;

  return (
    <TrustEscrowApp
      wallet={{ ...wallet, connecting }}
      escrows={visibleEscrows}
      transactions={visibleTransactions}
      isLoading={!demoMode && isLoading}
      pendingAction={pendingAction}
      error={demoMode ? null : error}
      successMessage={successMessage}
      demoMode={demoMode}
      walletConnectionError={walletConnectionError}
      onConnectWallet={onConnectWallet}
      onDisconnect={onDisconnect}
      onCreateEscrow={onCreateEscrow}
      onDeposit={onDeposit}
      onMarkDelivered={onMarkDelivered}
      onRelease={onRelease}
      onRefund={onRefund}
      onRaiseDispute={onRaiseDispute}
      onResolveDispute={onResolveDispute}
      onSwitchNetwork={onSwitchNetwork}
      onToggleDemoMode={() => {
        setSuccessMessage(null);
        setDemoMode((current) => !current);
      }}
      contractReady={contractReady}
      dataAvailable={demoMode || dataAvailable}
      arbitratorAddress={arbitratorAddress}
      onRetry={() => void refreshWalletAndData()}
    />
  );
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
