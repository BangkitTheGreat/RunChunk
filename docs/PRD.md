# RunChunk — Product Requirements Document

**Status:** v1.1 — rancangan terkoreksi; implementasi belum diverifikasi
**Tanggal:** 2026-09-27
**Jenis:** Proyek tugas kuliah + portofolio
**Target deploy:** Vercel Hobby + Supabase Free + Inngest Free (semua free tier)

---

## 1. Ringkasan Produk

RunChunk adalah **platform automation builder visual** — versi ringan dan sederhana
dari n8n — untuk pemula, mahasiswa, dan kebutuhan automasi skala rendah–menengah.
Pengguna merancang workflow secara visual (node-based), lalu menjalankannya lewat
trigger manual, webhook, atau jadwal, sambil melihat status eksekusi secara realtime.

Yang membedakan RunChunk dari n8n:

1. **Visual language "Jalur"** — workflow digambar seperti peta transit, bukan
   grid node card generik. Garis siku 90° dahulu; routing 45° sebagai stretch, stasiun, dan animasi kereta saat
   eksekusi. Lihat `DESIGN.md` bagian Components.
2. **Onboarding-first** — Bahasa Indonesia sebagai default, empty state yang
   mengajari, starter template siap pakai. Target pengguna yang belum pernah pakai
   automation tool.
3. **Ringan dan fokus** — 9 tipe node yang ditargetkan. Semua fitur
   yang ada bisa dijelaskan dalam 5 menit.
4. **AI opsional** — asisten AI (Gemini) untuk menjelaskan, debug, dan bantu
   expression. Bukan inti produk.

---

## 2. Persona & Use Case

### Persona A — "Mikael, mahasiswa" (utama)
- **Konteks:** Skripsi/ tugas kelompok butuh otomatiskan pengumpulan data.
- **Kebutuhan:** Webhook dari pengirim eksternal → HTTP request → hasil tersimpan. Integrasi Google Forms/WhatsApp native tidak termasuk scope.
- **Kendala:** Belum pernah pakai n8n/Zapier. Bingung dengan dokumentasi.
- **Sukses bila:** Bisa bikin workflow pertama tanpa baca dokumentasi eksternal.

### Persona B — "Rani, pemilik toko online kecil" (sekunder)
- **Konteks:** Lead masuk dari WhatsApp, butuh otomatis simpan + notifikasi.
- **Kebutuhan:** Webhook trigger + HTTP + kondisi + response.
- **Kendala:** Ingin automasi, tetapi belum terbiasa dengan tool teknis.
- **Sukses bila:** Paham visual "jalur" tanpa perlu paham graph theory.

### Persona C — "Developer yang mau belajar" (pelaku proyek)
- **Konteks:** Belajar execution engine, queue, realtime.
- **Kebutuhan:** Kode yang readable, dokumentasi lengkap, arsitektur jelas.
- **Sukses bila:** Repo-nya layak jadi portofolio (dapat dibaca developer senior).

---

## 3. User Stories

### 3.1 Editor
| ID | Story | Prioritas |
|----|-------|-----------|
| US-01 | Sebagai user, saya bisa drag node dari palette ke canvas | P0 |
| US-02 | ... bisa menghubungkan node dengan edge | P0 |
| US-03 | ... bisa membuka konfigurasi node lewat drawer (bukan modal) | P0 |
| US-04 | ... bisa menghapus node/edge | P0 |
| US-05 | ... bisa undo/redo perubahan | P1 |
| US-06 | ... bisa menyimpan workflow (Ctrl+S) | P0 |
| US-07 | ... bisa export/import workflow sebagai JSON | P1 |

### 3.2 Execution
| ID | Story | Prioritas |
|----|-------|-----------|
| US-10 | Sebagai user, saya bisa klik "Jalankan" dan melihat status node berubah (polling dulu, Realtime minggu 3–4) | P0 |
| US-11 | ... bisa melihat log setiap node (timestamp, status, durasi, input/output) | P0 |
| US-12 | ... bisa membuat run baru dari awal; resume dari node gagal menjadi stretch karena risiko side effect | P1 |
| US-13 | ... bisa melihat history semua execution | P0 |
| US-14 | ... bisa membuat/merotasi token webhook dan menerima executionId via 202 | P0 |
| US-15 | ... bisa menjadwalkan workflow (cron) | P1 |

