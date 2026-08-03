In `supabase/functions/xero-oauth-start/index.ts`, find the line that sets the OAuth scope and change it to:

```
accounting.contacts accounting.manualjournals offline_access openid profile email
```

Then redeploy:
```
supabase functions deploy xero-oauth-start --project-ref vcivtjwreybaxgtdhtou
```
