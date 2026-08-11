# Client Onboarding Pack

What **you (KaiFlow operator)** do before go-live, and what **you send to each client** so their team can start using KaiFlow.

---

## Part 1 — Your checklist (before contacting the client)

Complete these steps first. Do not send the client email until you have confirmed the platform is live and the tenant is active.

### 1. Confirm the platform is accessible

Open **[https://www.kaisyncworkforce.com](https://www.kaisyncworkforce.com)** in a browser and verify the sign-in screen loads. No installation is required — KaiFlow is a web application that works in any modern browser on any device.

### 2. Provision the tenant

Either let the client self-register, or create them yourself:

**Self-registration:** Client opens `kaisyncworkforce.com` → clicks **Register** → completes company details + email verification.

**You create them:** Platform Console → Companies → New company → confirm subscription is active → note the **company code** (e.g. `ACME01`).

After registration capture:

| Item | Where |
|------|-------|
| Company name | Platform Console → Companies |
| **Company code** | Same — employees and workers need this to log in |
| Owner email | Their HR sign-in address |
| Plan | KaiFlow Standard — R2,500/mo, 25 employees included |

### 3. Confirm subscription is active

Platform Console → Companies → the company row should show **active**. Run **Refresh billing** after employees are added.

### 4. Enable modules for the tenant

In the HR dashboard → **Settings** → enable the modules this client needs (Attendance, Payroll, Jobs, Leave, Finance, etc.). Unused modules stay hidden from their sidebar.

---

## Part 2 — Email to send the client

Copy the block below. Replace `{placeholders}`.

---

**Subject:** Welcome to KaiFlow — getting started

---

Hi {Contact name},

Welcome to **KaiFlow**, your workforce management platform. Everything runs in your web browser — no software to install.

### Access the platform

Open **[https://www.kaisyncworkforce.com](https://www.kaisyncworkforce.com)** on any device. Works on Chrome, Edge, Safari, and Firefox. On a phone or tablet, use your browser's **Add to Home Screen** option for a full-screen app experience.

---

### What's included in your plan

- Attendance & time tracking (clock in/out with GPS)
- Jobs & projects management
- Scheduling & shift templates
- Leave management & approvals
- Payroll, payslips & SARS tax tables
- Finance (invoices, approvals, supplier invoices)
- Incidents & compliance
- Inventory & suppliers
- Contractors & contractor portal
- Property management
- Messaging & My PA (personal assistant tasks)
- Reports & analytics
- Client portal (optional — for your own clients)
- Xero integration (sync contacts + push payroll journals)

---

### Step 1 — HR / manager sign-in

1. Go to [https://www.kaisyncworkforce.com](https://www.kaisyncworkforce.com)
2. Choose **HR / Management**
3. **New company:** click **Register** and follow the email verification steps
   **Returning:** enter your email and password
4. You land on the **HR Dashboard**
5. Go to **Settings** → enable the modules your team will use

Your company details:

| | |
|---|---|
| **Company name** | {Company name} |
| **Company code** | `{Company code}` — share this with your employees |
| **Support** | kaisynctech@gmail.com |

---

### Step 2 — Add your employees

HR Dashboard → **Employees** → **New Employee** (or **Import** for bulk upload via spreadsheet).

Each employee gets a personal **login code**. Share two things with each person:
- **Company code:** `{Company code}`
- **Their login code** (visible in their employee profile)

Your plan includes **25 employees**. Additional employees are billed at **R99/month** each.

---

### Step 3 — Employee login

Employees do not use your HR password. Their login is:

1. Go to [https://www.kaisyncworkforce.com](https://www.kaisyncworkforce.com)
2. Choose **Employee login**
3. Enter the **company code** and their **personal login code**
4. They land on their employee dashboard — clock in/out, view jobs, leave, payslips, messaging, and more

Employees can bookmark the page or add it to their phone's home screen for quick access.

---

### Step 4 — First day checklist

| Task | Who |
|------|-----|
| Sign in to HR dashboard | You |
| Enable modules in Settings | You |
| Add 2–3 test employees | You |
| Share company code + login codes | You → employees |
| Test clock-in / clock-out | Employee — you verify in Attendance |
| Submit test feedback | Optional (Settings → Send Feedback) |

---

### Optional portals

**Client portal** — give your own clients visibility into their projects and invoices:
- Client goes to `kaisyncworkforce.com` → **Client Portal**
- Enters your **company code** + their **client code** (you create this under HR → Clients)

**Contractor portal** — your field contractors log jobs, submit quotes, and upload documents:
- Contractor goes to `kaisyncworkforce.com` → **Contractor Portal**
- Enters your **company code** + their **contractor code** (you create this under HR → Contractors)

We can set these up on a call if needed.

---

### Xero integration (if applicable)

Connect your Xero account from **Settings → Integrations → Connect Xero**. Once connected you can push contacts and sync approved payroll journals directly to Xero as Draft Manual Journals.

---

### Support

- **Email:** kaisynctech@gmail.com
- **In-platform:** Settings → **Send Feedback**

We respond within 1 business day.

---

### Billing

| | |
|---|---|
| Base plan | R2,500 / month |
| Included | Up to 25 active employees |
| Additional employees | R99 / month each |

Payment details confirmed separately. Plan changes handled through KaiFlow support.

---

Welcome aboard,
**KaiSync Tech / KaiFlow**
kaisynctech@gmail.com

---

## Part 3 — Quick reference card

Print or PDF this for the client's office.

```
┌─────────────────────────────────────────────────────────────┐
│  KAIFLOW — QUICK START                                      │
├─────────────────────────────────────────────────────────────┤
│  Platform:     https://www.kaisyncworkforce.com             │
│  Browser:      Chrome / Edge / Safari / Firefox             │
│                                                             │
│  HR login:     HR / Management → email + password           │
│  Employee:     Employee login → company code + login code   │
│                                                             │
│  Company code: ___________________                          │
│  Support:      kaisynctech@gmail.com                        │
│                                                             │
│  HR first steps:                                            │
│    1. Sign in → HR Dashboard                                │
│    2. Settings → enable modules                             │
│    3. Employees → add staff + share login codes             │
│    4. Attendance → verify punches                           │
│                                                             │
│  Employee first steps:                                      │
│    1. Go to kaisyncworkforce.com                            │
│    2. Employee login → company code + login code            │
│    3. Clock in from your dashboard                          │
│                                                             │
│  Mobile tip: Add to Home Screen for full-screen access      │
└─────────────────────────────────────────────────────────────┘
```

---

## Part 4 — What NOT to send clients

| Do not send | Why |
|-------------|-----|
| Platform Console access | Internal KaiFlow operator only |
| Supabase credentials or anon key | Backend infrastructure — not for clients |
| Other tenants' company codes | Privacy and security |
| Your HR password | Each user has their own credentials |

---

## Part 5 — After the client is live

| Task | Where |
|------|-------|
| Monitor errors | Platform Console → Overview |
| Refresh billing | Platform Console → Companies → Refresh billing |
| Review feedback | Platform Console → Feedback |
| Suspend / unsuspend tenant | Platform Console → Companies |

---

## Part 6 — Device & browser notes

KaiFlow works on any device with a modern browser. No installation is required.

| Device | Recommended browser | Notes |
|--------|--------------------|-|
| Windows PC / laptop | Chrome or Edge | Full HR dashboard experience |
| Mac | Chrome or Safari | Full HR dashboard experience |
| Android phone/tablet | Chrome | Add to Home Screen for app feel |
| iPhone / iPad | Safari | Add to Home Screen for full-screen mode |

**Add to Home Screen (mobile):**
- **iPhone/iPad (Safari):** tap the Share icon → Add to Home Screen
- **Android (Chrome):** tap the three-dot menu → Add to Home Screen

The platform is fully responsive — employees can clock in, view jobs, and manage leave from any phone.
