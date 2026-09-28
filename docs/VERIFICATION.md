# RunChunk — Bukti Verifikasi

Laporan ini dibuat untuk memperbarui checklist di `ROADMAP.md`. Checklist **tidak** dicentang oleh pembuat kode; setiap item di bawah menyebut cara verifikasinya supaya bisa diperiksa ulang.

Tanggal: 2026-09-28 · Lingkungan: container Linux, Node 22.22, PostgreSQL 16.13 lokal. Tidak ada Supabase (Auth/PostgREST/Realtime) maupun Inngest Dev Server yang hidup, dan akses internet keluar diblokir kebijakan jaringan.

Status:
- **Terverifikasi**: dijalankan di lingkungan ini, perintah dan hasilnya tercantum.
- **Sebagian**: sebagian perilaku terbukti, sisanya disebut eksplisit.
- **Belum**: belum diuji di sini.

## Perintah yang dijalankan

| Perintah | Hasil |
|---|---|
| `npm run lint` | 0 error, 2 warning lama (`window.location.assign`) |
| `npm run typecheck` | lulus (`next typegen` + `tsc --noEmit`) |
| `npm test` | `All boundary checks PASSED.` · `All engine, vault and redaction checks PASSED.` |
| `npx next build` | `✓ Compiled successfully`, 13 route termasuk `/api/credentials` |
| Suite RLS di PostgreSQL 16 (stub + 3 migrasi + `rls_cross_account.sql`, lihat README) | `NOTICE: rls_cross_account: all checks passed` |
| Paritas kunci i18n | `id 183 / en 183`, tidak ada kunci yang hilang |
| Playwright ke `next dev` dengan API tiruan | editor, drawer, simpan, log, halaman credential tampil; 0 error halaman; definisi yang disimpan UI diterima validator server. Tangkapan layar: `docs/verification/*.png` (data dari API tiruan, bukan run sungguhan) |

**Uji mutasi** (memastikan tes bisa gagal): redaksi di step HTTP dimatikan → `secret leaked in output`; guard dua cabang aktif dihapus → `Missing expected rejection`; retry 5xx dihapus → assertion gagal; filter port condition dihapus → gagal; cek umur run dihapus → gagal; redaksi lapis kedua di log dihapus → `log preview masks sensitive keys`. Untuk RLS: memberi SELECT `ciphertext` ke `authenticated` → `FAIL: A read credential ciphertext`; policy SELECT dibuka → `FAIL: B sees A credential`; memberi UPDATE → `FAIL: client updated credential`. (Memberi INSERT tidak menggagalkan tes karena RLS tanpa policy insert tetap menolak dengan kode error yang sama. Insert tetap terblokir dua lapis.)

## Minggu 1–2

| Item | Status | Bukti |
|---|---|---|
| Init repo Next.js App Router, TS, Tailwind, Supabase client | Terverifikasi | `npx next build` lulus |
| `next-intl` ID + EN dengan kunci sama | Terverifikasi | paritas 183/183 |
| Token desain → CSS variables dark + light, L1–L6 light | Sebagian | Variabel ada di `globals.css` untuk dark dan `[data-theme="light"]`. Kesesuaian nilai dengan `docs/tokens.json` belum dicek. Ditemukan dan diperbaiki: canvas React Flow selalu memakai token terang (lihat catatan di bawah) |
| Supabase Auth email/password, trigger `profiles`, tabel inti | Sebagian | Migrasi terpasang di PG16; trigger `profiles` dicek oleh suite RLS. Alur login/daftar sungguhan belum diuji di sini (butuh Supabase Auth) |
| RLS semua tabel + uji akses silang A/B | Terverifikasi | suite RLS lulus + uji mutasi |
| Canvas: palette, drag, connect, drawer, save | Sebagian | Playwright: buka workflow, klik node → drawer, ubah field, simpan (PUT diterima validator). Gestur drag dan tarik-sambung belum diotomasi |
| Validasi graph di server | Terverifikasi | `scripts/check-workflow.ts`, `scripts/check-engine.ts` |
| Node manual, HTTP, output | Terverifikasi (logika) | tes engine dengan HTTP tiruan. Request ke API publik sungguhan tidak bisa dari sini (egress diblokir); README mencatat smoke test sebelumnya ke `https://example.com` |
| Proteksi SSRF | Sebagian | Tes: daftar IP privat/loopback/metadata/IPv6-mapped/NAT64, `localhost` via DNS, skema `file:`. Validasi per hop redirect ada di kode (`safeFetch`) tetapi belum punya tes otomatis |
| Inngest + `run-workflow` dengan snapshot | Sebagian | `GET /api/inngest` → `function_count: 2, mode: dev`. Run sungguhan lewat Inngest Dev Server belum di sini; engine diuji dengan runner step tiruan yang meniru memo/replay |
| Resolver expression + batas prototype/ukuran | Terverifikasi | `scripts/check-workflow.ts` |
| Panel log: status via polling | Diganti | Minggu 4 mengganti polling dengan Realtime |

