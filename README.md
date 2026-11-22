# HEISTMAS — *Silent Night. Five Stars.*

A 3D Christmas heist party game for the browser, built with **Three.js + TypeScript + Vite** and **Rapier 3D physics**.
You play a bean-shaped Santa robber who sneaks into **The Christmas Bank**, dodges lasers and penguin security,
cracks a giant vault, then fights through ten stages — deposit vaults, a coin mint over molten gold, the snowy
rooftops and a police roadblock — to a getaway van waiting with its engine running.

Online, everyone races the same heist in synchronized 5-minute rounds across 10 servers of up to 2,000 players.
The 3 fastest escapes of each round split a prize pot made of the **$HEISTMAS** memecoin's pump.fun creator fees,
which the game server claims around the clock and pays out automatically in SOL.

Everything — characters, environment, props, textures, particles, music and sound effects — is generated
procedurally at runtime. There are no external image, model or audio files to license or host.

---

## How online rounds work

- **Accounts.** Players pick a permanent username, then the Solana address that receives their prizes
  (both locked once set; they log back in with the pair). Only the public address is ever asked for.
- **Servers.** `SERVER_COUNT` servers (default 10) of up to `MAX_PLAYERS_PER_SERVER` players (default 2,000).
  Every server races the **same** synchronized round, so there is one global top 3.
- **Shared world.** Inside a server, robbers are placed in **banks** of up to `BANK_CAPACITY` (default 200) who run
  the same Christmas Bank together: you see the other robbers (name tags, outfits, the weapon in their hands),
  their snowballs, and you can freeze them. Each client streams its state 10×/s; the server sends every robber
  only the 40 nearest robbers within 95 m (about 12 KB/s per player however full the bank is). Robbers pass
  through each other, so crowds never block a corridor. Guards, loot and weapon pickups stay local to each
  player. Snowball hits on robbers are checked by the server (the shooter must have fired that weapon within the
  last few seconds, the victim must be in range and not already frozen) before the victim is frozen for 5
  seconds. Code: `server/world.ts`, `src/game/RemotePlayers.ts`. The pre-round warm-up stays solo.
- **Room for a crowd.** Robbers and penguin guards are drawn and collide at `CHAR_SCALE` (0.68, `src/game/scale.ts`)
  of their original size while the bank, jumps, speeds and timings stay the same — exactly equivalent to every
  stage being about 1.5× larger (2.2× the floor space) around them, with the camera scaled to match.
- **Rounds.** Every `ROUND_SECONDS` (default 300 = 5 min) a race starts for everyone at once. The level loads and
  waits at the start line, counts down, then GO. Times are measured by the server from the round's start.
  Busted? Back to the start — the clock keeps running. Then `INTERMISSION_SECONDS` (default 30) of results and
  countdown before the next race.
- **Prize pot.** The coin's pump.fun creator fees are claimed into the dev wallet around the clock (on every trade
  notification, plus a poll every `CLAIM_POLL_SECONDS`). The HUD shows the pot live above the loot counter,
  including fees still waiting in the vault, and what 1st/2nd/3rd would get.
- **Payouts.** When a round ends, any last fees are swept, and the **3 fastest verified escapes** split the pot
  (`PAYOUT_SPLIT`, default 50/30/20) in one Solana transaction. Results show each winner, the amount and a link to
  the transaction. Nobody else wins. Shares nobody won (fewer than 3 finishers, or below `MIN_PAYOUT_SOL`) roll
  into the next pot. A failed payout is retried automatically and never sent twice.
- **$HEISTMAS page.** The menu's coin strip opens a page explaining the memecoin, its pump.fun launch, contract
  address, links, live pot/paid stats, how the pot works, and a plain-language risk disclaimer.

## Quick start (local, simulated SOL)

```bash
npm install
npm run build      # build the game into ./dist
npm start          # game + game server on http://localhost:8080 (CHAIN_MODE=mock: fake fees, fake payouts)
```

