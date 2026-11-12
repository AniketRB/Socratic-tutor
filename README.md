# Socratic Tutor (Gemini edition)

A zero-dependency Node app (Node 18+) around the `socratic-tutor` skill (SKILL.md), powered by Gemini.

## Run locally
    node server.js        # or: npm start, start.sh (Mac/Linux), start.bat (Windows)
Opens http://localhost:3000. "Watch demo" works without any key.

## Get a Gemini API key
1. Go to https://aistudio.google.com/apikey and sign in with a Google account.
2. Accept the terms. New users get a default project; if you already use Google Cloud, import your project first.
3. Click "Create API key" and copy it. Never commit it to Git or post it publicly.
4. AI Studio shows whether your key is on a free tier or needs billing. Limits change, so check there.
Then click "API key" in the app, paste it, and press "Save and test". It is stored only in your browser.

## Deploy (Render, about 5 minutes)
1. Push this folder to a GitHub repository (the .gitignore already excludes .env).
2. On render.com: New > Web Service > connect the repo. Runtime: Node. Build command: leave empty or `echo ok`. Start command: `node server.js`.
   (Or use New > Blueprint, which reads render.yaml.)
3. Choose one mode:
   - Bring-your-own-key (recommended for public sites): add no environment variables. Each visitor pastes their own key.
   - Shared key: set GEMINI_API_KEY. Visitors without their own key are limited per IP (RATE_LIMIT_PER_HOUR, default 40).
4. Open the URL Render gives you. Free instances may sleep when idle, so the first load can be slow.
Any host that runs Node or Docker works the same way (Railway, Fly.io, a VPS): a Dockerfile is included, and the app reads PORT and serves /healthz.

## Notes
- Visitor keys are sent with each request to this server and forwarded to Google; they are never stored server-side.
- Sessions are saved in the visitor's browser (localStorage), not on the server.
- Edit SKILL.md to change tutor behavior; set MODEL to change the Gemini model.