## Minggu 3–4

| Item | Status | Bukti |
|---|---|---|
| `control.condition` 2 port, hanya cabang terpilih jalan | Terverifikasi (logika) | tes: 404 → cabang benar jalan, HTTP di cabang salah tidak pernah dikirim; cabang bersarang ikut dilewati; dua cabang aktif bertemu → `errors.multipleActiveInputs`; koersi `404` = `"404"` |
| `control.delay` via `step.sleep` | Terverifikasi (logika) | tes: `step.sleep("delay-d", 120)`; >1 jam per node dan total >24 jam ditolak validator; `errors.runTooLong` saat run melewati 24 jam |
| `action.set_variable` | Terverifikasi | tes: nilai digabung ke `$json`, tersedia sebagai `$vars`, tipe angka dipertahankan |
| Vault: tabel, AES-256-GCM, nonce unik, AAD owner+ID, `key_version` | Terverifikasi | tes: nonce beda per enkripsi, tag 16 byte, AAD mengikat owner/ID/versi, tamper terdeteksi, rotasi v2 tetap membaca v1, kunci hilang/salah panjang ditolak. RLS: browser tidak bisa membaca ciphertext/nonce/tag, tidak bisa insert/update, B tidak melihat/menghapus milik A |
| Form credential + dropdown di node HTTP | Terverifikasi (UI) | Playwright: simpan credential, pesan "tersimpan terenkripsi", nilai rahasia tidak ada di DOM setelah simpan; dropdown credential di drawer HTTP |
| Redaksi log: whitelist + truncation; credential tak muncul di log/respons | Terverifikasi (logika) | tes echo server tiruan (memantulkan header seperti httpbin): Bearer, API key, dan Basic (termasuk base64) tidak muncul di output step, log, maupun output eksekusi; `access_token`/`password` disensor per nama field; pratinjau log ≤ 4 KB |
| Realtime menggantikan polling, refetch saat reconnect | Sebagian | Kode: Postgres Changes per `workflow_id`/`execution_id`, refetch saat mount/subscribe/fokus/online, tanpa interval. Playwright menunjukkan UI tetap memuat data saat socket tidak tersambung (bug ini ditemukan lewat tes lalu diperbaiki). Event Realtime sungguhan belum diuji (butuh Supabase) |
| Retry per node 0–3x + peringatan POST | Terverifikasi | tes: 503→429→200 = 3 percobaan dengan jeda 2 s dan 4 s; timeout diulang; 4xx dan penolakan SSRF tidak diulang; tiap percobaan punya step ID sendiri. Playwright: peringatan tampil untuk POST dengan retry 2 |
| **Demo minggu 4**: cabang + credential Vault, API key tak terlihat di log/network | Sebagian | Terbukti di tingkat engine (tes end-to-end dengan echo tiruan) dan UI (API tiruan). Belum dijalankan dengan Supabase + Inngest sungguhan. Catatan: request `POST /api/credentials` saat user menyimpan rahasia memang membawa nilainya (tak terhindarkan); semua respons API hanya berisi metadata |

## Temuan review ronde 2 (setelah commit `e35f2d1`)

Keenam temuan direproduksi dulu dengan tes yang gagal, baru diperbaiki. Setiap perbaikan juga diuji mutasi: bila perbaikannya dibalik, tesnya gagal lagi. Tes ada di `reviewRegressionChecks` di `scripts/check-engine.ts`.