For development, run `npm start` in one terminal and `npm run dev` in another (http://localhost:5173 proxies
`/api` and `/ws` to the server). Node 20.10+ is required (developed with Node 22).

Useful commands:

| Command | What it does |
| --- | --- |
| `npm test` | Server tests: payout split and rollover, payout retry safety, run checks, accounts |
| `npm run bots -- --url http://localhost:8080 --bots 200` | Swarm of scripted players (see `server/tools/bots.ts`; add `--cheaters 3` to watch the run checks) |
| `npm run server:check` | Pre-flight for live mode: verifies the dev wallet and coin, shows claimable fees, simulates a claim. Sends nothing. |
| `npm run typecheck` | Type-checks the game and the server |

Tested here: 2,000 bots on one server (the 2,001st is turned away as full), 60 bots across all 10 servers over
several rounds, cheaters rejected, payouts split and paid, failed payouts retried, and the full browser flow
(register → join → countdown → race → escape → podium → next round). The live Solana path could not be run from
the build environment (no network), so do the go-live steps below with small amounts first.

## Hosting

The game now needs its **game server** (Node.js): it runs the rounds, holds the accounts and pays the prizes.
The same process serves the website, so you deploy one thing.

| Option | How |
| --- | --- |
| **Docker** (any VPS, Fly.io, Railway, Render…) | `docker build -t heistmas .` then `docker run -p 8080:8080 -v heistmas-data:/data --env-file .env heistmas` |
| **Render / Railway / Fly (Node)** | Build command `npm ci && npm run build`, start command `npm start`, add a persistent disk mounted at `DATA_DIR`, set the variables from `.env.example`. |
| **VPS** | `npm ci && npm run build`, then run `npm start` under systemd or pm2 behind nginx/Caddy for HTTPS (proxy `/ws` with WebSocket upgrade headers; set `TRUST_PROXY=true`). |

Needs: HTTPS (players' browsers require `wss://`), WebSockets, and a **persistent disk** for `DATA_DIR`
(accounts, the prize ledger and round history). One server process handles all 10 × 2,000 players; give it at
least 1 vCPU and 1 GB RAM, more for full servers.

Hosting the website separately (e.g. on Netlify) also works: build it with
`VITE_GAME_SERVER_URL=https://your-game-server.example.com npm run build` and set `ALLOWED_ORIGINS` on the server.
A static-only upload of `dist/` with no game server still plays: the game shows "servers offline" and offers
practice runs (no prizes).

## Going live with real SOL

1. **Pick how fees reach the dev wallet** (the server detects which one you use):
   - *Creator wallet:* the coin was created by the wallet whose key the server holds. Simplest, but that wallet's
     key lives on the server.
   - *Fee sharing:* keep the creator wallet offline and use pump.fun's creator fee sharing to send 100% (or your
     chosen share) to a separate hot wallet that the server holds. The server triggers the distributions itself.
     pump.fun only allows changing a coin's fee destination once after launch, so double-check the address.
2. Copy `.env.example` to `.env`, set `CHAIN_MODE=live`, `TOKEN_MINT`, `DEV_WALLET_SECRET_KEY` (or a path to a
   keypair file) and a paid `SOLANA_RPC_URL`. Fund the dev wallet with a little SOL for fees (`WALLET_RESERVE_SOL`).
3. Run `npm run server:check`. It confirms the wallet can collect this coin's fees and simulates a claim.
4. Start once with `DRY_RUN=true` and watch the log: it prints what it would claim and pay, sending nothing.
5. Go live with `DRY_RUN=false`. Set `ADMIN_TOKEN` and watch `GET /api/admin/status` (Bearer token) for unpaid
   prizes, recent claims and flagged runs.
6. Tune `MIN_FINISH_SECONDS` to just under the fastest legitimate escapes you see.

Keep the secret key out of git and out of the website build (only the server reads it). Use a dedicated wallet
that holds no more than the current pot plus fees.

### Run checks (anti-cheat) and their limits