### 3.3 Auth & Settings
| ID | Story | Prioritas |
|----|-------|-----------|
| US-20 | Sebagai user, saya bisa daftar/login dengan email+password | P0 |
| US-21 | ... bisa login dengan Google OAuth | P1 |
| US-25 | ... bisa menyimpan API key di Credentials Vault (ter-encrypt) | P0 |
| US-26 | ... bisa menyimpan environment variables | P1 |
| US-27 | ... bisa men-switch bahasa ID/EN (fondasi `next-intl` minggu 1) | P0 |
| US-28 | ... bisa melihat usage & quota plan Free vs Pro | P1 |

### 3.4 AI Assistant (opsional)
| ID | Story | Prioritas |
|----|-------|-----------|
| US-40 | ... bisa klik "Jelaskan alur ini" dan AI membaca JSON graph | P2 |
| US-41 | ... bisa klik "Tanya AI kenapa gagal" di error log | P2 |
| US-42 | ... bisa minta syntax expression ke AI | P2 |

---

## 4. Scope

### 4.1 Target inti demo final (minggu 8; demo pertama hanya vertical slice)
- Auth: email/password + Google OAuth
- Editor: drag node, connect, config drawer, save
- Node types target (8 inti + 1 eksperimental): 
  - Trigger: `trigger.manual`, `trigger.webhook`, `trigger.schedule`
  - Action: `action.http`, `action.set_variable`
  - Control: `control.condition`, `control.delay`
  - Output: `output.response`
  - (+ `control.code` — feature flag, nonaktif pada demo publik sampai pengujian sandbox lulus; lihat §6)
- **Execution engine:** Inngest + custom DAG executor; fungsi dijalankan di Vercel per step, bukan worker terpisah.
- Realtime: Supabase Realtime (status node + log push)
- Execution log dengan redaksi, whitelist field, dan batas payload
- Credentials Vault (AES-256-GCM)
- Dashboard: list workflow + strip rute + Template Library
- Quota enforcement server-side

### 4.2 Pelengkap target final (bertahap sampai minggu 8)
- Webhook rate limiting (wajib sebelum endpoint publik)
- Log retention auto-cleanup
- Language switch ID/EN (fondasi minggu 1)
- Empty states + starter templates

### 4.3 Stretch (kalau ada waktu)
- Auto-layout ("Rapikan otomatis") via dagre
- Loop node (`control.foreach`) dan Merge
- Custom edge routing 45°
- AI Assistant (3 use case §3.4)
- Pricing page berlabel simulasi; akun demo Pro ditetapkan admin
- Peta jaringan (mini network graph per user)
- Versioning workflow (rollback)
- Papan keberangkatan (schedule board)

---

## 5. Kebutuhan Non-Fungsional

| Kategori | Req | Verifikasi |
|----------|-----|-------------|
| Security | Credentials ter-encrypt AES-256-GCM, tidak pernah di log | Inspect log saat run |
| Security | RLS di semua tabel user-owned, termasuk join log ke execution | Uji akses silang akun A/B |
| Security | HTTP node memblokir SSRF termasuk DNS/redirect private; allowlist bila kontrol egress belum terjamin | Uji localhost, metadata, IPv6 dan redirect |
| Security | Quota atomik di server | Request paralel tidak menembus limit |
| Security | Credential mentah hanya di handler HTTP server, tidak di context persisten/log/response browser | Uji redaksi + inspeksi network |
| Performance | Target editor interaktif < 2s untuk workflow 20 node (kondisi uji dicatat) | Profil browser |
| Performance | Target status update p95 < 1s di lingkungan uji, bukan SLA | Timestamp server vs client |
| Performance | Resolver expression dibatasi ukuran/kedalaman input | Test payload batas |
| Accessibility | Teks normal ≥ 4.5:1, kontrol & garis bermakna ≥ 3:1 | Lint token + audit UI kedua tema |
| Accessibility | `prefers-reduced-motion` dihormati | DevTools emulation |
| Accessibility | Focus ring 2px accent, offset 2px | Keyboard nav test |
| i18n | Default ID, EN tersedia via `next-intl` | Switch language |
| i18n | Semua error message dari file terjemahan | Grep hardcoded string |
| Cost | Target $0 untuk demo terbatas, bukan jaminan | Dashboard seluruh provider |
| Cost | Executor di endpoint Inngest pada Vercel; setiap step tunduk timeout host | Code review |
| Portofolio | README bilingual, lisensi dipilih pemilik, secret scan sebelum publikasi | Review repo sebelum izin publish |

