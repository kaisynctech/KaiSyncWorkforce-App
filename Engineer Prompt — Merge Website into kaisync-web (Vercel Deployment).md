# Engineer Prompt — Merge Marketing Website into kaisync-web for Vercel

## Context

The marketing website (`website/` folder in the repo) is a plain HTML/CSS/JS site currently deployed to a Vercel project called `kaisyncwebsite`. kaisync-web is the Next.js 16 app (Tailwind v4, Supabase SSR) that has been built out through Phase 6.

The goal is to serve both under one Vercel project and one domain. The marketing pages stay as static HTML — no conversion to Next.js pages. The Next.js app lives at `/login`, `/dashboard/*`, and all authenticated routes. A **Login** button needs to be added to the marketing site navbar pointing to `/login`.

---

## Step 1 — Copy website files into kaisync-web/public/

From the repo root, copy everything inside `website/` into `kaisync-web/public/`:

```
website/index.html          → kaisync-web/public/index.html
website/about.html          → kaisync-web/public/about.html
website/features.html       → kaisync-web/public/features.html
website/pricing.html        → kaisync-web/public/pricing.html
website/contact.html        → kaisync-web/public/contact.html
website/download.html       → kaisync-web/public/download.html
website/releases.html       → kaisync-web/public/releases.html
website/styles.css          → kaisync-web/public/styles.css
website/script.js           → kaisync-web/public/script.js
website/versions.js         → kaisync-web/public/versions.js
website/config.js           → kaisync-web/public/config.js
website/robots.txt          → kaisync-web/public/robots.txt
website/sitemap.xml         → kaisync-web/public/sitemap.xml
website/assets/logo.png     → kaisync-web/public/assets/logo.png
website/assets/download.jpg → kaisync-web/public/assets/download.jpg
website/assets/b5.jpg       → kaisync-web/public/assets/b5.jpg
```

Do **not** copy `website/vercel.json` or `website/.vercel/` — kaisync-web has its own Vercel config.

---

## Step 2 — Add a Login button to all HTML pages

In every HTML file copied to `public/` (`index.html`, `about.html`, `features.html`, `pricing.html`, `contact.html`, `download.html`, `releases.html`), locate the `<ul class="nav-menu" id="navMenu">` element and add a Login link as the **last list item**, immediately before the closing `</ul>`:

```html
<li><a href="/login" class="nav-link nav-link-login">Log in</a></li>
```

Then add the following CSS to `public/styles.css` (append at the end of the file):

```css
/* Login nav button */
.nav-link-login {
  background: #1D4ED8;
  color: #fff !important;
  padding: 0.4rem 1.1rem;
  border-radius: 6px;
  font-weight: 600;
  transition: background 0.15s;
}
.nav-link-login:hover,
.nav-link-login:focus {
  background: #1E40AF;
  color: #fff !important;
}
```

---

## Step 3 — Configure vercel.json in kaisync-web

Create or replace `kaisync-web/vercel.json` with the following:

```json
{
  "cleanUrls": true,
  "rewrites": [
    { "source": "/", "destination": "/index.html" }
  ]
}
```

**Why this is needed:** Next.js app router owns the `/` route by default. The `rewrites` rule intercepts requests to `/` at the Vercel routing layer (before Next.js) and serves `public/index.html` instead — so visitors land on the marketing homepage. All other marketing pages (`/about`, `/features`, `/pricing`, etc.) are served directly from `public/` without any rewrite because Next.js has no conflicting routes for those paths. `cleanUrls: true` strips `.html` extensions so `/about.html` is also accessible as `/about`.

---

## Step 4 — Link kaisync-web to the existing kaisyncwebsite Vercel project

The existing `kaisyncwebsite` project is already linked from the `website/` folder. We need kaisync-web to deploy to that same project.

Run the following from inside `kaisync-web/`:

```bash
vercel link
```

When prompted:
- Link to existing project: **Yes**
- Which scope: your team/account
- Project name: **kaisyncwebsite**

This writes `kaisync-web/.vercel/project.json`. Commit that file.

Alternatively, if you prefer to do this without interactive prompts:

```bash
cd kaisync-web
vercel link --project kaisyncwebsite --yes
```

---

## Step 5 — Set Vercel environment variables

kaisync-web needs these environment variables set in the `kaisyncwebsite` Vercel project (Settings → Environment Variables). Add them for Production, Preview, and Development:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://vcivtjwreybaxgtdhtou.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | *(the anon key from Supabase dashboard)* |

---

## Step 6 — Deploy

From `kaisync-web/`:

```bash
vercel --prod
```

Or push to `main` if CI/CD is wired to the Vercel project.

---

## Step 7 — Update canonical URLs (post-deploy, once domain is confirmed)

After confirming the production domain (e.g. `kaisyncworkforce.com` or a custom domain), do a find-and-replace across all HTML files in `kaisync-web/public/`:

Replace `https://kaisyncworkforce.vercel.app` → `https://<your-production-domain>`

This affects the `<link rel="canonical">`, `og:url`, `og:image`, and JSON-LD `url` fields in each HTML page.

---

## Verification checklist

- [ ] `/` loads the marketing homepage (not redirected to `/login`)
- [ ] `/login` loads the Next.js login page
- [ ] `/dashboard` redirects unauthenticated users to `/login`
- [ ] `/about` (or `/about.html`) loads the About page
- [ ] `/features`, `/pricing`, `/contact`, `/download`, `/releases` all load
- [ ] Login button appears in the navbar on all marketing pages
- [ ] Clicking Login goes to `/login`
- [ ] `public/assets/logo.png` loads correctly on the marketing pages
- [ ] `script.js` hamburger menu works on mobile viewport
- [ ] `robots.txt` and `sitemap.xml` accessible at their root paths

---

## Notes

- The `website/` folder in the repo can remain as the canonical source of the marketing content — treat `kaisync-web/public/` copies as the deployed version. Alternatively, delete `website/` from the repo after the merge is confirmed working, to avoid two sources of truth.
- Do NOT use `vercel.json` rewrites to handle `/login`, `/dashboard`, or any Next.js routes — those are handled automatically by Vercel's Next.js build output.
- The `cleanUrls: true` setting also applies to Next.js pages if they generate `.html` output — this is fine and consistent.
