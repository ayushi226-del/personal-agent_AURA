AURA — Personal Network Agent

Hackathon Submission · Pirates of the Coral
Built with Coral · Powered by Claude (Anthropic)

AURA is a privacy-first personal networking intelligence agent. It helps you track professional connections, prioritize relationships, discover shared events, and get AI-driven networking advice — all with your data staying 100% on your local machine.

Demo

 Watch the demo video →  (replace # with your video link)
 Open live frontend (GitHub Pages) →
(Note: The frontend loads fully in the browser. Coral backend requires the one-time local setup below — takes under 2 minutes.)


What It Does
FeatureDescriptionConnection ManagerAdd, search, and filter professional contacts with field, priority, and social linksPriority RankingsRank connections as Low / Medium / High priority with dedicated colour codingShared EventsSee which events you and a connection both attendCalendarVisual monthly calendar with event names shown directly on date cellsCoral Backend SyncPulls influencers, events, and CRM records from local CSV files via SQL joinsClaude AI AssistantChat with Claude about your network — powered by the Anthropic APIProfile PanelYour personal stats dashboard visible in the header

Architecture
┌─────────────────────────────────────────────────────┐
│                    YOUR MACHINE                      │
│                                                      │
│  data/                                               │
│  ├── events.csv         ← upcoming events            │
│  ├── influencers.csv    ← key people at events       │
│  └── my_interactions.csv ← your personal CRM         │
│            │                                         │
│            ▼                                         │
│  coral serve local_source.yaml                       │
│  (SQL engine on local files · port 3000)             │
│            │                                         │
│            ▼                                         │
│  aura.html  ←→  server.js  ←→  Claude API            │
│  (frontend)     (optional)     (AI assistant)        │
└─────────────────────────────────────────────────────┘

Project Structure
personal-agent_AURA/
│
├── aura.html                        ← Main frontend (open this in browser)
├── app.css                          ← Styles
├── server.js                        ← Optional local dev server
│
├── local_source.yaml                ← Coral data source config
├── coral-x86_64-pc-windows-msvc.zip ← Coral binary for Windows (x86_64)
│
├── data/
│   ├── events.csv                   ← Upcoming events database
│   ├── influencers.csv              ← Key people / connections
│   └── my_interactions.csv          ← Personal CRM ledger
│
├── agent_system_prompt.txt          ← Claude agent system prompt
├── queries.sql                      ← Example SQL queries for Coral
├── events.csv                       ← (root-level copy, same data)
└── .gitignore

Setup for Judges — Step by Step

Estimated time: ~2 minutes
Requirements: Windows PC · Node.js (optional) · Internet connection for Claude AI


Step 1 — Clone the Repository
//bash 
git clone https://github.com/ayushi226-del/personal-agent_AURA.git
cd personal-agent_AURA

Step 2 — Set Up the Coral Backend
Coral is a lightweight local SQL engine that reads your CSV files as database tables. No installation wizard, no account needed.

2a. Extract the Coral binary
The repo includes coral-x86_64-pc-windows-msvc.zip. Extract it into the project root:
personal-agent_AURA/
├── coral.exe        ← after extracting
├── aura.html
├── local_source.yaml
...
You can extract it with:
bash
# Using PowerShell
Expand-Archive -Path coral-x86_64-pc-windows-msvc.zip -DestinationPath .
Or simply
right-click the zip → Extract Here in Windows Explorer.
2b. Start the Coral server
Open a terminal in the project root and run:
bash./coral serve local_source.yaml
You should see output like:
Coral server running on http://localhost:3000
Tables: upcoming_events, social_influencers, interaction_ledger

 Keep this terminal open. Coral must be running for the sync feature to work.


Step 3 — Open the Frontend
Simply open aura.html in your browser:
bash# Option A — double-click aura.html in File Explorer

# Option B — open from terminal
start aura.html

# Option C — if you have Node.js installed, use a local server
npx serve .
# then open  http://localhost:3000

On first load, AURA will automatically call http://localhost:3000 and sync your connections, events, and CRM data from the CSV files.


Step 4 — (Optional) Claude AI Assistant
The Claude AI chat panel is built into the app. It uses the Anthropic API which is called directly from the browser — no backend key needed on your end for the demo, as the key is embedded in the frontend for hackathon purposes.
Click the ✦ purple button (bottom-right corner) to open the AI assistant.

Test Queries (Coral SQL)
Once Coral is running, you can test it directly:
bash# Check all upcoming events
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT * FROM local_network.upcoming_events"}'

# Top influencers by score
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT full_name, influence_score, primary_industry FROM local_network.social_influencers ORDER BY influence_score DESC"}'

# Events + who is attending (JOIN)
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT e.event_name, i.full_name, i.influence_score FROM local_network.upcoming_events e JOIN local_network.social_influencers i ON e.event_id = i.attending_event_id ORDER BY i.influence_score DESC"}'
These same queries power the Sync from Coral button in the app.

Why Local-First?
This is not a limitation — it is a deliberate design decision:

Privacy — Your personal CRM, connection notes, and relationship data never leave your machine or touch a third-party server
Zero latency — Coral queries local CSV files in milliseconds; no API rate limits, no auth tokens, no Wi-Fi dependency
Reliability — The demo will never fail on stage due to an expired token or flaky endpoint
Hackathon-ready — The entire stack runs offline; only the Claude AI chat panel requires internet

Tech Stack
LayerTechnologyFrontendHTML · CSS · Vanilla JSLocal SQL EngineCoral (file backend)AI AssistantClaude Sonnet (Anthropic API)DataCSV files (events, influencers, CRM)DeploymentGitHub Pages (frontend) + local Coral (backend)

Troubleshooting
"Coral Offline" shown in the app header
→ Make sure you ran ./coral serve local_source.yaml and the terminal shows it's running on port 3000.
coral.exe not found
→ Make sure you extracted the zip into the project root folder, not a subfolder.
Page loads but no connections appear
→ Click the sync button (↺ icon) in the top header to manually trigger a Coral pull.
Claude AI panel says "Error"
→ Check your internet connection. The Claude API requires internet access.
Port 3000 already in use
→ Run coral serve local_source.yaml --port 3001 and update the CORAL_BASE constant at the top of aura.html to http://localhost:3001.

Built for Pirates of the Coral Hackathon · May 2026
