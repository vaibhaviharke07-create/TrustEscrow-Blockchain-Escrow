import {
  BrowserProvider,
  Contract,
  getAddress,
  isAddress,
  parseEther,
  formatEther,
  type ContractTransactionResponse,
  type TransactionReceipt,
} from "ethers";
import escrowAbi from "./escrow-abi.json";

export type EscrowStatus =
  | "Created"
  | "Funded"
  | "Delivered"
  | "Released"
  | "Refunded"
  | "Disputed";

export type EscrowAction =
  | "created"
  | "funded"
  | "delivered"
  | "released"
  | "refunded"
  | "disputed"
  | "resolution";

export interface EscrowRow {
  id: string;
  buyer: string;
  seller: string;
  amountEth: string;
  deadlineEpoch: number;
  createdAtEpoch: number;
  status: EscrowStatus;
  description: string;
  transactionHashes: Partial<Record<EscrowAction, string>>;
  successfulSales?: number;
  settledSales?: number;
  disputedSales?: number;
}

export interface TransactionRow {
  kind: string;
  escrowId: string;
  wallet: string;
  amountEth: string;
  timestampEpoch: number;
  status: "Confirmed";
  hash: string;
  explorerUrl: string;
}

export interface WalletSnapshot {
  installed: boolean;
  address: string | null;
  networkName: string;
  chainId: number | null;
  balanceEth: string | null;
  correctNetwork: boolean;
}

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

const EXPECTED_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID || "11155111");
const NETWORK_NAME = import.meta.env.VITE_NETWORK_NAME || "Sepolia";
const EXPLORER_URL =
  import.meta.env.VITE_EXPLORER_URL || "https://sepolia.etherscan.io";
const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || "";
const DEPLOYMENT_BLOCK = Number(import.meta.env.VITE_DEPLOYMENT_BLOCK || "0");
const SUPPORTED_TESTNET_CHAIN_IDS = new Set([
  97, // BNB Smart Chain Testnet
  300, // zkSync Sepolia
  17000, // Holesky
  80002, // Polygon Amoy
  84532, // Base Sepolia
  11155111, // Sepolia
  11155420, // Optimism Sepolia
  421614, // Arbitrum Sepolia
  43113, // Avalanche Fuji
  59141, // Linea Sepolia
  560048, // Hoodi
]);

const STATUS_NAMES: EscrowStatus[] = [
  "Created",
  "Funded",
  "Delivered",
  "Released",
  "Refunded",
  "Disputed",
];

const ACTION_TO_HASH: Record<string, EscrowAction | undefined> = {
  EscrowCreated: "created",
  FundsDeposited: "funded",
  DeliveryMarked: "delivered",
  FundsReleased: "released",
  RefundIssued: "refunded",
  DisputeRaised: "disputed",
  DisputeResolved: "resolution",
};

const EVENT_TITLES: Record<string, string> = {
  EscrowCreated: "Escrow created",
  FundsDeposited: "Funds deposited",
  DeliveryMarked: "Delivery marked",
  FundsReleased: "Funds released",
  RefundIssued: "Refund issued",
  DisputeRaised: "Dispute raised",
  DisputeResolved: "Dispute resolved",
};

export function isMetaMaskInstalled(): boolean {
  return Boolean(window.ethereum);
}

export function contractIsConfigured(): boolean {
  return isAddress(CONTRACT_ADDRESS) && SUPPORTED_TESTNET_CHAIN_IDS.has(EXPECTED_CHAIN_ID);
}

export function contractAddress(): string | null {
  return contractIsConfigured() ? getAddress(CONTRACT_ADDRESS) : null;
}

export function expectedNetworkName(): string {
  return NETWORK_NAME;
}

