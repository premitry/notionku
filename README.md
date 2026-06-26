# Notion Coding Web — Cloudflare Worker (Multi-akun)

Single-file Cloudflare Worker buat "jalanin" Notion di web sendiri yang fokus koding: viewer rapi buat code block, editor buat ubah/simpan code balik ke Notion, export ke file/ZIP, search & navigasi halaman, plus panel chat AI ala ChatGPT. Autentikasi pakai **official Notion API**, support **banyak akun/token** sekaligus + mode Turbo.

## Setup (cukup 1x lewat CMD, sisanya di web)
Deploy worker-nya sekali pakai Wrangler, lalu **semua setting (token Notion, OpenAI key, model) diatur langsung dari tombol ⚙️ Pengaturan di web** — disimpan di Cloudflare KV.

### 1. Deploy (sekali aja)
```bash
# bikin KV namespace buat riwayat chat, memori, & setting:
wrangler kv namespace create CHAT
# tempel id hasilnya ke wrangler.toml, lalu:
wrangler deploy
```

### 2. Atur semuanya di web
Buka URL worker-mu -> klik **⚙️ Pengaturan** -> isi:
- **Notion Integration Tokens** (satu per baris) — ambil dari https://www.notion.so/my-integrations
- **OpenAI API Key** (opsional, buat chat AI) + Base URL + Default model
- **Workers AI Model** (opsional)

Klik **Simpan**. Selesai — nggak perlu `wrangler secret put` lagi.

> Tetap share tiap halaman Notion ke integration terkait (**...** -> **Connections**) biar kebaca. Buat Turbo: share halaman yang sama ke semua integration.

## Fitur
- Viewer & editor code block (simpan balik ke Notion via API)
- Export semua code block ke file / ZIP, plus perintah chat "zip semua code"
- Search & navigasi halaman, pin/favorit, cari teks di halaman
- Chat AI (OpenAI-compatible / Cloudflare Workers AI): streaming, stop, render markdown lengkap, opsi pilihan klik
- Riwayat chat per-sesi + URL per chat (Cloudflare KV)
- Memori jangka panjang (AI auto-inget fakta penting lintas chat)
- Lampiran file/foto/ZIP ke chat
- Setup via web (⚙️) — token & API key diatur di browser, disimpan di KV
- Multi-akun + mode Turbo, light/dark theme

## Env vars (opsional — fallback)
Masih bisa pakai secret via CMD sebagai fallback (setting dari web/KV diprioritaskan di atas env):
- `NOTION_TOKENS` / `NOTION_TOKEN_1..9` / `NOTION_TOKEN`
- `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`
- binding `AI` (Workers AI)
- KV binding `CHAT` (**wajib** — dipakai buat riwayat chat, memori, & setting)

## Catatan keamanan
Panel Pengaturan & API-nya nggak punya login. Token cuma dipakai di sisi server dan `/api/settings` cuma balikin versi ter-mask, tapi siapa pun yang tau URL worker bisa ngubah setting. Buat dipakai sendiri ini oke; kalau mau lebih aman, lindungi worker pakai Cloudflare Access.
