# RunChunk — Roadmap Pelaksanaan (8 Minggu)

Fokus: **vertical slice**. Setiap fase menghasilkan demo yang jalan end-to-end,
bukan layer terpisah. Kalau waktu mepet, yang dipotong adalah item Stretch,
bukan keamanan (RLS, SSRF, quota, redaksi log).

Rujukan: `PRD.md` (scope), `ARCHITECTURE.md` (desain teknis), `DESIGN.md` + `tokens.json` (visual).

---

## Timeline

```
Minggu 1-2: Fondasi + vertical slice (Manual → HTTP → hasil tersimpan)
Minggu 3-4: Control node, Vault, Realtime
Minggu 5-6: Webhook async, Schedule, visual Jalur, quota
Minggu 7-8: Polish, Code node (flag), AI opsional, deploy
```

---

## Minggu 1–2: Fondasi + Vertical Slice

**Tujuan:** satu workflow linear jalan end-to-end, bisa di-demo ke dosen.

- [ ] Init repo: Next.js App Router, TypeScript, Tailwind, Supabase client
- [ ] Setup `next-intl`: `messages/id.json` + `messages/en.json` dengan key yang sama sejak awal (terjemahan EN boleh menyusul, key tidak)
- [ ] Token desain dari `docs/tokens.json` → CSS variables (dark default + light), termasuk jalur L1–L6 light dari `DESIGN.md`
- [ ] Supabase: Auth email/password, trigger pembuatan `profiles`, tabel `workflows`, `executions`, `execution_logs`
- [ ] RLS semua tabel + uji akses silang akun A/B
- [ ] Canvas React Flow: palette, drag, connect, drawer konfigurasi, save
- [ ] Validasi graph di server: satu trigger, tanpa cycle, edge valid
- [ ] Node: `trigger.manual`, `action.http`, `output.response`
- [ ] **Proteksi SSRF di `action.http`** (bareng node-nya, bukan belakangan): tolak localhost/private/link-local/metadata IP, validasi DNS + tiap redirect, timeout, batas ukuran response
- [ ] Inngest Dev Server + fungsi `run-workflow` (snapshot definisi saat run dimulai)
- [ ] Resolver expression path-only `{{$json.x}}` + test batas prototype/ukuran
- [ ] Panel log: status via polling/refetch

**Demo minggu 2:** klik "Jalankan" → HTTP ke API publik → status node berubah → log + hasil execution tersimpan di history.

---

## Minggu 3–4: Control Node, Vault, Realtime

- [ ] Node: `control.condition` (2 port true/false, hanya cabang terpilih jalan), `control.delay` (`step.sleep`), `action.set_variable`
- [ ] Credentials Vault: tabel `credentials`, AES-256-GCM (nonce unik, AAD owner+ID, `key_version`), form di Settings, dropdown credential di HTTP node
- [ ] Redaksi log: whitelist field + truncation; credential tidak muncul di log maupun response browser
- [ ] Ganti polling → Supabase Realtime (Postgres Changes); refetch saat reconnect
- [ ] Retry per node (0–3x) dengan catatan risiko side effect untuk POST

**Demo minggu 4:** workflow bercabang memakai credential dari Vault; API key tidak terlihat di log/network tab.

---

## Minggu 5–6: Webhook, Schedule, Jalur, Quota

- [ ] `trigger.webhook`: `/api/v1/webhooks/{token}` — token acak, hash di DB, bisa dirotasi/nonaktif
- [ ] Webhook **async**: validasi → reservasi quota → `202 Accepted` + `executionId`; hasil dibaca dari history
- [ ] Rate limit webhook tersimpan lintas instance (DB/provider), bukan memori
- [ ] `trigger.schedule`: tabel jadwal (`cron`, timezone, `next_run_at`) + satu cron dispatcher Inngest; uji timezone + dedupe
- [ ] Quota atomik via transaksi/RPC untuk manual, webhook, schedule, dan aktivasi workflow
- [ ] Visual Jalur: warna L1–L6 di edge (`smoothstep` siku 90°), animasi kereta saat run, strip rute di dashboard
- [ ] Dashboard: list workflow + status terakhir, empty state, 2 starter template (endpoint aman, tanpa secret)
- [ ] Plan Pro = **simulasi**: akun demo Pro ditetapkan admin di DB; client tidak bisa ubah `profiles.plan`

**Demo minggu 6:** `curl` ke URL webhook → `202` + `executionId` → canvas bereaksi realtime (kereta jalan) → hasil muncul di history.

---

## Minggu 7–8: Polish, Code Node, AI, Deploy

- [ ] `control.code` di balik **feature flag**, nonaktif di demo publik; QuickJS WASM diuji interrupt/memory limit dulu
- [ ] AI Assistant opsional (Gemini, server-side, rate limit per user; kalau kuota habis AI mati tanpa ganggu engine)
- [ ] Lengkapi terjemahan EN, grep string hardcoded
- [ ] Log retention otomatis (job terjadwal)
- [ ] Audit UI kedua tema: kontras teks ≥ 4.5:1, kontrol/garis ≥ 3:1, `prefers-reduced-motion`
- [ ] Deploy: Vercel + Supabase Cloud + Inngest Cloud; cek batas free tier di dokumentasi resmi saat deploy
- [ ] Sebelum demo: cek project Supabase aktif (resume manual kalau ter-pause)
- [ ] README bilingual; secret scan sebelum repo dipublikasikan

**Demo final:** aplikasi live, bilingual, uji keamanan (RLS silang, SSRF, quota paralel, redaksi credential) lulus.

---

## Stretch (hanya kalau ada sisa waktu)

- Tombol "Rapikan otomatis" (dagre) + routing edge 45° custom
- `control.foreach` dan Merge
- Resume dari node gagal
- Versioning/rollback workflow
- Peta jaringan + papan keberangkatan
- Signature/HMAC opsional untuk webhook