---

## 6. Node Types Specification

### 6.1 Trigger nodes

```
trigger.manual      — Jalankan dari UI (button "Run")
trigger.webhook     — POST eksternal → start workflow
trigger.schedule    — Cron expression (jam, harian, custom)
```

**Webhook URL format:**
```
POST https://<domain>/api/v1/webhooks/{token}
Body: JSON tervalidasi dan dibatasi ukurannya
Response: 202 Accepted + executionId; hasil dibaca dari history terautentikasi
Token: acak berentropi tinggi, dapat dirotasi, hash disimpan di DB
```

### 6.2 Action nodes

```
action.http         — GET/POST/PUT/DELETE/PATCH
                     + headers, body templating, auth (via credential)
action.set_variable — Simpan key-value ke execution context ($vars.KEY)
```

### 6.3 Control nodes

```
control.condition   — If/else, dua output port (true/false)
control.delay       — step.sleep("5m") — Inngest built-in
control.code        — Custom JS, kandidat QuickJS WASM; feature flag
                     Input: JSON context. Output: JSON.
                     CPU/memori/input-output dibatasi dan diuji sebelum publik; no network/env/DB
control.foreach     — Loop over array (stretch)
```

### 6.4 Output nodes

```
output.response     — Simpan hasil akhir execution; bukan response HTTP webhook sinkron
```

### 6.5 Execution Context

```ts
interface ExecutionContext {
  workflowId: string;
  executionId: string;
  triggerData: unknown;              // webhook body / schedule time
  nodeOutputs: Record<string, unknown>;  // nodeId → output
  variables: Record<string, unknown>;    // dari set_variable
  startedAt: string;                 // ISO
}
```

### 6.6 Expression Language (hybrid)

**Tier 1 — path lookup tanpa eval:**
Tolak prototype keys/getters; batasi ukuran dan kedalaman input. Expression tunggal mempertahankan tipe; campuran teks menjadi string.
```
{{$json.order_id}}          → output predecessor aktif pada cabang terpilih
{{$node.n1.status}}         → output node n1
{{$vars.API_BASE}}          → variables.API_BASE
{{$trigger.email}}          → triggerData.email
```

**Tier 2 — logic = Code node, bukan expression.**
Comparison sederhana tersedia melalui form `control.condition`. Logic JS lain hanya di Code node bila flag aktif.

**Kenapa bukan n8n-parity:**
Path-only dipilih untuk mengurangi attack surface. Estimasi implementasi dan detail keamanan produk lain tidak dijadikan spesifikasi RunChunk.

### 6.7 Error Handling

| Field | Default | Keterangan |
|-------|---------|------------|
| `maxRetries` | 0 | Config per node |
| `retryDelay` | 1000ms | Exponential backoff |
| `continueOnFail` | false | Hanya aktif setelah semantik error-output eksplisit diuji; bukan branch false otomatis |
| `timeout` | Ditentukan saat implementasi | Pisahkan timeout step aktif dan batas umur workflow yang mencakup sleep |

**Status execution:** `pending` → `running` → `success` | `partial_failed` | `failed`

---

## 7. Localization (i18n)

**Library:** `next-intl`
**Default:** Indonesia (`id`)
**Alternatif:** English (`en`)

**Strukturnya:**

```
messages/
  id.json
  en.json
```

**Catatan:** setup i18n dari awal karena retrofit menyakitkan. Kedua file disiapkan minggu 1 dengan key yang sama; terjemahan EN lengkap wajib saat demo final.

**String yang wajib i18n:**
- Semua label UI, tooltip, placeholder
- Semua pesan error (validasi, network, node error)
- Nama node & kategori
- Empty state copy
- Notifikasi & toast

**Yang TIDAK perlu i18n:** nama workflow (user-defined), data user, log output
dari node (mentah dari API), nama credential.

---

## 8. Free Tier Reality Check

