# Notion Coding Web — Cloudflare Worker (Multi-akun)

Single-file Cloudflare Worker buat "jalanin" Notion di web sendiri yang fokus koding: viewer rapi buat code block, editor buat ubah/simpan code balik ke Notion, export ke file/ZIP, search & navigasi halaman, plus panel chat AI ala ChatGPT. Autentikasi pakai **official Notion API**, dan support **banyak akun/token** sekaligus + mode Turbo (paralel multi-token).

## Fitur
- Viewer & editor code block (simpan balik ke Notion via API)
- Export semua code block ke file / ZIP
- Search & navigasi halaman, pin/favorit
- Chat AI (OpenAI-compatible / Cloudflare Workers AI): streaming, stop, render markdown lengkap
- Riwayat chat per-sesi + URL per chat (disimpan di Cloudflare KV)
- Memori jangka panjang (AI auto-inget fakta penting lintas chat)
- Lampiran file/foto/ZIP ke chat, perintah "zip semua code"
- Multi-akun + mode Turbo, light/dark theme

## Setup
1. Buka https://www.notion.so/my-integrations -> bikin satu integration per akun -> salin tiap Internal Integration Token.
2. Di tiap halaman yang mau diakses: **...** -> **Connections** -> tambahkan integration terkait. (Buat Turbo: share halaman yang sama ke semua integration.)
3. Set secret & deploy (lihat bawah).

## Set secrets & deploy
```bash
# beberapa token sekaligus (dipisah koma):
wrangler secret put NOTION_TOKENS   # contoh: ntn_aaa,ntn_bbb,ntn_ccc
# atau satu per satu: NOTION_TOKEN_1, NOTION_TOKEN_2, ... (NOTION_TOKEN tunggal juga didukung)

# opsional, buat chat AI (OpenAI / Groq / OpenRouter):
wrangler secret put OPENAI_API_KEY
#   OPENAI_BASE_URL  contoh: https://api.groq.com/openai/v1
#   OPENAI_MODEL     contoh: gpt-4o-mini / llama-3.3-70b-versatile

# bikin KV namespace buat riwayat chat + memori, tempel id-nya ke wrangler.toml:
wrangler kv namespace create CHAT

wrangler deploy
```

## Environment variables
- `NOTION_TOKENS` / `NOTION_TOKEN_1..9` / `NOTION_TOKEN` — token integration Notion
- `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` — chat AI (OpenAI-compatible)
- binding `AI` (opsional) — Cloudflare Workers AI sebagai ganti OpenAI eksternal
- KV binding `CHAT` — wajib buat riwayat chat & memori
