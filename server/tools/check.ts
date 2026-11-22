/**
 * Safe pre-flight check for live mode. Sends nothing and moves no SOL.
 *
 *   npm run server:check
 *
 * Reads your .env, connects to Solana, confirms the dev wallet can collect
 * this coin's creator fees, shows what is waiting to be claimed, and runs
 * the claim transaction in simulation so you can see it would succeed.
 */
import { config, validateLiveConfig } from '../config';

const sol = (l: number) => `${(l / 1e9).toFixed(6)} SOL`;

async function main() {
  console.log('Heistmas pre-flight check\n');
  console.log(`  servers        ${config.serverCount} × ${config.maxPlayersPerServer} players`);
  console.log(`  rounds         ${config.roundSeconds}s race + ${config.intermissionSeconds}s break (late join ${config.lateJoinSeconds}s)`);
  console.log(`  payout split   ${config.split.join(' / ')} %${config.houseCutPercent ? ` (site keeps ${config.houseCutPercent}%)` : ''}`);
  console.log(`  min payout     ${sol(config.minPayoutLamports)} · wallet reserve ${sol(config.walletReserveLamports)}`);
  console.log(`  claiming       every ${config.claimPollSeconds}s or on trades, when ≥ ${sol(config.claimMinLamports)}, at most every ${config.claimMinIntervalSeconds}s`);
  console.log(`  run checks     ${config.antiCheat ? `on (min finish ${config.minFinishSeconds}s)` : 'OFF — do not run prizes like this'}`);
  console.log(`  chain mode     ${config.chainMode}${config.dryRun ? ' (DRY_RUN)' : ''}\n`);
  if (config.chainMode !== 'live') {
    console.log('CHAIN_MODE is "mock": nothing to check on chain. Set CHAIN_MODE=live with your keys to check a real setup.');
    return;
  }
  const problems = validateLiveConfig();
  if (problems.length) throw new Error(`missing settings: ${problems.join(', ')}`);
  const { SolanaChain } = await import('../chain/solana');
  const chain = new SolanaChain({ rpcUrl: config.rpcUrl, wsUrl: config.wsUrl, secret: config.devWalletSecret, mint: config.token.mint!, priorityFeeMicroLamports: config.priorityFeeMicroLamports, log: console.log });
  console.log(`  rpc            ${config.rpcUrl} (${config.cluster})`);
  console.log(`  dev wallet     ${chain.dev.toBase58()}`);
  const st = await chain.init();
  console.log(`  coin           ${st.mint}${st.graduated ? ' (graduated to PumpSwap)' : ' (on the bonding curve)'}`);
  console.log(`  fee route      ${st.feeRoute === 'creator' ? 'dev wallet is the coin creator' : `fee sharing, dev wallet gets ${(st.shareBps / 100).toFixed(2)}%`}`);
  for (const n of st.notes) console.log(`  note           ${n}`);
  const bal = await chain.walletBalance();
  console.log(`  balance        ${sol(bal)}${bal < config.walletReserveLamports ? '  ← top this up: payouts keep this reserve for fees' : ''}`);
  const pending = await chain.pendingFees();
  console.log(`  claimable now  ${sol(pending)}`);
  if (pending > 0) {
    const sim = await chain.simulateClaim();
    console.log(`  claim (simulated) ${sim.ok ? 'would succeed' : 'would FAIL'}${'err' in sim && sim.err ? ` ${JSON.stringify(sim.err)}` : ''}`);
    if (!sim.ok) for (const l of sim.logs.slice(-12)) console.log(`    ${l}`);
  } else console.log('  claim          nothing to claim yet (trades will add fees)');
  chain.close();
  console.log('\nAll good. Start the server with `npm start`.');
  setTimeout(() => process.exit(0), 200);
}

main().catch((e) => {
  console.error(`\nCheck failed: ${(e as Error).message}`);
  process.exit(1);
});
