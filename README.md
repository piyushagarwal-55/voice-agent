# SalonFlow Voice Booking Assistant

A real-time Hinglish voice assistant for salon customers. A caller can ask about services and prices, find a stylist, create a customer profile, book an appointment, reschedule an existing appointment, or cancel it. Calls, transcripts, tool results, and orchestration events are persisted and visible live in the web console.

This is a portfolio and hackathon demo, not a production booking system. The calendar is deterministic mock availability, payment is not handled, and appointment identity is based on the caller's spoken phone number rather than OTP verification.

## What It Does

- Speaks natural Roman-script Hinglish by default.
- Uses Sarvam Saaras for Hindi/Hinglish speech recognition in transliteration mode.
- Uses Sarvam Bulbul for Hindi speech output.
- Uses Groq for the conversational LLM and structured reasoning.
- Looks up salon services, prices, durations, descriptions, and stylist specialties from PostgreSQL.
- Creates and finds customers by normalized phone number.
- Books only slots returned by the availability service.
- Retrieves, reschedules, and cancels only the current customer's active appointment.
- Refuses to claim success until the database tool returns successfully.
- Streams transcript, phase, tool, latency, interruption, and error events to the frontend through Redis and SSE.

## Architecture

```text
Browser microphone
    | WebRTC
    v
LiveKit Cloud
    |
    v
apps/agent
    | Silero VAD -> Sarvam STT -> Groq LLM -> Sarvam TTS
    | CallOrchestrator and phase state
    | Triage -> Booking Intake -> Booking Review -> Scheduling
    | ToolRegistry -> catalog, customer, and appointment services
    |
    +--> Supabase PostgreSQL: callers, salon catalog, bookings, appointments, transcripts, events
    +--> Upstash Redis: event stream and per-call pub/sub

apps/api
    | LiveKit token endpoint, call history, SSE event stream
    v
apps/web
    | live call console, transcript, event timeline, booking state, call history
```

The model proposes language and tool calls. `CallOrchestrator`, `ToolRegistry`, Zod schemas, and typed services decide what is allowed and what reaches PostgreSQL.

## Repository Layout

```text
apps/agent/    LiveKit worker, salon agents, policies, tools, services
apps/api/      Express API, LiveKit token minting, call history, SSE
apps/web/      Next.js live console and call history
packages/db/   Prisma schema, migrations, and salon seed data
packages/shared Shared event, phase, and tool contracts
docs/video/    Architecture and demo storyboard pages
```

## Providers

| Provider | Purpose | Environment variables |
|---|---|---|
| LiveKit Cloud | WebRTC rooms and agent jobs | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |
| Supabase | PostgreSQL database | `DATABASE_URL`, `DIRECT_URL` |
| Upstash Redis or Redis Cloud | Live event stream and SSE fan-out | `REDIS_URL` |
| Groq | Conversation and structured LLM calls | `GROQ_API_KEY`, `GROQ_BASE_URL`, `GROQ_LLM_MODEL` |
| Sarvam | Hinglish STT and Hindi TTS | `SARVAM_API_KEY`, `SARVAM_LANGUAGE`, `SARVAM_MODE`, `SARVAM_TTS_*` |

Docker is optional. The current setup uses hosted Supabase and Upstash Redis.

## Setup

Requirements: Bun 1.3 or later and access to the provider accounts above.

```powershell
cd E:\Hackathon\gideon-ai-voice
Copy-Item .env.example .env
bun install
```

Fill `.env` with provider credentials. Keep `.env` private and never commit it.

For Supabase, use the Session Pooler URL for `DATABASE_URL`. `DIRECT_URL` is used by Prisma migrations; if the direct host is unreachable on your network, the reachable pooler can be used for both in this demo.

For Redis, use the TLS URL beginning with `rediss://`.

Apply the schema and seed the salon catalog:

```powershell
bun run db:migrate
bun run db:seed
```

The seed creates these catalog entries:

- Women's Haircut: INR 800, 60 minutes
- Men's Haircut: INR 450, 45 minutes
- Beard Trim: INR 250, 30 minutes
- Haircut and Beard Combo: INR 650, 75 minutes
- Hair Spa: INR 1,200, 60 minutes
- Global Hair Color: INR 2,500, 150 minutes
- Highlights: INR 3,500, 180 minutes
- Facial: INR 1,000, 60 minutes
- Manicure: INR 600, 45 minutes
- Pedicure: INR 800, 60 minutes
- Bridal Makeup: INR 12,000, 240 minutes

## Run

```powershell
bun run dev
```

Open http://localhost:3000 and click Start Call. The API runs on port 4000 and the documentation site runs on port 3001.

The agent's normal flow is:

```text
TRIAGE -> INTAKE -> QUALIFICATION -> SCHEDULING -> CONFIRMATION -> COMPLETED
```

The qualification phase is a booking-readiness review, not a legal qualification decision.

## Example Conversations

### Price question

Caller: `Hair spa kitne ka hai?`

The agent calls `get_salon_services` and answers from the database catalog, including price and duration.

### New booking

Caller: `Mujhe men's haircut book karwana hai.`

The agent identifies the service, collects the customer's name and phone, checks returned availability, offers only returned slots, and books the exact slot selected by the caller.

### Cancellation

Caller: `Mera appointment cancel karwana hai.`

The agent keeps the cancellation intent across turns, asks for the complete registered phone number, retrieves the active appointment, confirms cancellation, and calls `cancel_appointment` only after explicit confirmation.

### Rescheduling

The agent retrieves the existing appointment first, checks new availability, and calls `reschedule_appointment` only with a slot returned by the availability tool.

## Reliability Rules

- Phone numbers are normalized to their last 10 digits for matching.
- Partial phone numbers are rejected by customer creation.
- Appointment actions are scoped to the active caller's current booking.
- Prices and stylist data must come from `get_salon_services`.
- Booking, rescheduling, and cancellation require successful tool results before confirmation.
- Appointment writes use idempotency keys.
- Tool failures become visible tool-failed events instead of uncaught model exceptions.
- Caller transcripts and events are persisted as the call runs, not only at call end.
- User interruptions cancel future speech and emit interruption events.

## Commands

```powershell
bun run dev
bun run build
bun run check-types
bun run lint
bun run db:generate
bun run db:migrate
bun run db:seed
bun run db:studio
```

`bun run --cwd apps/agent build` also works on Windows and copies policy assets into `dist/policy`.

## Documentation

- `apps/agent/src/policy/` contains salon booking, appointment, escalation, and communication rules.
- `docs/video/` contains standalone architecture and demo pages.
- `docs/video/presentation/index.html` is the presentation deck.

## Known Limitations

- Availability is deterministic mock data, not a real salon calendar.
- There is no SMS OTP or caller identity verification.
- There is no payment or deposit flow.
- Stylist preference is catalog information; availability is not yet filtered by stylist.
- The database retains legacy `Matter` naming internally even though the product language is salon booking.
- A broader automated conversation evaluation suite is still to be built.

## Security

Use synthetic data only. Secrets belong in the gitignored `.env` file and should be rotated if shared in chat or accidentally exposed. This demo does not claim payment compliance, medical compliance, or production security certification.