| # | Temuan | Reproduksi sebelum fix | Perbaikan |
|---|---|---|---|
| 1 | Rahasia lolos sebagai `demo+key%2F123` / `demo%20key%2f123` | `encoded secret leaked: demo+key%2F123` | Pencocokan per karakter: literal, `%XX` (hex huruf besar/kecil), `+` untuk spasi, escape JSON (`redact.ts`) |
| 2 | Retry tetap mengirim HTTP setelah deadline 24 jam; node tetap sukses | `Missing expected rejection` | Deadline dicek di dalam step tiap percobaan dan di dalam step pencatat sukses; tes replay dengan jam berbeda menghasilkan vonis yang sama (`engine.ts`) |
| 3 | Token dari header `Authorization` manual lolos bila dipantulkan tanpa `Bearer` | `typed header component leaked: demo-secret-123` (saat fix dibalik) | `headerSecrets`: token setelah skema, isi Basic yang di-decode, nilai cookie (`http-node.ts`) |
| 4 | `exists`/`is_empty` gagal karena operand kanan yang tersembunyi dievaluasi | node gagal `errors.invalidExpression` (saat fix dibalik) | Operand kanan hanya di-resolve untuk operator biner |
| 5 | Rename variabel ke nama yang sudah ada menghapus nilai lain | Playwright pada UI versi lama: 2 baris menjadi 1, `found` hilang tanpa peringatan | Draft baris disimpan terpisah; nama duplikat atau tidak valid memunculkan peringatan dan tidak diterapkan. Playwright: peringatan tampil, nilai tersimpan tetap utuh, lalu diterapkan setelah nama diperbaiki |
| 6 | UUID huruf besar di URL merusak AAD saat ganti rahasia | `errors.credentialDecryptFailed` | `canonicalUuid` (`src/lib/ids.ts`): `requireId` mengembalikan ID kanonis, dan AAD menormalisasi huruf |

Temuan 1–4 dan 6 diuji di tingkat unit/engine. Temuan 5 diuji lewat browser dengan API tiruan. Endpoint credential dengan database sungguhan tetap belum diuji (butuh Supabase).

## Minggu 5–6

Perintah yang dijalankan (2026-09-28, lingkungan yang sama):

| Perintah | Hasil |
|---|---|
| `npm run lint` · `npm run typecheck` · `npx next build` | lulus (lint 0 error, 2 warning lama) |
| `npm test` | tiga suite lulus, termasuk `scripts/check-triggers.ts` (pemicu, cron/DST, jalur quota, dispatcher, webhook) |
| `DB=… scripts/db-check.sh` (PostgreSQL 16 + stub) | `rls_cross_account: all checks passed` · `quota_webhook_schedule: all checks passed` · `db-concurrency: all checks passed` |
| `scripts/db-concurrency.sh` (koneksi paralel, dilepas bersamaan lewat advisory lock) | 30 `reserve_run` di 90/100 → tepat 10 lolos, counter 100 · 10 aktivasi paralel → tepat 3 · 30 `webhook_hit` limit 10 → tepat 10 · 20 `claim_schedule` slot sama → tepat 1. Mutan tertangkap: aktivasi tanpa advisory lock → 10 lolos; quota baca-lalu-tulis → 30 lolos |
| Playwright ke `next dev` + API tiruan | dashboard (kuota, template, status terakhir), drawer webhook (buat URL, salin, rotasi), drawer jadwal (preset, pratinjau run), toggle Aktif, kereta di edge saat node running, penanda statis saat `prefers-reduced-motion`; 0 error halaman. Screenshot di `docs/verification/` |

**Uji mutasi.** SQL (9 mutan, semua tertangkap): hapus guard `runs < quota` → `101st run allowed`; aktivasi tanpa cek batas → `4th activation should be refused`; rate limit tanpa cap → `11th hit allowed`; claim tanpa compare-and-swap → `second claim … succeeded (duplicate dispatch)`; `due_schedules` abaikan `is_active`; `token_hash` bisa dibaca client; `reserve_run` bisa dipanggil client; policy jadwal terbuka; kolom `is_active` bisa di-update client. TypeScript (10 mutan, semua tertangkap): dispatcher abaikan hasil claim / kejar slot terlewat / jalankan workflow nonaktif; `startExecution` tanpa refund saat dispatch gagal / abaikan quota; validator terima dua pemicu / cron rusak / 6 field; webhook teruskan semua header; engine hanya mulai dari pemicu manual.

