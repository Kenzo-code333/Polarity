# POLARITY

**A multiplayer magnetic knockout brawler for the browser.**
Every player is a living magnet on a floating hex platform in space. **Pull**, **Push** and **Anchor** to knock everyone else into the void. Free-for-all, 2–12 players, all skill and no randomness.

Runs in any modern browser (Chromebooks and phones included). Keyboard and touch controls. One Node.js app serves both the game server and the client, so you can deploy it for free.

---

## How to play

| Action | Keyboard | Touch |
|---|---|---|
| Move | `WASD` / arrow keys | Left-side joystick (appears where your thumb lands) |
| **Pull** (blue): attracts nearby players and debris | hold `Space` | hold **PULL** |
| **Push** (red): repels nearby players and debris | hold `Shift` | hold **PUSH** |
| **Anchor** (white): heavy and immune to fields | hold `E` | hold **ANCHOR** |
| **Surge**: 3× pulse in your current state | `Q` (when the meter is full) | **SURGE** (glows when ready) |
| Settings / leave | `Esc` | ☰ button |
| Mute | `M` | 🔊 button |
| Network/performance overlay | `F3` | |

**Rules of magnetism**
- Pull vs Pull: both of you crash together. Push vs Push: both of you fly apart. **Push beats Pull**: the pusher stays put and the puller gets thrown.
- Anchor ignores all fields, and attackers bounce off you. It's slow and drains energy fast.
- Every state drains **energy**, which only recharges in Neutral. Switching state has a 0.3 s cooldown and a **0.2 s glow tell** in the new color, so you can read and bait your opponents.
- **Collisions are momentum based**: the faster disc wins and the slower one is launched.
- **Pylons**: pull to grapple onto one; activate push next to one to dash away.
- **Debris**: push blocks into enemies as projectiles, or pull them in front of you as a shield.
- **Edge save**: after you're knocked off, you drift for about 1 s. Pull toward a pylon or a nearby player to save yourself, and maybe drag them down with you.
- **Surge** charges from hits, near misses, KOs and saves.
- **Ghosts**: knocked-out players float above the arena and can pulse every 8 s to nudge players for revenge KOs.
- Every 20 s the outer ring of tiles cracks (3 s warning) and falls away.

**Modes:** Free-for-all (5 rounds, most KOs wins), King of the Pole (touch the central pole to score; 2 minutes), and Practice vs bots (Easy / Normal / Hard). There's also a 30-second interactive tutorial on the home screen.

---

## Deploy for free on Render (step by step)

You only need a browser. Everything is done on the GitHub and Render websites.

1. **Get the code onto GitHub.** If this repository is already on your GitHub account, skip ahead. Otherwise create a new repository on github.com and upload these files (or fork this repo).
2. Go to **https://render.com** and sign up with your GitHub account (free).
3. In the Render dashboard click **New +** → **Web Service**.
4. Choose **Build and deploy from a Git repository**, then **Connect** your Polarity repository. You may need to click "Configure account" to give Render access to it.
5. Fill in the form:
   - **Name:** `polarity` (or anything; it becomes part of your URL)
   - **Region:** the one closest to you and your friends (lower ping)
   - **Branch:** `main` (or whichever branch has the code)
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** `Free`
6. Click **Create Web Service** and wait a minute or two for the log to say `Polarity server running`.
7. Open the URL Render gives you (like `https://polarity-xxxx.onrender.com`). That's your game.
8. **Play with friends:** click **Create game**, then **Copy invite link**, and send the link to your friends. Opening the link joins your lobby directly. They can also type the 4-letter room code into **Join**.

Notes about the free plan:
- A free Render service **goes to sleep after ~15 minutes with nobody connected**. The first visit afterwards takes ~30–60 s to wake up. Open the page a minute before you play.
- WebSockets work out of the box on Render. You don't need to configure anything.
- Every push to your GitHub branch redeploys automatically.

A `render.yaml` blueprint is included too. On Render you can choose **New + → Blueprint**, pick the repo, and it fills in the settings above for you.

---

## Run it in Claude Code on the web / GitHub Codespaces / any cloud dev box

1. Open a terminal in the repository folder.
2. Install the dependencies once:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. The server listens on port **3000** (or `$PORT` if set). Open the forwarded port in your browser:
   - **Codespaces:** a "Port 3000 is available" popup appears; click **Open in Browser**. To let friends join, open the **Ports** tab, right-click port 3000 → **Port Visibility → Public**, and share that URL.
   - **Claude Code on the web / other cloud IDEs:** use the environment's port preview for port 3000.
   - **Local machine:** http://localhost:3000

Extra commands:
```bash
npm run simulate        # headless bot-only matches: checks for crashes and measures tick cost
```
Add `?lag=150` to the URL (e.g. `http://localhost:3000/?lag=150`) to simulate 150 ms of latency and test how the netcode feels.

---

## Tech overview

- **Server:** Node.js + Express + Socket.IO. The server is **authoritative**: it runs the physics at a fixed **60 ticks/s** and sends compact snapshots **20×/s**. Clients only send inputs. Inputs are validated, rate limited and consumed at most one per tick, so speed hacks are impossible.
- **Client:** PixiJS 7 (WebGL) + pixi-filters, plain ES modules with **no build step**. The libraries are served straight from `node_modules`.
- **Netcode:** client-side prediction for your own disc using the *same* shared physics code, smooth reconciliation (errors fade out instead of snapping), entity interpolation for everyone else ~100 ms behind the snapshot stream, clock sync and adaptive jitter buffering. Rendering runs at the display's full refresh rate, decoupled from the network.
- **Graphics:** everything is drawn procedurally at startup (no image files): parallax starfield, drifting nebulae, shooting stars, metallic hex tiles with depth and glowing edges, thousands of iron filings that align to the magnetic fields in real time (GPU particle container), animated field lines, 8 skins with animated cores, trails, squash & stretch, shockwave distortion, a custom low-resolution bloom, screen shake, hit-stop and a slow-mo final-KO cam.
- **Audio:** 100% procedural Web Audio: magnetic hums, impacts, crackling tiles, falls, the Surge boom and an adaptive synth music loop that intensifies as the arena shrinks.
- **Performance:** Low / Medium / High presets plus **Auto**, which measures frame times and steps quality down to hold 60 fps on slow Chromebooks.

```
shared/      code used by BOTH server and browser
  constants.js   tuning numbers, skins, colors
  physics.js     per-player physics (also used for client prediction)
  sim.js         the authoritative round simulation (fields, collisions, KOs, collapse…)
  arenas.js      hex arena layouts      hex.js  hex math
  bot.js         bot AI (easy / normal / hard)
server/
  index.js       HTTP + Socket.IO server, room registry, fixed-rate loop
  room.js        lobby, match flow, inputs, snapshots, awards
client/
  index.html, css/style.css
  js/main.js     app controller: screens, events → effects/audio/UI
  js/net.js      socket + clock sync          js/session.js  prediction & interpolation
  js/input.js    keyboard + touch             js/audio.js    procedural sound & music
  js/ui.js       DOM screens & HUD            js/tutorial.js interactive tutorial
  js/settings.js quality presets & saved settings
  js/render/     scene, textures, background, arena, filings, fieldlines, players, effects, bloom
tools/simulate.js  headless full-match simulator
```

License: MIT