The race runs in each player's browser, so the server cannot see the run itself. Instead the client streams its
position four times a second plus loot, vault and respawn events, and the server checks that the report is
physically possible: starting at the spawn, no client clock running fast, speeds within sprint/slide/knockback
limits, no teleports except respawns at checkpoints, zones entered in a connected order through every stage,
the roof reached only through the mint's hatch and the street only by the zipline, the vault cracked at its door
before entering it, loot picked up where the player was and adding up to $5,000,
the finish inside the getaway ring, and not faster than `MIN_FINISH_SECONDS`. Rejected runs are logged with
reasons and never win. Accounts are one per wallet, with per-IP limits.

This raises the bar a lot but does not make cheating impossible: someone who rewrites the game client can forge
a consistent, plausible report. For larger pots consider adding a short manual review before payouts, or
server-side replay of the top runs.

### Before you launch

Paying cash prizes for a contest and promoting a token can be regulated differently depending on where you
and your players are (prize-contest, gambling, securities and tax rules). The game requires players to confirm
they are 18+ and shows a disclaimer, but that is not legal advice — have a lawyer look at your setup.
Transitive dependencies of the Solana/Anchor SDKs carry some known `npm audit` advisories; the server never
passes player input into those code paths.

## Controls

| Key | Action |
| --- | --- |
| `W A S D` / arrows | Move |
| Mouse | Camera (click the game to lock the pointer; wheel zooms) |
| `Space` | Jump (hold for a higher jump) |
| `Shift` | Sprint — faster, but guards can hear you |
| `Ctrl` (or `C` / right mouse) | Dive in the air, belly-slide on the ground, bonk penguins |
| `E` | Interact — crack the vault, hack terminals, open vents, swap weapons |
| `F` / left mouse | Fire the weapon in hand (hold for the carbine and SMG) |
| `Q` | Camera lock — the robber always faces where the camera points |
| `Esc` | Pause |

Browsers reserve some `Ctrl` shortcuts (for example `Ctrl+W`). The game asks for confirmation before the page closes
mid-heist, and in fullscreen (Settings → Fullscreen) Chrome lets the game capture those keys. `C` and right mouse
are always-safe dive alternatives.

## The festive arsenal

One snowball weapon is hidden on every stage, in a random spot each round (the same spots for everyone in an
online round). Every gun holds 5 shots; a hit knocks a penguin guard back and freezes it for 5 seconds. Walk onto
a weapon to take it (or press `E` to swap it for a loaded one). Defined in `src/game/Arsenal.ts`.

| Stage | Weapon | Type |
| --- | --- | --- |
| 1 Plaza | Frosty Blaster | Ray gun |
| 2 Lobby | Candy Cane Carbine | Assault rifle (hold to fire) |
| 3 Laser Hall | Jingle Bell Shotgun | Shotgun, 7 pellets |
| 4 Vault Atrium | Nutcracker Long Rifle | Sniper rifle |
| 5 Vault Door | Snow Globe Launcher | Grenade launcher, area freeze |
| 6 Counting Room | Peppermint Revolver | Revolver |
| 7 Deposit Vaults | Tinsel Tommy | SMG (hold to fire) |
| 8 The Mint | Aurora Ray | Piercing ray gun |
| 9 Rooftops | Icicle Railgun | Piercing sniper |
| 10 Getaway Street | Yule Log Bazooka | Rocket launcher, big area freeze |

## The heist: The Christmas Bank

1. **Bank Plaza** — snowy square, automatic doors.
2. **Grand Lobby** — marble, a 10 m Christmas tree, teller counters, patrolling penguins, sweeping security cameras,
   and a **security terminal** (hack it: hall lasers and cameras go offline for 30 s, wanted level drops).
3. **Laser Hall** — static beams, spinning laser crosses, a sweeping laser curtain and a slide-under wall.
   *Hidden shortcut:* pry open the **vent** in the security office and crawl around the hall.
4. **Vault Atrium** — a pit of security grid with three routes: moving gift platforms past a rotating sweeper,
   a treadmill conveyor bridge, or bobbing stepping gifts (with a diamond).