| Item | Status | Bukti |
|---|---|---|
| `trigger.webhook` di `/api/v1/webhooks/{token}`: token acak, hash di DB, rotasi/nonaktif | Terverifikasi (logika) | tes: token 43 char base64url, SHA-256, hint; route: format token salah → 404, GET → 405 (di-curl ke `next dev`). Nonaktif = workflow nonaktif/rotasi/hapus (lihat ARCHITECTURE §9) |
| Webhook async: validasi → quota → 202 + executionId | Sebagian | jalur `startExecution` diuji dengan dependensi tiruan (quota ditolak → tidak ada insert; dispatch gagal → `dispatch_failed` + refund). Request nyata ke route dengan Supabase belum |
| Rate limit webhook lintas instance (DB) | Terverifikasi (DB) | suite SQL: 10 lolos, ke-11 ditolak dengan `retry_after` 1–60; mutan tanpa cap tertangkap |
| `trigger.schedule`: tabel jadwal + satu dispatcher cron; uji timezone + dedupe | Terverifikasi (logika + DB) | cron: Jakarta 09:00 → 02:00Z; Berlin 02:30 melintasi DST 2026-03-29 → 01:30Z lalu 00:30Z; dedupe: CAS di SQL (claim kedua gagal) dan simulasi 3 dispatcher paralel → tepat 1 execution. Dispatcher di Inngest sungguhan belum |
| Quota atomik manual/webhook/schedule/aktivasi | Terverifikasi (DB) | suite SQL: 100 lolos, ke-101 ditolak, release mengembalikan; aktivasi ke-4 ditolak, Pro 5.000. Uji 100 request paralel lewat HTTP belum (butuh server + Supabase) |
| Visual Jalur: warna L1–L6 di edge, kereta saat run, strip rute | Terverifikasi (UI) | Playwright: `circle.train` tampak saat node tujuan running, hilang dan diganti `.train-static` saat reduced-motion; screenshot `jalur-train-running.png` |
| Dashboard: status terakhir, empty state, 2 template | Terverifikasi (UI) | template dibuat lewat klik dan definisinya diterima validator server; status terakhir dari view `workflow_last_executions` (suite SQL) |
| Plan Pro simulasi, client tak bisa ubah plan | Terverifikasi (DB) | suite RLS lama (`B upgraded own plan` ditolak) + `my_usage` mengembalikan plan/quota; label "(simulasi)" di UI |
| **Demo minggu 6**: curl → 202 → kanvas bereaksi realtime → riwayat | Sebagian | UI mengikuti execution terbaru tanpa klik (Playwright, lewat refetch); jalur webhook end-to-end dengan Supabase + Inngest belum dijalankan |

## Yang perlu dijalankan dengan layanan sungguhan

1. Terapkan migrasi `0003_credentials.sql`, isi `CREDENTIALS_KEY_V1` di `.env.local`.
2. `npm run dev -- --port 3008` + `npx inngest-cli dev -u http://localhost:3008/api/inngest`.
3. Buat credential Bearer, lalu workflow: Manual → HTTP (ke endpoint yang memantulkan header, misalnya `https://httpbin.org/anything`, pakai credential) → Condition `{{$json.status}}` equals `200` → Output.
4. Klik Jalankan: status node berubah tanpa refresh (Realtime), cabang salah redup/Dilewati, dan di tab Network maupun log tidak ada nilai token (yang ada `[REDACTED]`).

Untuk minggu 5–6, tambahkan:

5. Terapkan migrasi `0004_webhook_schedule_quota.sql`. Buat workflow dari template "Webhook lead masuk", klik node webhook → Buat URL → salin, lalu klik Aktifkan.
6. `curl -X POST '<URL>' -H 'content-type: application/json' -d '{"email":"demo@example.com"}'` → respons `202 {"executionId": …}`; kanvas menampilkan kereta lalu status per node tanpa refresh; riwayat mencatat sumber "Webhook". Ulangi 11× dalam satu menit → yang ke-11 `429` dengan `Retry-After`.
7. Buat workflow dengan Jadwal Cron `*/2 * * * *`, aktifkan, tunggu ≤ 2 menit: satu execution bersumber "Jadwal" muncul, tidak ganda; cek `workflow_schedules.next_run_at` maju.
8. Habiskan kuota (atau set `plan_limits` sementara) lalu klik Jalankan → banner `errors.quotaExceeded`; aktifkan workflow ke-4 → banner batas aktif.

## Catatan temuan selama verifikasi

- **Canvas selalu tema terang.** React Flow memasang class `light` di wrapper secara default, dan `globals.css` memetakan `.light` ke token terang, sehingga kartu node putih dengan teks samar di tema gelap. Diperbaiki dengan `colorMode` mengikuti tema aplikasi.
- **Riwayat kosong bila Realtime tidak tersambung.** Versi awal refetch hanya dipicu oleh subscribe; sekarang fetch awal selalu jalan.
- **`OPTIONS` di dropdown metode** tidak didukung server (selalu gagal); dihapus dari UI.
