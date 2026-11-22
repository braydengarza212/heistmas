export interface Transfer {
  to: string;
  lamports: number;
}

export interface ChainStatus {
  mode: 'mock' | 'live';
  /** How fees reach the dev wallet: as the coin's creator, or as a fee-sharing shareholder. */
  feeRoute: 'mock' | 'creator' | 'sharing';
  devWallet: string | null;
  mint: string | null;
  graduated: boolean;
  /** Dev wallet's share of fee-sharing distributions, in basis points (10000 = 100%). */
  shareBps: number;
  notes: string[];
}

export interface ChainAdapter {
  readonly mode: 'mock' | 'live';
  init(): Promise<ChainStatus>;
  status(): ChainStatus;
  /** Creator fees waiting to be claimed that will reach the dev wallet (lamports). */
  pendingFees(): Promise<number>;
  /** Claims everything claimable into the dev wallet. Null when there was nothing to claim. */
  claimFees(): Promise<{ lamports: number; signature: string } | null>;
  /** Dev wallet balance (lamports). */
  walletBalance(): Promise<number>;
  /** Signs a payout transaction and returns its signature before sending, so it can be recorded first. */
  preparePayout(transfers: Transfer[], memo: string): Promise<{ signature: string; send: () => Promise<void> }>;
  signatureStatus(signature: string): Promise<'confirmed' | 'failed' | 'unknown'>;
  /** Calls back when on-chain accounts that hold the fees change (trades). */
  onActivity(cb: () => void): void;
  close(): void;
}
