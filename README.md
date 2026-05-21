# XactDraft

Restoration contractors upload job files → Claude AI fills in a Xactimate estimate on a GCP Windows VM → result is pushed as a DocuSign draft envelope for human review.

## Prerequisites

Before running anything, set up accounts and credentials for:

| Service | Purpose | URL |
|---|---|---|
| Supabase | PostgreSQL database + Auth | supabase.com |
| Upstash | Redis queue + rate limiting | upstash.com |
| GCP | Cloud Storage + Compute Engine + Gmail | console.cloud.google.com |
| Anthropic | Claude computer use API | console.anthropic.com |
| DocuSign | Draft envelope creation | developers.docusign.com |
| Render | Hosting | render.com |

**GCP Windows image**: You must manually create a GCP Compute Engine image with Xactimate pre-installed before any job can run. Set `GCP_WINDOWS_IMAGE` to its resource path.

## Setup

### 1. Clone and install dependencies

```bash
git clone <your-repo>
cd xactdraft
npm run install:all
```

### 2. Configure environment variables

```bash
cp .env.example .env
# Fill in every value in .env
```

For the frontend, copy the `VITE_*` vars into `client/.env`:

```bash
cp .env.example client/.env
# Keep only the VITE_* lines
```

### 3. Run the database schema

In the Supabase SQL editor, run the contents of `server/db/schema.sql`.

### 4. GCP setup

- Create a Cloud Storage bucket and set `GCP_BUCKET_NAME`
- Enable the Compute Engine, Cloud Storage, and Gmail APIs
- Create a service account with Storage Admin + Compute Admin roles; download JSON key → `gcp-key.json`
- Create a second service account for Gmail with domain-wide delegation → `gmail-key.json`
- Set a 30-day lifecycle policy on the bucket to auto-delete files

### 5. Run locally

```bash
npm run dev
```

- Frontend: http://localhost:5173  
- Backend API: http://localhost:3000

## Project structure

```
xactdraft/
├── client/          React + Vite frontend
├── server/          Node.js + Express backend
│   ├── routes/      API route handlers
│   ├── services/    Core business logic (agent, VM, DocuSign, storage, email, queue)
│   ├── middleware/  Auth (Supabase JWT) and rate limiting (Upstash)
│   ├── workers/     Background job queue consumer
│   ├── cron/        Scheduled tasks (orphaned VM cleanup)
│   └── db/          SQL schema
└── vm-agent/        Python FastAPI agent deployed onto each Windows VM
```

## Job lifecycle

```
uploading → queued → processing → review_ready → complete
                                              ↘ failed
```

## Deployment

Push to GitHub, then connect the repo in Render and create an environment variable group named `xactdraft` with all values from `.env.example`. Render will pick up `render.yaml` automatically.
