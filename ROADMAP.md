# Friday — roadmap

Friday is Pookie's personal voice assistant: talk to it on the laptop or the phone,
and it answers out loud in the Friday persona (see `friday-prompt.md`).
Everything runs on free, local pieces already on this laptop.

## How it fits together

```
 Phone / laptop browser  ──►  Friday server (this folder, Node, port 4321)
   mic → speech-to-text            │
   (browser built-in)              ├─► FreeLLMAPI  localhost:31415  (the brain: free models)
                                   └─► FreeLLMAPI  /v1/audio/speech (the voice: Gemini)
   speaker ◄── audio ◄─────────────────────┘
```

## Phase 1 — Talk to Friday on the laptop (building now)
- Web page with one big mic button and a typing box as backup.
- Speech-to-text: the browser's built-in recogniser (Chrome / Edge / Android Chrome / iPhone Safari), English and Hindi.
- Brain: FreeLLMAPI chat with the Friday prompt and the last few turns of the conversation.
- Voice: FreeLLMAPI's Gemini voice. (VoiceStudio was removed on 2026-11-07.)
- Memory of rules: when Pookie says "from now on…", Friday saves it to `memory/rules.json` and follows it in every later chat. Newest rule wins.
- Done when: Pookie presses the mic, says "Friday, what's up?", and hears a short spoken answer.

## Phase 2 — Same Friday on the phone
- Make the page installable as an app (home-screen icon).
- Phones only allow the mic on secure (https) pages, so the laptop needs a secure link.
  Free options: Tailscale (private, needs a free account on laptop + phone) or a Cloudflare quick tunnel (no account, public link, so Friday gets a passcode).
- Laptop must be on and Friday running; the phone just talks to it.

## Phase 2b — Friday on WhatsApp (built 2026-11-13, waiting on Meta setup)
- Permanent address: https://nakshay.tail727f7e.ts.net (Tailscale Funnel), so Meta's webhook never needs re-pasting.
- `/webhook/whatsapp` in `server.js`: checks Meta's signature, answers only numbers in `WHATSAPP_ALLOWED`, reads text and voice notes (voice notes go through FreeLLMAPI speech-to-text), replies as text.
- Stops at 900 replies a month (Meta gives 1,000 free service replies per number per month; messages to Friday are free).
- Still to do by Pookie at developers.facebook.com: create the app, add the test number, then paste the token, phone number ID, app secret and her own number into `.env`; set the webhook to the address above plus `/webhook/whatsapp` with the verify token from `.env`.

## Phase 3 — Friday knows her day (built 2026-11-14, waiting on the Composio key)
- Built in `server.js`: "what is my day" briefing (today's calendar + unread mail), inbox, mail search, calendar for today / tomorrow / week, add a calendar event, draft an email.
- Emails go out only after Pookie's own "yes" / "send it" in her last message (checked in code, not left to the model). Text inside emails can never trigger an action.
- Friday also saves lasting facts about Pookie to `memory/facts.json` (this part works already).
- Connection: Composio's MCP address with `COMPOSIO_KEY` in `.env` (the x-consumer-api-key from the Composio dashboard). Gmail is connected there; Google Calendar still needs connecting.
- Not built yet: reminders, a morning message on WhatsApp (needs the Meta setup).

## Phase 4 — Maps and memory
- "Mind map of X": a visual map shown on screen (centre topic, 4–6 branches).
- "Map of me": a living map of goals, projects, people, deadlines; flags what is being neglected.

## Phase 5 — Nice to have
- Wake word ("Hey Friday") without pressing a button.
- A nicer or custom Friday voice (free options: Kokoro or Piper).
- Eve report explainer (plain-words summary, risks, never buy/sell advice).

## Rules that never change
- Never sends a message without Pookie's yes.
- Never deletes, buys or moves money.
- API keys live only in `.env` on this laptop, never in chat or memory files.
