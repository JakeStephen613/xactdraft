# 🏗️ XactDraft

> **Agentic AI workflow for construction billing — from job file to DocuSign draft in one pipeline.**

[![JavaScript](https://img.shields.io/badge/JavaScript-87.9%25-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](https://github.com/JakeStephen613/xactdraft)
[![Python](https://img.shields.io/badge/Python-5.1%25-3776AB?style=flat-square&logo=python&logoColor=white)](https://github.com/JakeStephen613/xactdraft)
[![Deployed on Render](https://img.shields.io/badge/Deployed-Render-46E3B7?style=flat-square&logo=render&logoColor=white)](https://render.com)
[![GCP](https://img.shields.io/badge/GCP-Windows_VM-4285F4?style=flat-square&logo=google-cloud&logoColor=white)](https://cloud.google.com)

---

## Overview

XactDraft automates one of the most tedious workflows in property restoration: generating Xactimate estimates. Xactimate is the industry-standard (and notoriously clunky) desktop software that insurance adjusters and contractors use to price out repair jobs. Traditionally, a contractor manually opens the software, reads through job documentation, and types in line items — a process that can take hours per claim.

XactDraft eliminates that. A restoration contractor uploads their job files through a web client. Claude AI reads the documentation, reasons about the scope of work, and operates a real Xactimate instance running inside a GCP Windows VM — filling in the estimate automatically. The completed draft is then pushed to DocuSign as an envelope for human review and sign-off before submission.

---

## How It Works

```
Contractor uploads job files
        │
        ▼
  [Client] Web interface
        │
        ▼
  [Server] Node.js API
   • Parses and stores job files
   • Orchestrates the agent
        │
        ▼
  [VM Agent] Claude AI on GCP Windows VM
   • Reads job documentation
   • Opens and operates Xactimate desktop app
   • Fills in line items, quantities, and costs
        │
        ▼
  DocuSign API
   • Creates draft envelope
   • Routes to contractor for review
```

---

## Architecture

| Layer | Stack | Role |
|---|---|---|
| **Client** | JavaScript | Web UI for file upload and status tracking |
| **Server** | Node.js, PLpgSQL | API, job queue, database |
| **VM Agent** | Python, Claude AI | Agentic estimation inside GCP Windows VM |
| **External** | DocuSign API, Xactimate | Output delivery and estimation software |
| **Infra** | GCP, Render | Cloud VM + server hosting |

---

## Tech Stack

- **Claude AI** — reads job files and drives the Xactimate UI autonomously
- **Google Cloud Platform** — Windows VM running the Xactimate desktop application
- **Node.js / Express** — REST API and job orchestration server
- **PostgreSQL** — job storage and state management
- **DocuSign API** — final envelope creation and delivery
- **Render** — server deployment (`render.yaml` included)

---

## Key Features

- **Zero manual data entry** — the agent reads, reasons, and types, just like a human would
- **Real software operation** — not an API wrapper; Claude actually uses the Xactimate desktop GUI
- **Human-in-the-loop** — every estimate goes to DocuSign as a *draft*, keeping a contractor in the review loop before any submission
- **Full-stack pipeline** — client upload → server orchestration → VM agent → DocuSign, all connected

---

## Project Structure

```
xactdraft/
├── client/          # Web frontend for job upload
├── server/          # Node.js API + PostgreSQL integration
├── vm-agent/        # Python agent that runs on the GCP VM
├── render.yaml      # Render deployment config
└── package.json
```

---

## Why This Matters

Xactimate estimates are the bottleneck in thousands of property claims every year. Getting this wrong — or slow — costs contractors money and delays homeowner repairs. XactDraft shows how agentic AI can operate real legacy software (not just APIs) to automate workflows that were previously considered impossible to automate.
