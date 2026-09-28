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

## Yang perlu dijalankan dengan layanan sungguhan

1. Terapkan migrasi `0003_credentials.sql`, isi `CREDENTIALS_KEY_V1` di `.env.local`.
2. `npm run dev -- --port 3008` + `npx inngest-cli dev -u http://localhost:3008/api/inngest`.
3. Buat credential Bearer, lalu workflow: Manual → HTTP (ke endpoint yang memantulkan header, misalnya `https://httpbin.org/anything`, pakai credential) → Condition `{{$json.status}}` equals `200` → Output.
4. Klik Jalankan: status node berubah tanpa refresh (Realtime), cabang salah redup/Dilewati, dan di tab Network maupun log tidak ada nilai token (yang ada `[REDACTED]`).

## Catatan temuan selama verifikasi

- **Canvas selalu tema terang.** React Flow memasang class `light` di wrapper secara default, dan `globals.css` memetakan `.light` ke token terang, sehingga kartu node putih dengan teks samar di tema gelap. Diperbaiki dengan `colorMode` mengikuti tema aplikasi.
- **Riwayat kosong bila Realtime tidak tersambung.** Versi awal refetch hanya dipicu oleh subscribe; sekarang fetch awal selalu jalan.
- **`OPTIONS` di dropdown metode** tidak didukung server (selalu gagal); dihapus dari UI.
