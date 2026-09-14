# SalonFlow Demo Documentation

This folder contains the architecture story and recording material for the current SalonFlow Hinglish voice booking assistant.

## Read in This Order

1. `02-master-architecture.html` - end-to-end system map
2. `03-voice-under-the-hood.html` - VAD, Sarvam STT, Groq, and Sarvam TTS
3. `04-speech-models.html` - why the pipeline is cascaded
4. `05-orchestration.html` - phase control and safe tool execution
5. `06-context-engineering.html` - salon context and anti-hallucination rules
6. `07-data-pipeline.html` - catalog, customer, appointment, transcript, and event persistence
7. `08-latency.html` - turn latency and interruption behavior
8. `09-interruptions.html` - barge-in and cancellation of future speech
9. `presentation/index.html` - presentation deck

All pages are standalone HTML and can be opened directly in a browser. No documentation server is required.

## Recommended Demo

1. Open the web app at `http://localhost:3000`.
2. Start a call and ask in Roman Hinglish: `Hair spa kitne ka hai?`
3. Ask for a men's haircut appointment.
4. Give a name and phone number.
5. Select one returned availability slot.
6. Start a second call using the same phone number.
7. Say: `Mera appointment cancel karwana hai.`
8. Confirm the appointment and show the cancellation event in the timeline.

## What the Demo Proves

- Voice media is handled by LiveKit.
- Sarvam receives Hindi speech and returns transliterated Roman-script text.
- Groq chooses conversational responses and tools.
- Sarvam Bulbul produces Hindi speech.
- Prices and service descriptions come from the PostgreSQL catalog.
- Appointment actions are validated and persisted through typed tools.
- Redis carries live events to the API, which forwards them to the browser through SSE.
- The agent does not claim a booking, reschedule, or cancellation until the database tool succeeds.

## Honest Limitations

- Availability is deterministic mock availability.
- There is no SMS OTP verification.
- Stylist preference is recorded as catalog context but does not yet filter availability.
- Payment, deposits, reminders, and real calendar integration are not implemented.
- The dashboard still has some legacy intake-oriented data labels because the database schema retains legacy `Matter` naming.
