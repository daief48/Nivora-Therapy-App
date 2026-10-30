# Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Invalid environment configuration: …` on `npm run dev` | `.env` missing or a required value empty. Copy `.env.example`; `JWT_ACCESS_SECRET` ≥ 32 chars; `DATA_ENCRYPTION_KEYS` = `id:` + 32-byte base64. |
| `Encryption key "k1" must be 32 bytes` | Generate with `node -e "console.log('k1:'+require('crypto').randomBytes(32).toString('base64'))"`. Changing/removing a key makes old data undecryptable — rotate by *prepending* a new key. |
| `P1001 can't reach database` | Start the DB (`npm run db:dev` keeps running in its own terminal) and check `DATABASE_URL` port (5433 for dev DB). |
| `initdb … 0xC0000005` (Windows) when starting the dev DB | Use the pinned `embedded-postgres@17.x` (18.x crashed on this machine) and the `--locale=C --encoding=UTF8` flags already in `scripts/dev-db.ts`. Or use any local PostgreSQL. |
| `EADDRINUSE :::4000` when starting the API | An API is already running on that port. Use it, or stop it: `Get-NetTCPConnection -LocalPort 4000` → `Stop-Process -Id <pid>`. |
| App says "AI service unavailable" and the API log shows `AI_QUOTA_EXHAUSTED` / `1113` | The provider account has no credit (or the model is not enabled for it). Top up, or use a model your plan includes. |
| Calls speak with a robotic / wrong-language voice | Natural voice is off, offline or out of credit and the phone has no Bangla voice. Turn on *Profile → Natural voice*, or install a Bangla voice in the OS text-to-speech settings. Check the API log for `TTS_*` errors. |
| `npx jest` fails with "Jest worker ran out of memory" | The machine is low on RAM. Run `npx jest --runInBand`. |
| `expo export` fails in `hermesc.exe` (exit code 2147483651) | Compiler crash under memory pressure; close heavy apps and retry. |
| Web preview signs you out on every reload | Expected: SecureStore (token storage) does not exist in browsers. |
| Chat returns `AI_NOT_CONFIGURED` | Set `OPENAI_API_KEY` (or the GLM fallback `GLM_API_KEY` + `GLM_MODEL`), restart. `AI_MISCONFIGURED` = provider rejected the key/model; `AI_REJECTED` = request rejected (check the model name; for GLM try `GLM_THINKING=default`). |
| App says "No connection to the server" | Android emulator → `http://10.0.2.2:4000`; physical device → your LAN IP in `EXPO_PUBLIC_API_URL`, firewall open for 4000, same network. Restart `expo start` after changing env (`--clear`). |
| Cleartext HTTP blocked (release Android / iOS ATS) | Use HTTPS, or for dev builds allow cleartext in app config. |
| Voice screen says recognition unavailable | Expected in Expo Go. Build a dev client: `npx expo run:android`. Also check mic permission and that the device has a speech service/language pack (Bangla `bn-BD`). |
| TTS is silent or wrong voice for Bangla | Install a Bangla voice in the OS TTS settings; the app cannot bundle voices. |
| `429 RATE_LIMITED` | Auth 10/min/IP, AI messages 20/min/user (configurable in `middleware/rateLimiter.ts`). |
| Streaming shows the full reply at once | A proxy is buffering SSE; disable buffering (`X-Accel-Buffering: no` is already sent) or compression for `text/event-stream`. |
| Backend tests hang/fail to start DB | Port 5440 busy or leftover `backend/.pgdata-test`; delete the folder and rerun `npm test`. |
| `jest-expo … @react-native/jest-preset` error | Run `npm i -D @react-native/jest-preset@0.88.0 --legacy-peer-deps` (already in `package.json`). |
