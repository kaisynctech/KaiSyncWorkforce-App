# Client onboarding pack

What **you (KaiFlow operator)** prepare before go-live, and what **you send to each customer** so they can download the app and start using KaiFlow.

---

## Part 1 — Your checklist (before emailing the client)

Complete these steps first. Do not send the client pack until download links work.

### 1. Publish or distribute the app

The production app is **KaiFlow Timesheets** (`com.kaisynctech.kaiflow.timesheets`, v1.0.0).

Choose one distribution path:

| Platform | Option |
|----------|--------|
| **Windows** | MSIX/MSI installer, Microsoft Store, or direct download link |
| **Android** | Google Play or signed APK sideload |
| **iOS** | App Store or TestFlight for pilots |
| **macOS** | Mac App Store or direct build (Mac Catalyst) |

#### Direct distribution (no Play Store / App Store)

If you are **not** on public stores yet, this is the realistic split:

| Platform | Works without stores? | How |
|----------|----------------------|-----|
| **Windows** | ✅ Yes — straightforward | Zip or MSIX download from your website / Supabase Storage / Google Drive |
| **Android** | ✅ Yes — straightforward | Signed **APK**; user enables “Install unknown apps” once |
| **iPhone / iPad** | ⚠️ Limited | Apple does **not** allow simple APK-style sideloading for normal users. Best pilot path: **TestFlight** (not public App Store, but needs Apple Developer $99/yr). Without that, iOS field staff are blocked until App Store or TestFlight. |

**Recommended pilot mix (no public stores):**

1. **HR / office** → Windows installer (primary)
2. **Field Android** → signed APK link
3. **Field iPhone** → TestFlight invite link **or** ask them to use Android/Windows for the pilot phase

Build (example — Windows):

```powershell
cd KaiFlow.Timesheets.Maui
dotnet publish KaiFlow.Timesheets.Maui.csproj -f net10.0-windows10.0.19041.0 -c Release
```

Android release APK (after you create a release keystore — keep the keystore safe; you need the same one for updates):

```powershell
dotnet publish KaiFlow.Timesheets.Maui.csproj -f net10.0-android -c Release
```

iOS (Mac required + Apple Developer account for TestFlight or Ad Hoc):

```powershell
dotnet publish KaiFlow.Timesheets.Maui.csproj -f net10.0-ios -c Release
```

Upload installers to a stable HTTPS URL (your website, Supabase Storage public bucket, or a dedicated `/download` page).

**Important:** Create a **release keystore** for Android before your first client APK. If you lose it, users cannot update in place — they must uninstall and reinstall.

### 2. Register download URLs in the database

So the in-app update screen can point users to the right place:

```sql
UPDATE public.app_versions
SET
  download_url_windows = 'https://YOUR-LINK/KaiFlow-Windows-1.0.0.zip',
  download_url_android = 'https://YOUR-LINK/KaiFlow-1.0.0.apk',
  download_url_ios     = 'https://testflight.apple.com/join/YOUR_CODE',  -- TestFlight, not App Store
  download_url         = 'https://kaiflow.app/download'
WHERE version = '1.0.0';
```

### 3. Provision the tenant

Either:

- **Self-service:** Client registers in-app (HR Register flow), or
- **You create them:** Platform Console → Companies → ensure subscription is active → note their **company code**

After registration, capture and save:

| Item | Where to find it |
|------|------------------|
| Company name | Platform Console → Companies |
| **Company code** | Same (e.g. `ACME01`) — employees need this to log in |
| Owner email | Their HR sign-in email |
| Plan | KaiFlow Standard — R2,500/mo, 25 employees included |

Run **Refresh billing** in Platform Console once employees are added.

### 4. Confirm subscription is active

Platform Console → Companies → company should show **active**. Suspended companies may hit entitlement limits.

### 5. Optional: complete onboarding with them

In-app **Setup wizard** (`TenantOnboardingPage`) — available from HR dashboard banner. Walk through: company profile, first employees, modules, first punch.

---

## Part 2 — Email / document to send your client

Copy the block below. Replace placeholders in `{curly braces}`.

---

**Subject:** Welcome to KaiFlow — download & getting started

---

Hi {Client contact name},

Welcome to **KaiFlow**, your workforce management platform. This email has everything you need to install the app and get your team set up.

### What KaiFlow includes

- Attendance & time tracking  
- Jobs, projects & scheduling  
- Payroll & payslips  
- Leave management  
- Incidents, inventory, suppliers & contractors  
- Property management  
- Messaging & My PA  
- Reports & analytics  
- Finance (where included in your plan)  
- Client & contractor portals (optional)

---

### Step 1 — Download the app

Install **KaiFlow Timesheets** on the devices your team will use:

| Device | Download |
|--------|----------|
| **Windows (HR / office)** | {Windows download link} — download ZIP, extract, run `KaiFlow.Timesheets.Maui.exe` |
| **Android (field staff)** | {APK download link} — see install steps below |
| **iPhone / iPad** | {TestFlight link} — install TestFlight from App Store first, then open our invite link |

**Minimum:** Windows 10/11; Android 8+; iOS 15+ (iPhone/iPad).

