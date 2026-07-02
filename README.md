# Notion Coding Web — Cloudflare Worker (Multi-akun)

Single-file Cloudflare Worker buat "jalanin" Notion di web sendiri yang fokus koding: viewer rapi buat code block, editor buat ubah/simpan code balik ke Notion, export ke file/ZIP, search & navigasi halaman, plus panel chat AI ala ChatGPT. Autentikasi pakai **official Notion API**, support **banyak akun/token** sekaligus + mode Turbo.

---

## 🚀 Install langsung dari GitHub (paling gampang, tanpa CMD)

Cukup **fork** repo ini, lalu biarin **GitHub Actions** yang nge-deploy otomatis ke Cloudflare tiap ada push. Nggak perlu install Wrangler atau buka terminal.

### 1. Fork repo ini
Klik tombol **Fork** di kanan atas halaman repo GitHub ini → repo ke-copy ke akun kamu.

### 2. Bikin KV namespace di Cloudflare (sekali aja)
Dashboard Cloudflare → **Workers & Pages → KV → Create a namespace** (kasih nama bebas, mis. `CHAT`) → salin **Namespace ID**-nya.

Lalu edit `wrangler.toml` di repo hasil fork, ganti `ISI_NAMESPACE_ID_KAMU` dengan ID tadi, terus commit. Bisa langsung dari web GitHub: buka file → ikon ✏️ **Edit** → **Commit changes**.

### 3. Bikin `.github/workflows/deploy.yml`
Di repo hasil fork, bikin file baru di path **`.github/workflows/deploy.yml`** (klik **Add file → Create new file**, ketik path-nya, tempel isi di bawah, commit):

```yaml
name: Deploy to Cloudflare Workers

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Deploy
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: __API_TOKEN__
          accountId: __ACCOUNT_ID__
```

**Ganti `__API_TOKEN__` dan `__ACCOUNT_ID__`** dengan ekspresi secret GitHub Actions standar (format yang biasa dipakai: tanda dolar diikuti sepasang kurung kurawal ganda):
- `apiToken` → isinya: tanda dolar `$`, lalu buka kurung kurawal ganda, teks `secrets.CLOUDFLARE_API_TOKEN`, lalu tutup kurung kurawal ganda.
- `accountId` → sama persis, tapi pakai teks `secrets.CLOUDFLARE_ACCOUNT_ID`.

Ini format standar GitHub Actions buat manggil secret (bisa dicontek dari repo Actions mana pun). Hasil akhir dua baris itu, misalnya baris `apiToken`, jadi: `$` + kurung-ganda-buka + `secrets.CLOUDFLARE_API_TOKEN` + kurung-ganda-tutup.

> File ini nggak bisa ditambahin otomatis lewat integrasi (butuh izin `workflow`), jadi tambahin manual sekali ini aja.

### 4. Set 2 secret di repo GitHub
Di repo hasil fork → **Settings → Secrets and variables → Actions → New repository secret**, tambahin:
- **`CLOUDFLARE_API_TOKEN`** — bikin di Cloudflare → **My Profile → API Tokens → Create Token → template "Edit Cloudflare Workers"**.
- **`CLOUDFLARE_ACCOUNT_ID`** — ada di dashboard Cloudflare (di sidebar Workers & Pages, atau di URL dashboard).

### 5. Deploy otomatis
Setiap push ke branch `main` bakal nge-trigger deploy otomatis. Mau deploy manual? Buka tab **Actions → Deploy to Cloudflare Workers → Run workflow**.

> Kalau tab **Actions** ke-disable di repo hasil fork, buka **Settings → Actions → General** → izinkan workflow jalan.

### 6. Atur token & API key di web
Buka URL worker-mu → klik **⚙️ Pengaturan** → isi token Notion & API key (lihat bagian di bawah). Selesai — nggak perlu CMD sama sekali.

---

## 💻 Alternatif: deploy manual lewat CMD
Kalau lebih suka deploy dari komputer sendiri pakai Wrangler:

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
- Riwayat chat per-sesi + URL per chat (Cloudflare KV), lazy-load + infinite scroll
- Memori jangka panjang (AI auto-inget fakta penting lintas chat)
- Lampiran file/foto/ZIP ke chat + OCR gambar (ekstrak teks dari foto)
- Response cache (jawaban sama di-cache 24 jam) + antrean request + auto-reconnect kalau koneksi putus
- Integrasi GitHub: browse repo, edit, commit langsung dari web
- Setup via web (⚙️) — token & API key diatur di browser, disimpan di KV
- Multi-akun + mode Turbo, light/dark theme, mobile-friendly

## Env vars (opsional — fallback)
Masih bisa pakai secret via CMD sebagai fallback (setting dari web/KV diprioritaskan di atas env):
- `NOTION_TOKENS` / `NOTION_TOKEN_1..9` / `NOTION_TOKEN`
- `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`
- binding `AI` (Workers AI)
- KV binding `CHAT` (**wajib** — dipakai buat riwayat chat, memori, & setting)

## Catatan keamanan
Panel Pengaturan & API-nya nggak punya login. Token cuma dipakai di sisi server dan `/api/settings` cuma balikin versi ter-mask, tapi siapa pun yang tau URL worker bisa ngubah setting. Buat dipakai sendiri ini oke; kalau mau lebih aman, lindungi worker pakai Cloudflare Access.
