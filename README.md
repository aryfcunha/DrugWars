# DRUG WARS

A 16-bit pixel-art remake of the classic TI-83 game *Drug Wars*. Mobile-first React + Vite app with a global Supabase leaderboard. Deploys to GitHub Pages.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## Leaderboard setup (Supabase)

1. Create a Supabase project at https://supabase.com.
2. Open the **SQL Editor** and run [`supabase/schema.sql`](supabase/schema.sql).
3. Copy your project's **URL** and **anon public key** from Project Settings → API.
4. Create `.env.local`:

   ```
   VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
   ```

If these aren't set, the game still runs — the leaderboard just shows "offline".

## Deploy to GitHub Pages

1. Push this repo to `github.com/<user>/DrugWars` (or update `base` in `vite.config.ts` for a different path).
2. In repo settings → **Pages**, set **Source** to **GitHub Actions**.
3. (Optional, for leaderboard) add repo secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Push to `main`. The workflow in `.github/workflows/deploy.yml` builds and deploys.

The site will be live at `https://<user>.github.io/DrugWars/`.

## Game

- **Start:** $2000 cash, $5500 debt to the loan shark (compounds at 10%/day).
- **Goal:** maximize net worth (cash + bank − debt) before the days run out.
- **Markets:** prices for 6 drugs swing wildly between 6 NYC locations daily. Buy low, sell high.
- **Events:** cops, muggers, dealers offering fire-sale prices, paraquat, lucky finds, guns for sale.
- **The Bronx:** loan shark (pay down debt) and bank (5%/day, safe from muggers).
- **Capacity:** trench coat starts at 100 units. Find or buy bigger ones (+10 / $200).
- **Tour length:** configurable on the title screen — 15 / 30 / 60 / 90 days.

## Tech

- React 19 + TypeScript + Vite 8
- Tailwind CSS v4
- Supabase JS client
- Pixel rendering via "Press Start 2P" and "VT323"

## Credits & acknowledgments

- **Original concept:** *Drug Wars* by **John E. Dell** (1984), a text-based DOS game written for his teenage son. It went on to inspire countless ports — to BBS systems, mobile phones, and most famously, graphing calculators.
- **TI-83/84 port:** the calculator version many of us played in high-school math class was the proximate inspiration for this remake.
- **Reference source:** the TI-Basic listing in [mattmanning's gist](https://gist.github.com/mattmanning/1002653) was used to verify mechanics, price ranges, event probabilities, and the original event copy.

This is a non-commercial parody/tribute. No affiliation with John E. Dell or any rights-holders.
