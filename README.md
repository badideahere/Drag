# STAGED — a browser drag racing simulator

A complete, playable drag racing game that runs in a web browser. The front end
is plain HTML, CSS and JavaScript hosted free on **GitHub Pages**. The back end
is **Supabase** — accounts, cloud saves, money, leaderboards and the admin
panel. There is no server to rent and nothing to install on a machine that stays
switched on.

This README assumes you are on **Windows** and have **never used Supabase
before**. Every step is spelled out. Follow it top to bottom and you will have
the game running on the internet.

---

## Contents

1. [What the game actually is](#1-what-the-game-actually-is)
2. [Folder structure](#2-folder-structure)
3. [What you need before you start](#3-what-you-need-before-you-start)
4. [Create the Supabase project](#4-create-the-supabase-project)
5. [Create the database tables](#5-create-the-database-tables)
6. [Turn on email and password accounts](#6-turn-on-email-and-password-accounts)
7. [Install the Supabase CLI and deploy the Edge Functions](#7-install-the-supabase-cli-and-deploy-the-edge-functions)
8. [Add the server-side secrets](#8-add-the-server-side-secrets)
9. [Put your keys into the game](#9-put-your-keys-into-the-game)
10. [Test it on your own PC first](#10-test-it-on-your-own-pc-first)
11. [Upload to GitHub and turn on Pages](#11-upload-to-github-and-turn-on-pages)
12. [Create the first account and make yourself OWNER](#12-create-the-first-account-and-make-yourself-owner)
13. [Using the admin panel](#13-using-the-admin-panel)
14. [How to play](#14-how-to-play)
15. [Adding a car](#15-adding-a-car)
16. [Adding an upgrade](#16-adding-an-upgrade)
17. [Adding car artwork](#17-adding-car-artwork)
18. [How the security works](#18-how-the-security-works)
19. [Troubleshooting](#19-troubleshooting)

---

## 1. What the game actually is

You create an account, get a cheap starter car and $7,500, and go drag racing.

The simulation models the whole driveline rather than faking acceleration:
throttle position feeds a real torque curve, torque goes through the clutch into
the gearbox, through the final drive and differential to the wheels, and the
tyres decide how much of it becomes acceleration and how much becomes
wheelspin, heat and smoke. Engine rpm while the clutch is locked comes from
wheel speed backwards through the gears, which is why selecting second at
110 mph really does drag the engine past the rev limiter and really does cost
you an engine.

Things you can do:

- Burn the tyres in to heat them, then stage and launch on the amber.
- Drive in **Arcade** (auto clutch and gears), **Manual** (you shift), or
  **Realistic** (throttle, brake, clutch and gears — you can stall it).
- Bog a launch, smoke a clutch, miss a shift, money-shift, overheat an engine.
- Race **Test**, **Quick Race**, **Heads-Up**, **Bracket** (with dial-ins),
  **Tournament**, and **Free Run**, over 1/8 mile, 1000 ft, 1/4 mile or a
  custom distance, on a real Christmas tree with reaction times, 60 ft, 330 ft
  and trap speeds, and a printed timeslip afterwards.
- Tune final drive, every individual gear, tyre pressures, launch and shift
  rpm, boost target, clutch engagement and throttle mapping.
- Buy upgrades that genuinely change the simulation — a camshaft moves the
  torque curve, forged internals raise the rpm the engine survives, a bigger
  turbo changes spool and lag.
- Break things, pay to fix them, earn money, buy more cars, climb leaderboards.

Everything is saved in the cloud. Log in on another computer and your garage,
money, damage and best times are all there.

---

## 2. Folder structure

```
index.html            Landing page
login.html            Sign in (also handles password resets)
register.html         Create account
garage.html           Garage, dealership, leaderboards, settings
game.html             The race itself
profile.html          Your stats and race history
admin.html            Admin dashboard (desktop; permission-checked server-side)
README.md             This file

css/
  main.css            Palette, typography, shared components
  game.css            The race screen
  admin.css           The admin dashboard

js/
  config.js           >>> THE ONLY FILE YOU MUST EDIT <<<

  sim/                The simulation. No DOM, no network.
    util.js           Units, maths, seeded random
    engine.js         Torque curves, rpm, boost, heat, over-rev damage
    tires.js          Grip, slip, temperature, pressure, wear, smoke
    drivetrain.js     Clutch, gearbox, differential
    vehicle.js        The integrator that ties it all together
    build.js          Applies upgrades and tuning; the dyno sweep

  data/
    cars.js           The eight vehicles
    upgrades.js       Every upgrade and what it changes

  game/               Things you can see and hear
    main.js           The race page controller and game loop
    race.js           Staging, the tree, timing, the timeslip
    driver.js         Auto clutch/shifter, traction help, the AI drivers
    render.js         Track, parallax, environments, the tree
    carart.js         Draws the cars (procedural when a PNG is missing)
    particles.js      Smoke, sparks, debris
    hud.js            Tachometer, gauges, telemetry
    audio.js          All sound, synthesised at runtime
    input.js          Rebindable keyboard and gamepad

  net/
    supabase.js       The Supabase client
    auth.js           Register, log in, log out, reset password
    api.js            Every call to the backend

  ui/
    common.js         Toasts, modals, header, loading, button guards
    garage.js         The garage page
    upgrades.js       The upgrade shop
    tuning.js         The tuning bench
    dyno.js           The dyno graph
    leaderboard.js    The leaderboards
    profile.js        The profile page
    authpages.js      Login and registration logic
    settings.js       Local preferences

  admin/
    admin.js          The admin panel

supabase/
  migrations/
    001_schema.sql        Tables, indexes, security rules   (run first)
    002_seed.sql          Cars and upgrades                 (run second)
    002_seed_refresh.sql  Re-runnable version of the above
  functions/              Server code. This is where money is handled.
    _shared/              CORS, auth, permissions, audit log, tuning limits
    buy-car/  buy-upgrade/  save-tuning/  repair-car/  submit-race/
    admin-money/  admin-vehicle/  admin-moderate/  admin-query/

tools/
  generate-seed.mjs   Regenerates 002_seed.sql from the game data files

assets/
  cars/               Optional car PNGs (the game works without them)
  audio/              Intentionally empty — all audio is synthesised
```

---

## 3. What you need before you start

- A **web browser** (Chrome, Edge or Firefox).
- A **GitHub account** — free, at <https://github.com>.
- A **Supabase account** — free, at <https://supabase.com>.
- **Node.js** — free, at <https://nodejs.org>. Take the "LTS" download and
  click Next through the installer. You only need this for the Supabase CLI in
  section 7 and for regenerating seed data if you add cars.

You do **not** need a paid server, a domain name, or a machine that stays on.

---

## 4. Create the Supabase project

1. Go to <https://supabase.com> and click **Start your project**. Sign in with
   GitHub or with an email address.
2. Click **New project**.
3. Fill in:
   - **Name** — anything, e.g. `staged-drag`.
   - **Database Password** — click Generate, then **copy it into a text file
     and keep it**. You will not be shown it again. (You will not need it for
     this game, but losing it makes some future admin tasks harder.)
   - **Region** — pick the one closest to you.
4. Click **Create new project** and wait a minute or two while it sets up.
5. When it is ready, open **Project Settings** (the gear icon, bottom left),
   then **API**. You need two values from this page:

   | On the page | Looks like | You will use it as |
   |---|---|---|
   | **Project URL** | `https://abcdefgh.supabase.co` | `SUPABASE_URL` |
   | **Publishable key** (older projects: **anon public**) | `sb_publishable_…` or `eyJ…` | `SUPABASE_PUBLISHABLE_KEY` |

   Copy both into your text file.

   > On the same page there is a **service_role** / **secret** key. **That one
   > is dangerous.** It bypasses every security rule in the database. It goes in
   > exactly one place — Supabase's own Edge Function secrets, in section 8 —
   > and it must never go into `js/config.js`, into GitHub, or into anything a
   > browser downloads. If you ever paste it somewhere public, go straight back
   > to this page and click the button to roll it.

---

## 5. Create the database tables

1. In the Supabase sidebar, click **SQL Editor**.
2. Click **New query**.
3. Open `supabase/migrations/001_schema.sql` from this project in Notepad
   (or any text editor). Select all of it, copy it, and paste it into the
   Supabase SQL editor.
4. Click **Run**. It should say *Success. No rows returned.*
5. Click **New query** again.
6. Open `supabase/migrations/002_seed.sql`, copy all of it, paste it in, and
   click **Run**. This inserts the eight cars and all the upgrades with their
   prices.
7. Check it worked: click **Table Editor** in the sidebar. You should see
   `car_definitions` with 8 rows and `upgrade_definitions` with 45.

> If you ever change car or upgrade prices later, run
> `002_seed_refresh.sql` instead — it updates the existing rows rather than
> failing because they already exist.

---

## 6. Turn on email and password accounts

1. In the sidebar, click **Authentication**, then **Providers**.
2. **Email** should already be enabled. If it is not, switch it on.
3. While you are testing, it is much less annoying to turn **Confirm email**
   *off*, so accounts work immediately without checking an inbox. It is under
   Authentication → Providers → Email, or Authentication → Sign In / Providers
   depending on your dashboard version. Turn it back on before you let other
   people play.
4. Go to **Authentication → URL Configuration** and set:
   - **Site URL**: where the game will live. For GitHub Pages that is
     `https://YOURNAME.github.io/REPOSITORY` (you will know the exact address
     after section 11 — you can come back and fix it).
   - **Redirect URLs**: add both of these, one per line:
     ```
     https://YOURNAME.github.io/REPOSITORY/login.html
     http://localhost:8080/login.html
     ```
   These are what make the "forgot password" email link come back to your game
   instead of nowhere.

---

## 7. Install the Supabase CLI and deploy the Edge Functions

The Edge Functions are the server-side code that handles money. They are the
reason a player cannot edit the JavaScript in their browser and give themselves
a million dollars. They have to be uploaded to Supabase.

**Install the CLI.** Open **PowerShell** (press Start, type `powershell`,
press Enter) and run:

```powershell
npm install -g supabase
```

Check it worked:

```powershell
supabase --version
```

> If PowerShell says running scripts is disabled, run
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, answer `Y`, and try
> again. If `npm` is not recognised, Node.js is not installed — go back to
> section 3.

**Log in and link the project.** In PowerShell:

```powershell
supabase login
```

That opens a browser window; approve it.

Now find your **project ref**. It is the random-looking part of your project
URL: in `https://abcdefgh.supabase.co`, the ref is `abcdefgh`. It is also shown
in Project Settings → General.

Change into this project's folder (adjust the path to wherever you unzipped it):

```powershell
cd C:\Users\YourName\Downloads\staged
supabase link --project-ref abcdefgh
```

**Deploy all nine functions.** Still in that folder:

```powershell
supabase functions deploy buy-car
supabase functions deploy buy-upgrade
supabase functions deploy save-tuning
supabase functions deploy repair-car
supabase functions deploy submit-race
supabase functions deploy admin-money
supabase functions deploy admin-vehicle
supabase functions deploy admin-moderate
supabase functions deploy admin-query
```

Check them: Supabase sidebar → **Edge Functions**. All nine should be listed.

> **No CLI, no problem.** You can also create each function by hand in the
> dashboard: Edge Functions → Deploy a new function → name it exactly as above
> → paste in the contents of that function's `index.ts`. The catch is the
> `_shared` folder — the dashboard editor lets you add extra files, so create
> `_shared/cors.ts`, `_shared/common.ts` and `_shared/tuning.ts` inside each
> function that needs them. The CLI is genuinely much less work.

---

## 8. Add the server-side secrets

The functions need the **service_role** key to do their job. This is the only
place it ever goes.

1. Supabase sidebar → **Edge Functions** → **Secrets**
   (on some versions: Project Settings → Edge Functions → Secrets).
2. Add these:

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | your Project URL, e.g. `https://abcdefgh.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | the **service_role / secret** key from Project Settings → API |
   | `SITE_ORIGIN` | `https://YOURNAME.github.io` (add `,http://localhost:8080` too if you want to test locally) |

   Some Supabase projects provide `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` to functions automatically. Setting them
   explicitly does no harm and avoids a confusing failure if yours does not.

3. Save. If you deployed the functions before adding the secrets, redeploy one
   of them so it picks them up.

`SITE_ORIGIN` controls which websites are allowed to call your backend. Leaving
it blank still works — it falls back to allowing any origin — but setting it is
better.

---

## 9. Put your keys into the game

Open **`js/config.js`** in Notepad and replace the three placeholders:

```js
SUPABASE_URL: 'https://abcdefgh.supabase.co',
SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_xxxxxxxxxxxxxxxxxxxx',
SITE_ORIGIN: 'https://YOURNAME.github.io/REPOSITORY',
```

Save the file.

Both of those keys are **meant to be public** — they ship to every browser that
loads the game and that is fine, because the database security rules mean they
cannot be used to read or change anyone else's data. The one that must stay
secret is the service_role key, and it is not in this file.

---

## 10. Test it on your own PC first

The game uses JavaScript modules, which browsers refuse to load from a plain
`file:///` path. Double-clicking `index.html` will show a blank page. You need
to serve the folder over `http://` — which takes one command and does not
install anything permanent.

Open PowerShell in the project folder and run:

```powershell
npx serve -l 8080
```

Answer `y` if it asks to install. Then open <http://localhost:8080> in your
browser.

Alternatives if you prefer:

- **Python** (if installed): `python -m http.server 8080`
- **VS Code**: install the *Live Server* extension, right-click `index.html`,
  Open with Live Server.

For local testing, temporarily set `SITE_ORIGIN` in `js/config.js` to
`http://localhost:8080`, and make sure that address is in your Supabase
redirect URLs (section 6). Change it back before you deploy.

Press **Ctrl+C** in PowerShell to stop the server. Nothing is left running.

---

## 11. Upload to GitHub and turn on Pages

1. Go to <https://github.com> and click the **+** in the top right →
   **New repository**.
2. Give it a name, e.g. `staged`. Set it to **Public** (GitHub Pages needs
   public on a free account). Do **not** tick "Add a README". Click
   **Create repository**.
3. On the empty repository page, click **uploading an existing file**.
4. Open the project folder in File Explorer, select **everything inside it**
   (Ctrl+A), and drag it all into the browser window. Make sure the folders
   `css`, `js`, `supabase` and `assets` come with it — GitHub keeps the folder
   structure when you drag folders.
5. Wait for all the files to finish uploading, then click **Commit changes**.
6. Click the **Settings** tab of the repository.
7. In the left sidebar, click **Pages**.
8. Under **Build and deployment** → **Source**, choose **Deploy from a
   branch**. Under **Branch**, choose **main** and folder **/ (root)**. Click
   **Save**.
9. Wait a minute or two, then refresh the Settings → Pages screen. It will show
   your address:

   ```
   https://YOURNAME.github.io/staged/
   ```

10. Go back to `js/config.js` **on GitHub** (click the file, then the pencil
    icon) and make sure `SITE_ORIGIN` is that exact address, without the
    trailing slash. Commit the change.
11. Go back to Supabase → Authentication → URL Configuration and set the Site
    URL and Redirect URLs to match (section 6).

Now open your address. You should see the landing page.

---

## 12. Create the first account and make yourself OWNER

There is deliberately **no button anywhere in the game that makes you an
admin**. If there were, everyone could press it. The very first OWNER has to be
set by hand in the database, which only you can reach.

1. Open your game and click **Create account**. Register normally with your own
   email and password.
2. Confirm it worked: you should land in the garage with a Corso 1.8 Sport and
   $7,500.
3. Go to Supabase → **SQL Editor** → **New query**, and paste this, replacing
   the email with the one you just registered:

   ```sql
   update public.profiles
   set role = 'OWNER'
   where lower(email) = lower('you@example.com');
   ```

4. Click **Run**. It should report 1 row updated.
5. Go back to the game and **refresh the page**. An **Admin** button now appears
   in the header. Click it, or go to `admin.html` directly.

To promote someone else later you can either do it from the admin panel
(Players → find them → Moderation → Role), or run the same SQL with their
email.

**Sanity check that security is actually on:** sign in with a second, ordinary
account and open `admin.html` directly. You should see "Admin permission
denied". That is the server refusing, not the page hiding — the same refusal
happens if someone calls the backend directly with their own script.

---

## 13. Using the admin panel

`admin.html`, for MODERATOR, ADMIN and OWNER accounts. Every action is checked
on the server and written to an audit log that cannot be edited from the panel.

**Roles**

| | MODERATOR | ADMIN | OWNER |
|---|---|---|---|
| View players, stats, race results | ✅ | ✅ | ✅ |
| View audit log | ✅ | ✅ | ✅ |
| Suspend / unsuspend accounts | ✅ | ✅ | ✅ |
| Give / remove / set money | ❌ | ✅ | ✅ |
| Give / repair / reset / remove vehicles | ❌ | ✅ | ✅ |
| Economy overview | ❌ | ✅ | ✅ |
| Change someone's role | ❌ | ❌ | ✅ |

Nobody can act on an account with a rank equal to or above their own, so a
MODERATOR cannot ban an ADMIN.

**Sections**

- **Dashboard** — total players, active players in the last 7 days, races run,
  money in circulation, vehicles owned, suspended accounts, plus the ten most
  recent admin actions.
- **Players** — type at least two characters to search by driver name, email or
  user ID. The search runs as a query in the database with a limit; it does not
  download the user table. Click **Manage** for the full account: balance,
  stats, vehicles, race history and every tool you have permission for.
- **Economy** — total and average balances, race payouts over the last 7 days,
  how much admins have issued all-time, and the ten wealthiest accounts.
- **Vehicles** — find a player, then give, repair, reset (strips upgrades and
  tuning back to stock) or remove a vehicle. Removing asks you to type `DELETE`.
- **Race Results** — the last 100 runs across all players. Anything the server
  flagged as implausible is highlighted.
- **Audit Log** — every privileged action: who did it, to whom, what type, how
  much, which vehicle, the reason and the timestamp.

**Money tools** give you $100 / $1,000 / $10,000 / $100,000 buttons plus a
custom amount, and ADD / REMOVE / SET. Anything of $10,000 or more makes you
type `CONFIRM`. Every change is logged with your user ID.

---

## 14. How to play

**Controls** (all rebindable in Garage → Settings → Controls):

| Key | Action |
|---|---|
| `W` / `↑` | Throttle |
| `S` / `↓` | Brake |
| `A` / `←` | Clutch |
| `Space` | Shift up |
| `Q` | Shift down |
| `1`–`7` | Select that gear directly |
| `R` / `N` | Reverse / Neutral |
| `B` | Line lock — hold with brake and throttle for a burnout |
| `E` | Starter (if you stall it) |
| `L` | Launch control |
| `T` | Advanced telemetry |
| `Y` | Reset the run |
| `P` / `Esc` | Pause |

An Xbox-style controller works too: right trigger throttle, left trigger brake,
left stick clutch, bumpers to shift.

**A run, start to finish**

1. Pick a car and a race mode, then **Go to the line**. You start in the
   burnout box behind the beams.
2. Hold **B** with the brake and the throttle to spin the tyres and heat them.
   Warm tyres grip much better than cold ones — watch the TIRE bar in the
   temperature panel go from blue into the green band. Do not overdo it:
   overheated tyres lose grip again, and the clutch and engine gain heat too.
3. Release and roll forward. The top two small bulbs on the tree light as you
   pre-stage and stage. Stop with both lit.
4. The ambers come down. On a **Pro Tree** all three light at once and green is
   0.400 s later; on a **Sportsman Tree** they step down 0.500 s apart.
5. Leave on the last amber, not the green — the clock starts when you roll out
   of the stage beam, so a perfect light is 0.000 and anything negative is a red
   light and a loss.
6. Shift when the shift light bar fills. In Realistic mode, lift, clutch,
   shift, clutch out. Rushing it gives you a missed shift.
7. Cross the stripe and read the timeslip: reaction, 60 ft, 330 ft, 1/8 ET and
   MPH, 1000 ft, 1/4 ET and MPH.

**Things that will cost you money**

- **Money shift** — grabbing a much lower gear at speed. The wheels force the
  engine past the limiter, the limiter cannot save you, and the damage scales
  with how far over you went. A small over-rev is a warning; a big one is a
  new engine.
- **Riding the clutch** — slipping it heats it, heat wears it, a worn clutch
  holds less torque and slips more. You can smoke one completely in about
  twelve seconds if you try.
- **Sitting on the limiter** at full throttle, cooking the engine.
- **Dumping the clutch at high rpm**, which shocks the driveline and stresses
  the gearbox.

Damage stays on the car until you pay to repair it, and it costs more the worse
it is.

---

## 15. Adding a car

Every car is a data entry. You never touch the physics engine to add one.

1. Open `js/data/cars.js` and copy an existing entry that is roughly similar to
   what you want.
2. Change the `id` to something new and unique (lower case, underscores), and
   fill in the rest: name, class, `priceCents`, mass, drivetrain, the torque
   curve (an array of `[rpm, Nm]` pairs), the gear ratios, final drive, clutch,
   differential and tyres.
3. Give it an `art` block. If you have no PNG, pick a `silhouette` from
   `hatch`, `coupe`, `sedan`, `muscle`, `supercar`, `prostreet` and choose paint
   colours — the game will draw it.
4. Regenerate the server's copy of the prices and specs. In PowerShell, in the
   project folder:

   ```powershell
   node tools/generate-seed.mjs
   ```

5. Open the newly written `supabase/migrations/002_seed_refresh.sql`, copy it
   into the Supabase SQL Editor and **Run** it.

Step 4 and 5 matter. The dealership shows prices from `cars.js`, but the server
charges the price in the database — if you skip them, the new car will not be
buyable and existing prices will not change.

---

## 16. Adding an upgrade

1. Open `js/data/upgrades.js`. Either add a new level to an existing slot or a
   whole new slot.
2. Each level needs a `name`, a `priceCents` and an `effects` object. The full
   list of effect keys the simulation understands is documented in a comment at
   the top of that file — things like `torqueHighMult`, `revDelta`,
   `massDelta`, `clutchType`, `installTurbo`, `tireCompound`.
3. If you add a genuinely new effect key, teach `buildVehicleSpec()` in
   `js/sim/build.js` what to do with it. An effect key nothing reads does
   nothing.
4. Run `node tools/generate-seed.mjs` and run
   `002_seed_refresh.sql` in the SQL editor, exactly as in section 15.

---

## 17. Adding car artwork

See **`assets/cars/README.md`**. It has the file naming rules, the wheel
alignment settings, the full art brief and a ready-to-use prompt for each of
the eight cars.

The short version: save a transparent PNG named after the car's id, e.g.
`assets/cars/vector_350.png`, then check the `art.wheels` numbers in
`js/data/cars.js` line up. The game works without any of them.

---

## 18. How the security works

Worth understanding, because it is the part people get wrong.

**The browser is never trusted.** Everything in `js/` is downloaded to the
player's computer, where they can read it, edit it and run whatever they like
instead. So the rules are enforced somewhere they cannot reach.

**The database refuses client writes.** Row Level Security is on for every
table, and there is not a single INSERT, UPDATE or DELETE policy for normal
users anywhere in `001_schema.sql`. A player can read their own profile, their
own cars and the public leaderboards. That is all. An attempt to write to
`profiles.money_cents` from the browser fails at the database, not at a
JavaScript check.

**Money moves only inside Edge Functions.** Those run on Supabase's servers
with the service_role key, which the player never sees. When you buy a car, the
request contains one thing — which car. The function looks up the price
*itself*, checks your balance *itself*, and debits you. Sending
`{ carId: 'prowler_ps', price: 0 }` gets you charged full retail.

**Race rewards are calculated server-side.** The client reports what happened;
`submit-race` decides what it was worth. There is no payout field in the
request. The function also sanity-checks the result: splits must be in order,
elapsed time and trap speed have to agree with each other, and the ET has to be
achievable by that car with every upgrade in the game fitted. Impossible
results are rejected and recorded. Merely unusual ones are flagged but paid,
because honest players get odd timeslips from dropped frames and nobody should
lose a race for alt-tabbing.

**Damage can only get worse through the race endpoint.** Health values sent
with a result are accepted only in the direction of more damage, so you cannot
repair a car for free by claiming a perfect run.

**Admin permissions are re-read from the database on every request.** Not from
the token, not from the request body, not from a header, and certainly not from
a hidden button. `admin.html` hides controls you cannot use purely so the
interface is not full of buttons that will refuse — hiding them protects
nothing and is not what stops anybody.

**The audit log is not client-reachable.** `admin_actions` has RLS enabled and
no policies at all, which denies every browser including an OWNER's. The admin
panel reads it through an Edge Function that checks the caller's role first.

**The first OWNER is set by hand in SQL.** There is no self-promotion button,
no `?admin=true`, no localStorage flag.

**Where the secret key lives:** Supabase Edge Function secrets, and nowhere
else. Not in `config.js`, not in GitHub, not in any file a browser downloads.

---

## 19. Troubleshooting

**The page is blank and the browser console mentions modules or CORS.**
You opened the file directly with `file:///`. Serve the folder over http —
section 10.

**"This copy of the game has not been connected to a Supabase project yet."**
`js/config.js` still has the placeholder text in it. Section 9.

**"Unable to connect to the server."**
Usually the Edge Functions are not deployed (section 7), or `SITE_ORIGIN` does
not match the address you are actually using. Open the browser console (F12) —
a CORS error names the origin it objected to.

**I registered but the garage is empty / "You do not have a car yet".**
The signup trigger did not run, almost always because `002_seed.sql` was never
run so there was no starter car to give. Run it (section 5), then in the SQL
editor:

```sql
insert into public.player_cars (player_id, car_id, is_starter)
select id, 'corso_hatch', true from public.profiles
where id not in (select player_id from public.player_cars);
```

**Registration fails with "Database error saving new user".**
`001_schema.sql` was not run, or only partly ran. Run it again — it is written
to be safe to re-run.

**I never get the confirmation email.**
Supabase's built-in email sender is rate-limited and sometimes slow. For your
own testing, turn off "Confirm email" (section 6). For real players, connect
your own SMTP provider under Authentication → Emails.

**The password reset link goes to the wrong place.**
Authentication → URL Configuration. Both the Site URL and the Redirect URLs
must include your real address plus `/login.html`.

**"Admin permission denied" when I am supposed to be OWNER.**
Check the role actually saved:

```sql
select id, username, email, role from public.profiles;
```

If it says PLAYER, the update in section 12 did not match your email. Then
log out and back in — the page reads your role when it loads.

**"Race result rejected by the server."**
The result failed a plausibility check. If it happens on a normal run, the most
likely cause is the car's stock `hp` and `weight_kg` in `car_definitions` being
out of step with `cars.js` after you edited something — re-run
`node tools/generate-seed.mjs` and `002_seed_refresh.sql`.

**The game runs slowly.**
Garage → Settings → Graphics: drop Quality and Particles, and turn on Reduced
Effects. The simulation itself is cheap; the particles and the higher device
pixel ratio are what cost frames.

**There is no sound.**
Browsers block audio until you interact with the page. Click anywhere or press
a key. Then check the volume sliders in Settings or the pause menu.

**I changed a price and nothing happened.**
Prices displayed come from `js/data/cars.js`; prices charged come from the
database. Run `node tools/generate-seed.mjs`, then run
`002_seed_refresh.sql` in the SQL editor.
