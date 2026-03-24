# assistant-app

Voice-first AI assistant PWA. Record voice, get answers. No typing needed.

## Why

Works everywhere - no app store, no Telegram dependency, no blocked messengers. Just open the URL on your phone and talk.

## How It Works

```
You speak -> browser records -> server transcribes (Groq) -> AI responds (Claude) -> you read
```

1. Hold the record button on your phone
2. Speak your message
3. Release the button
4. Get a text response in seconds

## Setup

```bash
# Set API keys
export GROQ_API_KEY="your-groq-key"
export ANTHROPIC_API_KEY="your-anthropic-key"

# Start server
bun run server/server.js

# Open in browser
open http://localhost:8095
```

## Deploy

```bash
# On VPS with HTTPS (required for microphone access)
# Use nginx reverse proxy with Let's Encrypt SSL

# nginx config:
# server {
#     listen 443 ssl;
#     server_name assistant.yourdomain.com;
#     ssl_certificate /etc/letsencrypt/live/...;
#     location / {
#         proxy_pass http://localhost:8095;
#     }
# }
```

## Install as App

1. Open the URL in Chrome/Safari on your phone
2. Tap "Add to Home Screen"
3. App icon appears on your home screen
4. Opens full-screen, no browser bar

## Features

- Voice recording with hold-to-talk button
- Groq Whisper transcription (fast, accurate)
- Claude Sonnet responses
- Conversation history (per session)
- PWA: installable, works offline (cached UI)
- Mobile-first design
- No typing required

## Stack

- Frontend: vanilla HTML/CSS/JS (no framework)
- Backend: Bun.js server
- Transcription: Groq Whisper API
- AI: Anthropic Claude API
- PWA: service worker + manifest

## Related

Part of the AI agent ecosystem:
- [archlint](https://github.com/mshogin/archlint) - architecture linter
- [promptlint](https://github.com/mikeshogin/promptlint) - complexity router
- [costlint](https://github.com/mikeshogin/costlint) - cost analysis
- [seclint](https://github.com/mikeshogin/seclint) - content filter
