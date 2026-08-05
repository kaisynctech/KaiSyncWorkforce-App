# KaiSync Workforce App

Production workforce platform for KaiSync Tech — attendance, payroll, finance, HR, client portals, and platform admin.

| Component | Path |
|-----------|------|
| **Web app (production client)** | `kaisync-web/` |
| **Supabase backend** | `supabase/` (migrations, edge functions, smoke) |
| **Marketing website** | `website/` → [kaisyncworkforce.vercel.app](https://kaisyncworkforce.vercel.app) |
| **Documentation** | `docs/` |
| **Shared .NET libs (reference / parity tests)** | `KaiFlow.Payroll/`, `KaiFlow.Finance/`, `KaiFlow.Accounting/` |

> The former .NET MAUI client (`KaiFlow.Timesheets.Maui`) has been removed. **kaisync-web** is the sole production application.

## Quick start

```powershell
cd kaisync-web
npm install
npm run dev
```

Supabase schema source of truth:

```text
supabase/migrations/
```

See [docs/README.md](docs/README.md) for architecture, deployment, and operations guides.

## License

Proprietary — © KaiSync Tech.