#### Windows install notes

1. Download the ZIP from the link above.  
2. Extract to a folder (e.g. `C:\KaiFlow`).  
3. Run **KaiFlow Timesheets**.  
4. If Windows SmartScreen appears, choose **More info → Run anyway** (we will provide a signed installer in a future update).

#### Android install notes (APK — not Google Play)

1. Open the APK link on the phone.  
2. If prompted, allow your browser or **Files** app to **install unknown apps** (one-time).  
3. Tap **Install**.  
4. Open **KaiFlow Timesheets** from the home screen.

#### iPhone / iPad (TestFlight — not public App Store)

1. Install **TestFlight** from the App Store (Apple’s beta app — free).  
2. Open the TestFlight invite link we sent you.  
3. Tap **Accept** → **Install** KaiFlow Timesheets.  
4. Updates will arrive through TestFlight until the public App Store release.

If a link does not work, reply to this email and we will send an alternative.

---

### Step 2 — HR / manager setup (you)

1. Open the app → choose **HR / Management sign in**.  
2. **New company:** tap **Register** and complete email verification + company details.  
   **Existing company:** sign in with the email and password you registered.  
3. After sign-in you land on the **HR Dashboard**.  
4. Complete the **Setup wizard** if prompted (company details, first employees, modules).  
5. Go to **Settings** to enable the modules you need (Attendance, Payroll, Jobs, etc.).

Your company details:

| | |
|---|---|
| **Company name** | {Company name} |
| **Company code** | `{Company code}` ← share this with employees |
| **Support contact** | kaisynctech@gmail.com |

---

### Step 3 — Add your employees

1. HR Dashboard → **Employees** → **Create employee** (or **Import** for bulk).  
2. Each employee receives a **login code** (employee code).  
3. Share with each person:
   - **Company code:** `{Company code}`  
   - **Their personal login code** (from their employee profile)

Your plan includes **{25} employees** in the base subscription. Additional users are billed at **R99/month** each.

---

### Step 4 — Field staff login (employees)

Employees do **not** use your HR password.

1. Open the app → **Employee login**.  
2. Enter **company code** + **login code** (provided by HR).  
3. They can clock in/out, view jobs, leave, payslips, and messages from their dashboard.

---

### Step 5 — First day checklist

| Task | Who |
|------|-----|
| Install app on HR/manager PC | {Client contact} |
| Register or sign in | Company owner / HR admin |
| Add 2–3 test employees | HR admin |
| Test clock-in / clock-out | Employee + HR verify in Attendance |
| Enable modules in Settings | HR admin |
| Submit test feedback (Settings → Send Feedback) | Optional — confirms support channel |

---

### Optional portals

If you use external **clients** or **contractors**:

- **Client portal:** login screen → Client portal → company code + client code (created under Clients in HR).  
- **Contractor portal:** login screen → Contractor portal → company code + contractor code.

We can configure these on a setup call if needed.

---

### Support & feedback

- **Email:** kaisynctech@gmail.com  
- **In-app:** Settings → **Send Feedback** (bugs, suggestions, feature requests)

We typically respond within 1 business day.

---

### Billing (KaiFlow Standard)

| | |
|---|---|
| Base plan | R2,500 / month |
| Included | Up to 25 active employees |
| Additional employees | R99 / month each |

Invoicing and payment details will be confirmed separately. Plan changes and upgrades are handled through KaiFlow support.

---

Welcome aboard,  
**KaiSync Tech / KaiFlow**  
kaisynctech@gmail.com

---

## Part 3 — Quick reference card (attach or second page)

Print or PDF this one-pager for the client’s office.

```
┌─────────────────────────────────────────────────────────────┐
│  KAIFLOW — QUICK START                                      │
├─────────────────────────────────────────────────────────────┤
│  App name:     KaiFlow Timesheets                           │
│  HR login:     Email + password (register if new)           │
│  Employee login: Company code + personal login code         │
│                                                             │
│  Company code: ___________________                          │
│  Support:      kaisynctech@gmail.com                        │
│                                                             │
│  HR first steps:                                            │
│    1. Sign in → HR Dashboard                                │
│    2. Employees → Add staff                                 │
│    3. Settings → Enable modules                             │
│    4. Attendance → Verify punches                           │
│                                                             │
│  Employee first steps:                                      │
│    1. Employee login                                        │
│    2. Enter company code + login code                       │
│    3. Clock in from dashboard                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Part 4 — What NOT to send clients

| Do not send | Why |
|-------------|-----|
| Platform Console access | Internal KaiFlow staff only |
| Supabase credentials / anon key | Built into app; not for end users |
| `platform_admins` setup SQL | Operator-only |
| Other tenants’ company codes | Privacy / security |

---

## Part 5 — After the client is live

| Task | Where |
|------|-------|
| Monitor errors | Platform Console → Overview (error count) |
| Check health | Platform Console → Health |
| Refresh billing monthly | Platform Console → Refresh billing |
| Review feedback | Platform Console → Feedback |
| Export report | Platform Console → Reports |

See also: [06-platform-admin-smoke-test.md](./06-platform-admin-smoke-test.md)