export function subscribeWallet(
  onAccountsChanged: (accounts: string[]) => void,
  onChainChanged: () => void,
): () => void {
  const ethereum = window.ethereum;
  if (!ethereum?.on) return () => undefined;
  const accountsListener = (value: unknown) => {
    onAccountsChanged(Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
  };
  const chainListener = () => onChainChanged();
  ethereum.on("accountsChanged", accountsListener);
  ethereum.on("chainChanged", chainListener);
  return () => {
    ethereum.removeListener?.("accountsChanged", accountsListener);
    ethereum.removeListener?.("chainChanged", chainListener);
  };
}

export async function connectWallet(): Promise<WalletSnapshot> {
  const ethereum = window.ethereum;
  if (!ethereum) throw new Error("Please install MetaMask or a compatible browser wallet to connect.");
  const accounts = (await ethereum.request({
    method: "eth_requestAccounts",
  })) as string[];
  return readWalletSnapshot(accounts?.[0] ?? null);
}

export async function readWalletSnapshot(
  addressOverride?: string | null,
): Promise<WalletSnapshot> {
  const ethereum = window.ethereum;
  if (!ethereum) {
    return {
      installed: false,
      address: null,
      networkName: "Not connected",
      chainId: null,
      balanceEth: null,
      correctNetwork: false,
    };
  }

  const provider = new BrowserProvider(ethereum as never);
  const network = await provider.getNetwork();
  let address = addressOverride;
  if (address === undefined) {
    const accounts = (await ethereum.request({
      method: "eth_accounts",
    })) as string[];
    address = accounts?.[0] ?? null;
  }

  const balanceEth =
    address && Number(network.chainId) === EXPECTED_CHAIN_ID
      ? formatEther(await provider.getBalance(address))
      : null;

  return {
    installed: true,
    address: address ? getAddress(address) : null,
    networkName:
      Number(network.chainId) === EXPECTED_CHAIN_ID
        ? NETWORK_NAME
        : `Chain ${network.chainId.toString()}`,
    chainId: Number(network.chainId),
    balanceEth,
    correctNetwork:
      Number(network.chainId) === EXPECTED_CHAIN_ID &&
      SUPPORTED_TESTNET_CHAIN_IDS.has(EXPECTED_CHAIN_ID),
  };
}

export async function switchToSupportedNetwork(): Promise<void> {
  const ethereum = window.ethereum;
  if (!ethereum) throw new Error("MetaMask is required to interact with the blockchain.");
  if (!SUPPORTED_TESTNET_CHAIN_IDS.has(EXPECTED_CHAIN_ID)) {
    throw new Error("The configured chain is not in TrustEscrow's supported EVM testnet list.");
  }
  const chainHex = `0x${EXPECTED_CHAIN_ID.toString(16)}`;
  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainHex }],
    });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 4902 || EXPECTED_CHAIN_ID !== 11155111) throw error;
    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chainHex,
          chainName: NETWORK_NAME,
          nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [
            import.meta.env.VITE_SEPOLIA_RPC_URL ||
              "https://ethereum-sepolia-rpc.publicnode.com",
          ],
          blockExplorerUrls: [EXPLORER_URL],
        },
      ],
    });
  }
}

function getProvider(): BrowserProvider {
  if (!window.ethereum) {
    throw new Error("MetaMask is required to interact with the blockchain.");
  }
  return new BrowserProvider(window.ethereum as never);
}

async function getDeployedContract(
  signer = false,
): Promise<Contract> {
  if (!contractIsConfigured()) {
    throw new Error(
      "Live escrow actions are unavailable. Configure VITE_CONTRACT_ADDRESS after deploying the contract to Sepolia.",
    );
  }
  const provider = getProvider();
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== EXPECTED_CHAIN_ID) {
    throw new Error("Wrong network. Please switch to the supported testnet.");
  }
  const address = getAddress(CONTRACT_ADDRESS);
  if ((await provider.getCode(address)) === "0x") {
    throw new Error("No escrow contract was found at the configured address on this network.");
  }
  return new Contract(
    address,
    escrowAbi,
    signer ? await provider.getSigner() : provider,
  );
}

function descriptionKey(id: string): string {
  return `trustescrow:${EXPECTED_CHAIN_ID}:description:${id}`;
}

export function storeDescription(id: string, description: string): void {
  try {
    if (description.trim()) localStorage.setItem(descriptionKey(id), description.trim());
  } catch {
    // Browser storage can be disabled; the on-chain escrow remains valid.
  }
}

function loadDescription(id: string): string {
  try {
    return localStorage.getItem(descriptionKey(id)) ?? "";
  } catch {
    return "";
  }
}

function formatEth(value: bigint): string {
  return formatEther(value);
}

function eventArgs(log: { topics: readonly string[]; data: string }, contract: Contract) {
  return contract.interface.parseLog({ topics: [...log.topics], data: log.data });
}

function transactionExplorerUrl(hash: string): string {
  return `${EXPLORER_URL.replace(/\/$/, "")}/tx/${hash}`;
}