Status: batas numerik belum disahkan dari dokumentasi resmi untuk konfigurasi deployment. Jangan memakai hasil pencarian sebelumnya sebagai jaminan gratis atau estimasi kapasitas.

| Service | Sumber resmi | Yang harus diverifikasi saat deploy |
|---|---|---|
| Vercel Hobby | https://vercel.com/docs/functions/limitations | Mode compute, maxDuration, kuota dan syarat penggunaan nonkomersial. Executor tetap berjalan di host ini. |
| Supabase Free | https://supabase.com/pricing | DB, egress, Auth, Realtime, pausing dan retensi. Periksa/resume project sebelum demo; jangan mengandalkan ping untuk mencegah pause. |
| Inngest Free | https://www.inngest.com/pricing | Definisi billing executions, concurrency dan overhead retry/log/dispatch. Tidak ada konversi tetap 1 node = 1 step = 1 billing unit. Ukur workflow contoh melalui dashboard. |
| Gemini | https://ai.google.dev/gemini-api/docs/rate-limits | Model yang tersedia, RPM/TPM/RPD aktual per project. Rate limit server-side; saat habis AI dimatikan tanpa memblokir engine. |

Target biaya nol untuk demo terbatas, bukan SLA. Catat pemakaian nyata sebelum menaikkan quota internal.

---

## 9. Subscription & Monetization

**Model:** Freemium role-based (tanpa payment gateway di MVP).

| | Free | Pro (simulasi) |
|---|---|---|
| Active workflows | 3 | Batas demo ditetapkan admin sesuai budget |
| Executions / bulan | 100 | 5.000 |
| Log retention | 3 hari | 30 hari |
| Webhook rate limit | 10 req/menit | 60 req/menit |
| AI Assistant | 5 chat/hari bila tersedia | Batas server sesuai budget provider, bukan unlimited |
| Code node | Feature flag | Feature flag |

**Upgrade flow:** akun demo Pro ditetapkan admin di DB; UI menyatakan simulasi tanpa pembayaran. Client tidak dapat mengubah `profiles.plan`.

**Enforcement:** reservasi execution dan counter bulanan dalam satu transaksi/RPC dengan locking. Aktivasi workflow juga memeriksa batas secara atomik. Pemeriksaan berlaku untuk manual, webhook dan schedule.

Kalau over limit → return 403 + pesan yang informatif (bukan silent fail).

---

## 10. KPI & Definition of Done

### Demo dosen (minggu ke-2):
- [ ] 1 workflow jalan end-to-end: manual → HTTP → hasil execution tersimpan
- [ ] Node menampilkan status via refetch/polling; Realtime ditambahkan minggu 3–4
- [ ] Log per node dengan timestamp + status

### Demo final (minggu ke-8):
- [ ] Delapan node inti berfungsi; Code node diuji di lingkungan tepercaya dengan feature flag
- [ ] Webhook mengembalikan 202 + executionId; hasil muncul di history
- [ ] Schedule trigger diuji timezone, dedupe, dan waktu run berikutnya
- [ ] Credentials terenkripsi, tidak muncul di log maupun response browser
- [ ] Light/dark mode toggle
- [ ] Bahasa ID/EN switch
- [ ] Empty state + 2 starter template dengan endpoint aman, tanpa secret bawaan
- [ ] Quota atomik, rate limit, SSRF, dan uji akses silang akun lulus
- [ ] Dokumentasi setup dan README bilingual siap; publikasi repo hanya setelah review secret dan izin pemilik

---

## Appendix A — Glossary

| Istilah | Definisi |
|---------|---------|
| **Node** | Satu unit kerja di workflow (trigger, action, control, output) |
| **Edge** | Koneksi antar node (directed) |
| **Execution** | Satu kali jalan workflow dari trigger sampai selesai |
| **Step** | Unit kerja durable Inngest; tidak diasumsikan sama dengan satu node atau satu unit billing |
| **DAG** | Directed Acyclic Graph — workflow tanpa cycle |
| **Expression** | Template `{{$json.x}}` untuk akses data antar node |
| **Credentials Vault** | Penyimpanan API key ter-encrypt |
| **RLS** | Row Level Security — policy di Postgres |
| **Jalur** | Metafora visual RunChunk: workflow = peta transit |