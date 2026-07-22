# Engineer Prompt — Fix kaisyncworkforce.com/login 404

## Problem

`kaisyncworkforce.com/login` is returning a Vercel 404 NOT_FOUND. This means either the build failed, the deployment didn't target the correct Vercel project, or the deployment was never promoted to production. Environment variables have been added to the Vercel project.

---

## Step 1 — Check what's actually deployed

Go to **Vercel dashboard → kaisyncwebsite → Deployments**.

- Does the latest deployment show ✓ Ready or ✗ Error?
- Is the latest deployment marked **Production** (not just Preview)?

If it shows Error, copy the full build log and share it.

---

## Step 2 — Trigger a fresh production deployment

Environment variables added after a build do not automatically redeploy. Run this from inside `kaisync-web/`:

```bash
vercel --prod
```

Watch the output carefully. It should end with a line like:
```
✅  Production: https://kaisyncworkforce.com [copied to clipboard]
```

If it ends with an error instead, paste the full output.

---

## Step 3 — Verify the project link is correct

From inside `kaisync-web/`, check:

```bash
cat .vercel/project.json
```

It should show:
```json
{
  "projectId": "...",
  "orgId": "...",
  "settings": {}
}
```

Then confirm the `projectId` matches the `kaisyncwebsite` project in the Vercel dashboard (Settings → General → Project ID).

If it's pointing to the wrong project, re-link:

```bash
vercel link --project kaisyncwebsite --yes
vercel --prod
```

---

## Step 4 — If the build is failing due to missing env vars

Even though env vars are set in Vercel, the Next.js build may still fail if they aren't available at build time. Check that `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set for the **Production** environment (not just Preview or Development) in Vercel dashboard → kaisyncwebsite → Settings → Environment Variables.

After confirming, re-run:

```bash
vercel --prod
```

---

## Expected result

After a successful deployment:
- `kaisyncworkforce.com` loads the marketing homepage
- `kaisyncworkforce.com/login` loads the Next.js login page (no 404)
- `kaisyncworkforce.com/about` loads the About marketing page