export async function loadEscrowData(): Promise<{
  escrows: EscrowRow[];
  transactions: TransactionRow[];
  arbitratorAddress: string;
}> {
  const contract = await getDeployedContract();
  const provider = getProvider();
  const arbitratorAddress = getAddress(String(await contract.arbitrator()));
  const latestBlock = await provider.getBlockNumber();
  const fromBlock =
    Number.isFinite(DEPLOYMENT_BLOCK) && DEPLOYMENT_BLOCK > 0
      ? DEPLOYMENT_BLOCK
      : 0;
  const eventNames = [
    "EscrowCreated",
    "FundsDeposited",
    "DeliveryMarked",
    "FundsReleased",
    "RefundIssued",
    "DisputeRaised",
    "DisputeResolved",
  ] as const;

  const eventLogs = await Promise.all(
    eventNames.map((name) =>
      contract.queryFilter(contract.filters[name](), fromBlock, latestBlock),
    ),
  );
  const flattened = eventLogs.flat().sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
    return a.index - b.index;
  });

  const creationEvents = flattened
    .map((log) => ({ log, parsed: eventArgs(log, contract) }))
    .filter((item) => item.parsed?.name === "EscrowCreated");

  const escrows: EscrowRow[] = await Promise.all(
    creationEvents.map(async ({ log, parsed }) => {
      if (!parsed) throw new Error("An escrow creation event could not be decoded.");
      const id = String(parsed.args.escrowId);
      const live = await contract.getEscrow(id);
      const statusIndex = Number(live.status);
      const seller = String(live.seller);
      const [successfulSales, settledSales, disputedSales] = await Promise.all([
        contract.successfulSales(seller) as Promise<bigint>,
        contract.settledSales(seller) as Promise<bigint>,
        contract.disputedSales(seller) as Promise<bigint>,
      ]);
      const transactionHashes: EscrowRow["transactionHashes"] = {
        created: log.transactionHash,
      };
      for (const item of flattened) {
        const itemParsed = eventArgs(item, contract);
        if (
          itemParsed &&
          String(itemParsed.args.escrowId) === id &&
          ACTION_TO_HASH[itemParsed.name]
        ) {
          transactionHashes[ACTION_TO_HASH[itemParsed.name]!] =
            item.transactionHash;
        }
      }
      return {
        id,
        buyer: String(live.buyer),
        seller,
        amountEth: formatEth(BigInt(live.amount)),
        deadlineEpoch: Number(live.deadline),
        createdAtEpoch: Number(live.createdAt),
        status: STATUS_NAMES[statusIndex] ?? "Created",
        description: loadDescription(id),
        transactionHashes,
        successfulSales: Number(successfulSales),
        settledSales: Number(settledSales),
        disputedSales: Number(disputedSales),
      };
    }),
  );

  const resolutionHashes = new Set(
    flattened
      .filter((log) => eventArgs(log, contract)?.name === "DisputeResolved")
      .map((log) => log.transactionHash),
  );
  const historyLogs = flattened.filter((log) => {
    const name = eventArgs(log, contract)?.name;
    return !(
      resolutionHashes.has(log.transactionHash) &&
      (name === "FundsReleased" || name === "RefundIssued")
    );
  });
  const blockTimeCache = new Map<number, Promise<number>>();
  const transactions: TransactionRow[] = await Promise.all(
    historyLogs.map(async (log) => {
      const parsed = eventArgs(log, contract);
      if (!parsed) throw new Error("A contract event could not be decoded.");
      const id = String(parsed.args.escrowId);
      let timestamp = blockTimeCache.get(log.blockNumber);
      if (!timestamp) {
        timestamp = provider
          .getBlock(log.blockNumber)
          .then((block) => block?.timestamp ?? 0);
        blockTimeCache.set(log.blockNumber, timestamp);
      }
      const escrow = escrows.find((row) => row.id === id);
      const args = parsed.args;
      const wallet =
        args.buyer ??
        args.seller ??
        args.raisedBy ??
        args.arbitrator ??
        escrow?.buyer ??
        "";
      const amount =
        args.amount !== undefined
          ? formatEth(BigInt(args.amount))
          : escrow?.amountEth ?? "0";
      const kind =
        parsed.name === "DisputeResolved"
          ? `${EVENT_TITLES[parsed.name]} · ${args.sellerPaid ? "seller paid" : "buyer refunded"}`
          : EVENT_TITLES[parsed.name] ?? parsed.name;
      return {
        kind,
        escrowId: id,
        wallet: String(wallet),
        amountEth: amount,
        timestampEpoch: await timestamp,
        status: "Confirmed",
        hash: log.transactionHash,
        explorerUrl: transactionExplorerUrl(log.transactionHash),
      };
    }),
  );

  return {
    escrows: escrows.sort((a, b) => Number(b.id) - Number(a.id)),
    transactions: transactions.sort(
      (a, b) => b.timestampEpoch - a.timestampEpoch,
    ),
    arbitratorAddress,
  };
}

