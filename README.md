## GoldenBoarding — Egypt Real Estate Intelligence

GoldenBoarding is a signal-driven Egypt real estate dashboard that combines:

- **Live market data** (stocks, FX, developer stats)
- **Developer IR news scraping**
- **Lead capture + admin booking management**
- **Ungated demand-generation with AI-powered intent scoring and SDR assistance**

Deployed on **Render** as a Node/Express app serving a static dashboard.

---

## 1. Running Locally

```bash
npm install
npm run dev
```

The app starts on `http://localhost:3000`.

Required local env (see `.env`):

- `PORT` — default `3000`
- `MONGODB_URI` — MongoDB Atlas connection string
- `DB_NAME` — default `golden_boarding`
- `ADMIN_USER` / `ADMIN_PASS` — admin portal credentials
- `NEWS_API_KEY` — optional, for NewsAPI.org enrichment

Optional env for advanced features:

- `OPENAI_API_KEY` — enables AI chat + AI SDR drafts
- `OPENAI_MODEL` — default `gpt-4o-mini`
- `INTENT_HOT_THRESHOLD` — integer, default `35`
- `ALERT_WEBHOOK_URL` — optional webhook for alerts (Slack/Zapier/etc.)
- `ALERT_WEBHOOK_AUTH` — optional `Authorization` header for the webhook

---

## 2. Deployment on Render (Production)

`render.yaml` is already configured:

- Type: `web`
- Runtime: `node`
- `buildCommand`: `npm install`
- `startCommand`: `npm start`

On Render, set env vars:

- **Required for persistence / auth**:
  - `MONGODB_URI`
  - `DB_NAME`
  - `ADMIN_USER`
  - `ADMIN_PASS`
- **Optional but recommended**:
  - `NEWS_API_KEY`
  - `OPENAI_API_KEY`
  - `OPENAI_MODEL`
  - `INTENT_HOT_THRESHOLD`
  - `ALERT_WEBHOOK_URL`
  - `ALERT_WEBHOOK_AUTH`

---

## 3. Ungated Demand Generation Overview

GoldenBoarding is designed for **ungated demand-generation**:

- All high-value content is **freely accessible** (no form wall).
- A **first-party intent engine** scores behavior:
  - Page/section views
  - Opportunity modal opens
  - Brochure clicks and booking flows
  - Chat messages
  - **Content consumption** (insights hub)
- Admins see **hot visitors**, their scores, and the content they consumed.
- An **AI SDR endpoint** can draft personalized outreach (Email / LinkedIn) for high-intent visitors.

Key components:

- Frontend: `index.html` + `script.js`
- Backend: `server.js`
- Admin: `admin-login.html` + `admin-dashboard.html`

---

## 4. Insights Hub — Ungated Content

The main dashboard includes an **Insights** section (`#insights`) that surfaces ungated research (no forms).

- HTML: section `id="insights"` in `index.html`
- Styling: `.insights-grid`, `.insight-card` etc. in `styles.css`
- Logic: `insights` array and handlers in `script.js`

Each insight item in `script.js` looks like:

```js
const insights = [
  {
    id: 'egypt-2026-outlook',
    tag: 'Macro',
    title: 'Egypt 2026 Real Estate Outlook',
    meta: 'Where capital is flowing across New Capital, North Coast, and East Cairo.',
    audience: 'Ideal for offshore investors and family offices.',
    readingMinutes: 6,
    bullets: [
      'How FX, inflation, and interest rates are reshaping pricing power.',
      'Which geographies are seeing genuine end-user demand vs. speculative flows.',
      'Signals that a project is institutionally interesting in 2026.'
    ]
  },
  // ...
];
```

**Important:**  
You can now publish more ungated content by just **adding entries to the `insights` array in `script.js`** (`id`, `title`, `meta`, `bullets`); **all tracking, scoring, and admin visibility will work automatically.**

When an insight is opened:

- A `content_view` event is sent to `/api/intent/event`.
- Dwell time is measured and sent as `content_dwell` when the modal is closed.

These events feed the intent-scoring engine in `server.js`.

---

## 5. Intent Scoring & Signals

The backend (`server.js`) implements a **first-party intent layer**:

- Endpoint: `POST /api/intent/event`
- Fields:
  - `visitorId` (anonymous, browser-stored id)
  - `eventType` (e.g. `page_view`, `section_view`, `modal_open`, `brochure_click`, `schedule_open`, `booking_submit`, `chat_message`, `content_view`, `content_dwell`)
  - Optional: `page`, `section`, `developer`, `project`, `contentId`, `meta`

Scoring:

- `INTENT_EVENT_POINTS` defines base weights for each event.
- `time_on_page` and `content_dwell` add **dwell-based** points.
- Profiles are stored in `intent_profiles` with:
  - `score`, `hot` flag (score ≥ `INTENT_HOT_THRESHOLD`)
  - `interestTags` including:
    - `dev:<developer>`
    - `proj:<project>`
    - `content:<contentId>`

When a visitor crosses the hot threshold, an `intent_hot` alert can be fired (see Alerts section).

---

## 6. Admin Dashboard & Hot Intent

Admin portal:

- `admin-login.html` → login via `ADMIN_USER` / `ADMIN_PASS`.
- `admin-dashboard.html` shows:
  - **Active Leads** (bookings saved to Mongo)
  - **Hot Intent** visitors:
    - Score, last interest, signal counts.
    - Recent **content** they consumed (based on `content:` tags).

From the Hot Intent view, an admin can:

- Open **Intent Details** modal.
- See the recent event trail for a visitor.
- Request **AI SDR drafts**:
  - Endpoint: `POST /api/admin/ai/draft`
  - Channels: `email` or `linkedin`
  - Uses `OPENAI_API_KEY` when present; otherwise falls back to a template.

---

## 7. AI Chat Widget (Onsite Assistant)

The public dashboard includes a bottom-right chat widget:

- Frontend: implemented in `script.js` + styled in `styles.css`.
- Backend: `POST /api/chat` in `server.js`.

Behavior:

- Stores a session-scoped chat history (per browser).
- Sends `chat_message` intent events tied to `visitorId`.
- If `OPENAI_API_KEY` is set:
  - Calls an OpenAI model (default `gpt-4o-mini`) to respond.
- If not:
  - Uses a concise, rule-based fallback answer.

---

## 8. Alerts (Webhook-Friendly)

Two main trigger types:

- `intent_hot` — a visitor’s score crosses the hot threshold.
- `booking_created` — a booking is successfully created (with `visitorId`).

Delivery:

- Persisted in Mongo collection `alerts`.
- Optional webhook to `ALERT_WEBHOOK_URL` with payload:

```json
{
  "triggerType": "intent_hot" | "booking_created",
  "timestamp": "2026-03-03T12:34:56.789Z",
  "payload": { /* visitor + booking context */ }
}
```

Admin API:

- `GET /api/admin/alerts?limit=100` — latest alerts (requires admin token).

Use this to feed Slack, CRMs, or automation tools like Zapier/Make.

---

## 9. Extending the System

- **Add more insights**:
  - Append items to the `insights` array in `script.js`.
  - Use stable `id` values; they show up as `content:<id>` tags in profiles.
- **Tune scoring**:
  - Adjust `INTENT_EVENT_POINTS` and dwell-time logic in `server.js`.
- **Add new triggers**:
  - Wire additional `sendAlert(...)` calls when specific behaviors occur (e.g., repeated visits to the same project).

