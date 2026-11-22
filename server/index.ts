/**
 * Heistmas game server: serves the game, runs the 10 servers and the round
 * clock, claims the coin's creator fees and pays each round's top 3.
 *
 *   npm run build && npm start
 *
 * Settings come from environment variables or .env (see .env.example).
 */
import { config, validateLiveConfig } from './config';
import { Store } from './store';
import { Accounts } from './accounts';
import { Treasury } from './treasury';
import { Game } from './game';
import { createHttp } from './http';
import { startPriceFeed } from './price';
import { MockChain } from './chain/mock';
import type { ChainAdapter } from './chain/types';

const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function main() {
  const store = new Store(config.dataDir);
  if (store.statsWasReset) log('stats reset: every player\'s wins, podiums, SOL won, best times and round history were cleared (accounts kept)');
  const accounts = new Accounts(store, config.registrationsPerIpPerHour);

  let chain: ChainAdapter;
  if (config.chainMode === 'live') {
    const problems = validateLiveConfig();
    if (problems.length) throw new Error(`CHAIN_MODE=live needs: ${problems.join(', ')}`);
    const { SolanaChain } = await import('./chain/solana');
    chain = new SolanaChain({
      rpcUrl: config.rpcUrl,
      wsUrl: config.wsUrl,
      secret: config.devWalletSecret,
      mint: config.token.mint!,
      priorityFeeMicroLamports: config.priorityFeeMicroLamports,
      log,
    });
  } else {
    chain = new MockChain(config.mockFeeLamportsPerMinute);
  }
  const status = await chain.init();
  log(`chain: ${status.mode}${status.mode === 'live' ? ` (${config.cluster})` : ''} · fees via ${status.feeRoute} · dev wallet ${status.devWallet ?? '-'}`);
  for (const n of status.notes) log(`chain: ${n}`);
  if (config.dryRun) log('DRY_RUN is on: nothing will be claimed or paid.');
  if (!config.antiCheat) log('WARNING: ANTICHEAT=off — every reported finish counts. Use only for local testing.');

  const treasury = new Treasury(chain, store, config, log);
  const game = new Game(config, store, accounts, treasury, log);
  game.treasuryStatus = () => ({ devWallet: chain.status().devWallet });
  const stopPrice = startPriceFeed(config.priceUrl, (usd) => treasury.setPrice(usd), log);

  game.start();
  await treasury.start();
  const server = createHttp({ cfg: config, game, accounts, store, treasury, log });
  server.listen(config.port, config.host, () => log(`Heistmas server on http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`));

  let closing = false;
  const shutdown = (sig: string) => {
    if (closing) return;
    closing = true;
    log(`${sig}: shutting down`);
    stopPrice();
    treasury.stop();
    game.stop();
    chain.close();
    store.flushAll();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  console.error(`Heistmas server failed to start: ${(e as Error).message}`);
  process.exit(1);
});