function explainWalletError(error: unknown): string {
  const walletError = error as {
    code?: number | string;
    shortMessage?: string;
    message?: string;
    errorName?: string;
    revert?: { name?: string };
    info?: { error?: { code?: number } };
  };
  if (walletError.code === 4001 || walletError.info?.error?.code === 4001 || walletError.code === "ACTION_REJECTED") {
    return "Transaction rejected in MetaMask.";
  }
  if (walletError.code === "INSUFFICIENT_FUNDS") {
    return "Insufficient testnet balance.";
  }
  const revertName = walletError.revert?.name ?? walletError.errorName;
  if (
    revertName === "NotBuyer" ||
    revertName === "NotSeller" ||
    revertName === "NotParticipant" ||
    revertName === "NotArbitrator"
  ) {
    return "You are not authorized to perform this action.";
  }
  if (revertName === "IncorrectDeposit") {
    return "The deposit must exactly match the amount agreed in this escrow.";
  }
  if (revertName === "DeadlinePassed") {
    return "The escrow deadline has passed; this action is no longer available.";
  }
  if (revertName === "DeadlineNotPassed") {
    return "A refund is available only after the escrow deadline.";
  }
  if (revertName === "InvalidState") {
    return "This escrow action is not allowed in its current state.";
  }
  if (revertName === "InvalidSeller" || revertName === "ZeroAddress") {
    return "Choose a valid seller address that is different from your wallet.";
  }
  if (revertName === "InvalidAmount") {
    return "Enter a positive amount with no more than 18 decimal places.";
  }
  if (revertName === "EscrowNotFound") {
    return "This escrow could not be found on the configured contract.";
  }
  if (revertName === "TransferFailed") {
    return "The contract could not complete the payout. No settlement was recorded.";
  }
  if (walletError.code === "CALL_EXCEPTION") {
    return "This escrow action is not allowed in its current state.";
  }
  return walletError.shortMessage || walletError.message || "The transaction could not be completed.";
}

async function sendAndConfirm(
  send: () => Promise<ContractTransactionResponse>,
): Promise<string> {
  try {
    const tx = await send();
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error("The transaction did not confirm successfully.");
    }
    return receipt.hash;
  } catch (error) {
    throw new Error(explainWalletError(error), { cause: error });
  }
}

export interface CreateEscrowInput {
  seller: string;
  amountEth: string;
  deadlineEpoch: number;
  description: string;
}

export async function createEscrow(
  input: CreateEscrowInput,
): Promise<{ id: string; transactionHash: string }> {
  const seller = input.seller.trim();
  if (!isAddress(seller)) {
    throw new Error("Please enter a valid Ethereum wallet address.");
  }
  let amountWei: bigint;
  try {
    amountWei = parseEther(input.amountEth);
  } catch {
    throw new Error("Enter a positive amount with no more than 18 decimal places.");
  }
  if (amountWei <= 0n) throw new Error("Amount must be greater than zero.");
  if (!Number.isInteger(input.deadlineEpoch) || input.deadlineEpoch <= Date.now() / 1000) {
    throw new Error("Deadline must be in the future.");
  }
  if (BigInt(input.deadlineEpoch) > (1n << 64n) - 1n) {
    throw new Error("Deadline is outside the contract's supported timestamp range.");
  }
  const contract = await getDeployedContract(true);
  let createdId = "";
  const transactionHash = await sendAndConfirm(async () => {
    const tx = await contract.createEscrow(
      getAddress(seller),
      amountWei,
      input.deadlineEpoch,
    );
    const receipt = (await tx.wait()) as TransactionReceipt;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== (await contract.getAddress()).toLowerCase()) {
        continue;
      }
      const parsed = eventArgs(log, contract);
      if (parsed?.name === "EscrowCreated") createdId = String(parsed.args.escrowId);
    }
    return tx;
  });
  if (!createdId) throw new Error("The transaction confirmed but no escrow ID was found in its contract event.");
  storeDescription(createdId, input.description);
  return { id: createdId, transactionHash };
}

export async function depositFunds(id: string, amountEth: string): Promise<string> {
  const contract = await getDeployedContract(true);
  return sendAndConfirm(() =>
    contract.deposit(id, { value: parseEther(amountEth) }),
  );
}

export async function markDelivered(id: string): Promise<string> {
  const contract = await getDeployedContract(true);
  return sendAndConfirm(() => contract.markDelivered(id));
}

export async function releaseFunds(id: string): Promise<string> {
  const contract = await getDeployedContract(true);
  return sendAndConfirm(() => contract.release(id));
}

export async function refundFunds(id: string): Promise<string> {
  const contract = await getDeployedContract(true);
  return sendAndConfirm(() => contract.refund(id));
}

export async function raiseDispute(id: string): Promise<string> {
  const contract = await getDeployedContract(true);
  return sendAndConfirm(() => contract.raiseDispute(id));
}

export async function resolveDispute(
  id: string,
  paySeller: boolean,
): Promise<string> {
  const contract = await getDeployedContract(true);
  return sendAndConfirm(() => contract.resolveDispute(id, paySeller));
}

export function addWalletResetListener(onReset: () => void): () => void {
  return subscribeWallet((accounts) => {
    if (accounts.length === 0) onReset();
  }, onReset);
}