## GoldenBoarding Operator Guide

This guide explains how to operate the GoldenBoarding dashboard as a **marketer / growth lead / sales operator**, without needing to edit code.

---

## 1. Environments & Access

### Public Dashboard
- URL: your Render web service URL (e.g. `https://boarding-pro.onrender.com`)
- Use this to:
  - View live market stats, developers, news.
  - Test the **Insights** hub (ungated content).
  - Test the **chat assistant** like a visitor.

### Admin Portal
- Path: `/admin-login.html`
- Login with:
  - `ADMIN_USER`
  - `ADMIN_PASS`
- After login you are redirected to `admin-dashboard.html`.

You should only share admin credentials with trusted operators.

---

## 2. Ungated Content (Insights Hub)

The **Insights** section on the main dashboard is your **ungated demand-generation hub**:

- Every card is a research/strategy piece.
- There is **no form wall**; all content is freely readable.
- The system tracks **what is read** and **for how long** to score intent.

As an operator:

- Use this section to publish:
  - Market outlooks (Egypt 2026, Ras El Hekma, New Capital).
  - Allocation playbooks (SouthMED vs Ras El Hekma, ticket-size frameworks).
  - Institutional readiness checklists for developers/projects.
- When visitors open and spend time on these insights:
  - The backend records `content_view` and `content_dwell` events.
  - Their **intent score increases**.
  - Their profile gets tags like `content:egypt-2026-outlook`.

**Important for future use:**  
You can publish more ungated content by asking a developer to **add new entries to the `insights` array in `script.js`** with:

- `id` — stable identifier (e.g. `ras-el-hekma-guide-2026`)
- `title` — headline that will show on the card and in admin views.
- `meta` — 1-line summary shown on the card.
- `bullets` — 2–4 bullets describing what the reader will learn.

Once added, **tracking, scoring, and admin visibility work automatically**, without extra configuration.

---

## 3. Intent Scoring & “Hot” Visitors

GoldenBoarding continuously scores behavior:

- Examples of high-signal actions:
  - Opening an opportunity detail modal.
  - Clicking “Request Brochure”.
  - Opening the booking modal and submitting a booking.
  - Reading insights and staying on page.
  - Using the AI chat to ask buying-related questions.

When a visitor accumulates enough points:

- Their score crosses `INTENT_HOT_THRESHOLD` (defined by the team, default 35).
- They become **“hot intent”** and are promoted in the admin dashboard.

As an operator:

- Focus outreach and follow-ups on **hot visitors** first.
- Look at:
  - Score and how quickly it increased.
  - Which developers/projects they interacted with.
  - Which **insights** they read (content tags).

---

## 4. Admin Dashboard Workflows

### 4.1 Leads (Bookings)

In the **Active Leads** section:

- See all bookings (scheduled visits, brochure-style requests).
- Each row includes:
  - Date
  - Project & developer
  - Name + contact info
  - Type (`Scheduled Visit` or `Brochure Request`)
  - Visit date (if set)

Typical actions:

- Export to CSV for CRM import or analysis.
- Sort/filter in Excel/Sheets by project, developer, visit date, etc.

### 4.2 Hot Intent

In the **Hot Intent** section:

- Each row represents an **anonymous visitor profile**:
  - Last seen timestamp.
  - An anonymized `visitorId` (for tracking across tools).
  - Current score.
  - Last project/developer/page.
  - **Read content**: small “Read: …” line showing the last 1–2 insights.
  - Signal summary (`modal_open:x · content_view:y · …`).

Click **View** on a visitor to open the **Intent Details** modal:

- See a **timeline of events**:
  - What they did (e.g., `content_view`, `modal_open`, `booking_submit`).
  - Which developer/project/section/content each event references.
  - How recent each action was.
- Generate **AI outreach drafts**:
  - **Draft Email**: polite, concise email suggestion based on behavior.
  - **Draft LinkedIn**: shorter, DM-style outreach designed for LinkedIn.

Depending on configuration:

- If an AI key is set, drafts are **AI-generated**.
- If not, they fall back to well-written templates you can still personalize.

---

## 5. 24/7 Chat Assistant

The floating chat bubble in the bottom-right:

- Answers questions about:
  - Developers (TMG, Emaar Misr, Palm Hills, Mountain View).
  - Areas (North Coast, New Capital, East Cairo).
  - Project types, ticket sizes, and allocation ideas.
- Captures:
  - What prospects are asking about.
  - Additional **intent** via chat messages.

As an operator:

- Periodically review chat transcripts (if your technical team exposes them).
- Use common questions to:
  - Design new **insights**.
  - Refine your sales scripts and AI prompt instructions.

---

## 6. Alerts & Workflows

When configured with a webhook, the system emits alerts for:

- `intent_hot` — a visitor turns hot.
- `booking_created` — a new booking is submitted.

Your technical team can plug these into:

- Slack / Teams channels (“New hot visitor”, “New booking + hot intent”).
- CRM automation (HubSpot/Pipedrive lead creation).
- Email/SMS notifications to sales reps.

As an operator:

- Define **playbooks** for these alerts:
  - What to do when a new hot visitor appears (e.g., research, prepare outreach).
  - How quickly to respond to a `booking_created` alert.

---

## 7. When to Involve Developers

You’ll need a developer when you want to:

- Add **new insights** (they will edit `script.js` and maybe `styles.css`).
- Change the **intent scoring weights** (they will edit `server.js`).
- Add new **alert types** or change alert payloads.
- Integrate webhooks with external tools (Slack, CRM, Zapier/Make).

You do **not** need a developer to:

- View/administer leads and hot visitors.
- Export CSVs.
- Use AI drafts.
- Decide which insights to promote and how to act on the signals.