5. **The Vault Door** — arcade dial-cracking minigame; the 7 m door physically unbolts and swings open. Alarms start.
6. **Grand Vault** — piles of gold, golden presents, gold bars and *The Star of the North* guarded by orbiting lasers.
   Stand on (or push the giant golden gift onto) the **pressure plate** to open the timed armored gate.
7. **Counting Room** — conveyor belts carrying loot into Wrap-o-Matic machines.

The escape gets harder with every stage (the banner shows the stage number and a five-pip difficulty rating,
and the wanted level can't cool below a rising floor once the alarms are up):

8. **Deposit Vaults** *(stage 7)* — a maze of safe-deposit cabinets. Drawers punch out of the walls on a timer:
   jump the low ones, slide under the high ones, weave between the full-height ones. The north corridor is a fast
   drawer gauntlet with a diamond at the end; the south corridor is slower and guarded. Shutters cycle at ★★★★.
9. **The Mint** *(stage 8)* — a bridge under three slamming coin presses over a pit of molten gold (falling in
   costs a heart and sends you back), a gold pillar and a gliding gold-bar raft, then the climb: a bounce pad up
   to a catwalk with steam vents, a freight hoist, an elite penguin on the upper catwalk and a pad that launches
   you through the roof hatch.
10. **Rooftops** *(stage 9)* — jump the alleys between snowy roofs, cross an icy roof, ride a window-cleaner's
    gondola up a storey, hop chimney stacks (one blasts smoke) and dodge the police helicopter's searchlight, which
    locks on and raises your wanted level. A zipline takes you down to the street.
11. **Getaway Street** *(stage 10)* — jump the spike strip, slip through the police roadblock (or vault a cruiser's
    hood), time your run across the intersection between a snowplow and a salt truck, and step into the green ring
    behind the van (you need at least $5,000).

**The getaway** is a short film: you dive into the van, the doors slam, it burns out in a cloud of tire smoke and
tears off down the street with the police in pursuit — one cruiser spins out into a snowbank, the helicopter
follows overhead and the van drifts around the corner into the night. Tire tracks, snow spray, exhaust, sirens,
suspension and multi-camera shots are all real-time; press any key to skip.

### Five-star wanted system

| Stars | Effect |
| --- | --- |
| ★ | Suspicious — guards investigate noises, wider vision |
| ★★ | Pursuit — guards chase on sight and belly-slide lunge at you |
| ★★★ | Alarm — sirens, red lights, extra laser fences power up (opening the vault always triggers this) |
| ★★★★ | Reinforcements — elite penguins arrive, security shutters start cycling |
| ★★★★★ | Lockdown — everyone knows where you are, fastest shutters |

Heat rises from being seen, cameras, the helicopter's searchlight, tripped lasers, smashing decorations, bonking
guards and grabbing big loot, and cools down when nobody has seen you for a few seconds. From the mint onwards it
can't cool below ★★, on the rooftops ★★★, and the police are waiting on the street at ★★★★.

### Scoring

Online rounds rank by escape time only (fastest wins). Practice runs keep the score system:
score = loot + time bonus ($40 per second left) + stealth bonus (max ★ reached) + health bonus.
Ranks: Bronze Bandit, Silver Swindler (35k), Golden Grinner (60k), Platinum Phantom (85k).

### Unlockable cosmetics

Outfits: Criminal Santa, Elf Robber, Snowman Robber, Ninja Santa, The Humbug (an original green robber),
Golden Santa — plus masks, hats and sacks. Each unlocks from in-game achievements (see the Customize screen).
Progress, settings, cosmetics and practice records are saved in `localStorage`; online accounts and results live
on the game server.

## Graphics settings

Low / Medium / High / Ultra change resolution scale, MSAA vs FXAA, shadow-map resolution and softness,
ground-truth ambient occlusion (High+), particle density and texture filtering. The renderer also lowers its
resolution automatically if the frame rate stays below ~45 FPS, and restores it when there is headroom.
Rendering pipeline: PBR materials with clearcoat/sheen, image-based lighting, soft PCF shadows, GTAO,
HDR bloom, neutral tone mapping.

## Project layout

```
server/
  index.ts                starts everything; config.ts reads .env
  game.ts                 servers (rooms), connections, synchronized rounds, finishes, standings
  treasury.ts             24/7 fee claiming, prize pot ledger, top-3 payouts, retries
  chain/solana.ts         pump.fun creator-fee claiming + SOL payouts (official @pump-fun/pump-sdk)
  chain/mock.ts           simulated fees and payouts for testing
  anticheat.ts            run plausibility checks
  accounts.ts, store.ts   usernames + payout wallets, JSON persistence in DATA_DIR
  http.ts                 static site, JSON API (/api/info, /api/register, /api/leaderboard…), /ws
  tools/                  bots.ts (load test), check.ts (live pre-flight)
  tests/                  npm test
src/
  main.ts                 boot: physics init, fonts, App
  App.ts                  screen flow, settings, saving, results
  online/Online.ts        online flow: register, server browser, countdown, race, results, $HEISTMAS page
  net/                    WebSocket client (clock sync, reconnect), telemetry stream, REST API, session
  shared/                 protocol + level geometry used by both the browser and the server
  core/                   Engine (renderer + post-processing + quality), Input, Audio (synth), Save, Leaderboard, math
  gfx/                    procedural textures, PBR materials, geometry + static batching, props, snow, particles, sky,
                          vehicles (getaway van, police cruiser, plow truck, helicopter)
  characters/             Bean (player rig + procedural animation), outfits, Penguin guards + vision cones
  game/                   Heist (game loop), Player controller, CameraRig, Guard AI, Wanted, Loot, objects, levels/
    escapeObjects.ts      drawers, coin presses, steam vents, bounce pads, zipline, helicopter, plow traffic
    getaway.ts            the van, police cars, tire tracks and the escape cinematic
    levels/escapeStages.ts  stages 7–10 (deposit vaults, mint, rooftops, street)
  menu/MenuScene.ts       animated 3D main menu
  ui/                     HUD, menus, minigames, icons, styles
  progress/cosmetics.ts   unlock rules
```

### Adding the next heist

`game/levels/ChristmasBank.ts` returns a `LevelData` object (spawn, checkpoints, zones/objectives, lasers,
platforms, guards, vault, getaway...). A new level only needs to build its geometry with the same kit and return
the same structure; `Heist.ts` runs it unchanged. The Select Heist screen already lists Santa's Workshop,
The Christmas Mall and The North Pole Vault as “coming soon”.

### Debug helpers (development only)

`?debug` exposes `window.__heistmas` (with `heist.debugTeleport(x, y, z)`); `?autostart` jumps straight into the
heist; `?skipintro` skips the flyover; `?quality=low|medium|high|ultra` overrides the saved preset; with `?debug`,
`&tp=x,y,z[,yaw]` teleports on start and `&dt=0.1` fixes the timestep (handy for automated tests on slow machines).
Handy teleports: deposit vaults `43.6,0,-109,1.57`, mint `76.6,0,-109,1.57`, rooftops `101.5,14,-101,1.57`,
street `190,0,-137,1.57`.

## Credits & licenses

- Code, procedural art, music and sound: original to this project.
- [three.js](https://threejs.org) (MIT), [Rapier](https://rapier.rs) (Apache-2.0),
  [Vite](https://vitejs.dev) (MIT), [TypeScript](https://www.typescriptlang.org) (Apache-2.0).
- Fonts: *Titan One* and *Fredoka* via Fontsource (SIL Open Font License 1.1).
- [@pump-fun/pump-sdk](https://www.npmjs.com/package/@pump-fun/pump-sdk) and
  [@solana/web3.js](https://github.com/solana-labs/solana-web3.js) on the server.
- Free to play: no purchase is needed to play or to win, and there is no wagering. Prizes come only from the
  coin's creator fees.
