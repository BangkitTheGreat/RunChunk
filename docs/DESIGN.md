---
version: alpha
name: RunChunk
description: >
  Automation builder visual — versi ringan n8n. Visual language "Jalur"
  (peta transit): garis siku 90° (45° = stretch), penanda stasiun, animasi kereta eksekusi.
  Friendly-first, low-fatigue, bilingual (ID/EN), dark mode default.

colors:
  primary: "#43acfb"
  # --- Neutral (cool gray, hue 255 chroma sangat rendah) ---
  bg: "#0d0e11"
  surface-1: "#131518"
  surface-2: "#191c20"
  surface-3: "#212428"
  surface-overlay: "#1c2024"
  field: "#101214"

  border-subtle: "#24272b"
  border: "#2d3135"
  border-strong: "#3e4348"
  border-control: "#676c73"

  text: "#e8ebef"
  text-muted: "#a6abb2"
  text-subtle: "#898e95"

  canvas-dot: "#282c30"
  edge: "#51565c"

  # --- Accent (Azure) ---
  accent: "#43acfb"
  accent-hover: "#61c0ff"
  accent-text: "#63b9fe"
  accent-soft: "#112b40"
  accent-border: "#185a89"
  on-accent: "#0d1014"

  # --- Semantic ---
  success: "#5bcc80"
  success-soft: "#142d1b"
  success-border: "#265937"

  warning: "#f3b94c"
  warning-soft: "#32240a"
  warning-border: "#64470e"

  danger: "#ff8880"
  danger-soft: "#3a1d1b"
  danger-border: "#733a36"

  # --- Node kategori ---
  cat-trigger: "#efae75"
  cat-trigger-soft: "#3b2612"
  cat-action: "#66d2ce"
  cat-action-soft: "#073231"
  cat-control: "#c8aef8"
  cat-control-soft: "#2f263e"
  cat-output: "#aacb81"
  cat-output-soft: "#253016"

  # --- Warna Jalur L1–L6 (per workflow, di edge/strip rute) ---
  # Dari board v2. Light: #0070c6 #7a4fc9 #c2447f #92591f #00857a #5b6b82
  jalur-l1: "#43acfb"
  jalur-l2: "#b392f0"
  jalur-l3: "#f08cc0"
  jalur-l4: "#c8925a"
  jalur-l5: "#3cc8bd"
  jalur-l6: "#93a4bd"

typography:
  h1:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.29
    letterSpacing: "-0.02em"
  h2:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1.36
    letterSpacing: "-0.015em"
  h3:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.44
    letterSpacing: "-0.01em"
  h4:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.5
  h5:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.43
  h6:
    fontFamily: Plus Jakarta Sans
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "0.06em"
  body:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.43
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.38
  label:
    fontFamily: Plus Jakarta Sans
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.38
  caption:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.33
  mono:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
  mono-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.45

rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  pill: 999px

spacing:
  0-5: 2px
  1: 4px
  2: 8px
  3: 12px
  4: 16px
  5: 20px
  6: 24px
  8: 32px
  10: 40px
  12: 48px

components:
  # --- Buttons ---
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
  button-primary-disabled:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text-subtle}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
  button-secondary:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
    typography: "{typography.label}"
  button-secondary-hover:
    backgroundColor: "{colors.border}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
  button-danger:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
    typography: "{typography.label}"

  # --- Input ---
  input-default:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    typography: "{typography.body-sm}"
  input-focus:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  input-error:
    backgroundColor: "{colors.field}"
    textColor: "{colors.danger}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"

  # --- Badges status ---
  badge-pending:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
    typography: "{typography.caption}"
  badge-running:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-text}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
    typography: "{typography.caption}"
  badge-success:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
    typography: "{typography.caption}"
  badge-failed:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
    typography: "{typography.caption}"
  badge-warning:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
    typography: "{typography.caption}"

  # --- Node card ---
  node-default:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "12px"
    width: "200px"
  node-selected:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "12px"
    width: "200px"
  node-running:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.accent-text}"
    rounded: "{rounded.md}"
    padding: "12px"
    width: "200px"
  node-success:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.success}"
    rounded: "{rounded.md}"
    padding: "12px"
    width: "200px"
  node-error:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.danger}"
    rounded: "{rounded.md}"
    padding: "12px"
    width: "200px"

  # --- Card ---
  card:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "16px"
  card-hover:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "16px"

  # --- Toggle ---
  toggle-off:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.pill}"
    width: "36px"
    height: "20px"
  toggle-on:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.pill}"
    width: "36px"
    height: "20px"
---

## Overview

RunChunk adalah automation builder visual dengan visual language "Jalur" —
workflow digambar seperti peta transit, bukan grid node card generik.
Tone: functional, bersih, tidak intimidatif untuk pemula. Dark mode default.
Target density: antara Linear (tidak sepadat Jira) dan Notion marketing page
(tidak selonggar itu).

Dua prinsip utama:

1. **Warna bertugas tunggal.** Warna kategori node (cat-trigger/action/control/output)
   hanya di tile ikon. Warna status (success/running/danger) hanya di border node
   dan badge. Warna jalur L1–L6 hanya di edge dan strip rute. Tidak ada satu
   elemen yang memakai dua sistem warna sekaligus.

2. **Animasi "felt, not seen".** Semua transisi 120–240ms. Tidak ada yang lebih
   lama kecuali loop indikator running (pulse 1.2s infinite). Canvas drag = 0ms.
   `prefers-reduced-motion` mematikan animasi kereta dan denyut.

## Colors

Front matter memuat nilai dark mode. Nilai light mode lengkap ada di
`docs/tokens.json` (salinan dari paket desain); warna jalur light tercantum di komentar front matter.

**Neutral (cool gray, hue 255 chroma sangat rendah):**
Dipakai untuk semua permukaan. bg → surface-1 → surface-2 → surface-3 = skala
elevasi. Tidak ada shadow atau blur — elevasi dibangun dari warna surface + border.

**Accent (Azure #43acfb / #0070c6):**
Satu warna tindakan per view. Dipakai untuk: tombol primary, toggle on, edge
aktif, focus ring, link, ikon nav aktif. Tidak boleh dipakai dekoratif.

**Semantic (success / warning / danger):**
Hanya untuk status. Tidak boleh dipakai untuk kategori atau identitas.

**Kategori node (cat-*):**
Empat pasang warna (trigger amber, action teal, control purple, output green).
Hanya di tile ikon 24×24 di node card. Tidak di border, tidak di edge.

**Jalur (L1–L6):**
Enam warna identitas per workflow (palet board v2). Dipakai di: edge, strip rute di
workflow list, dot di peta jaringan. Dipilih otomatis saat workflow dibuat
(modulo 6), bisa diganti user.

Sengaja tidak memakai merah/hijau/kuning status supaya garis tidak terbaca
sebagai error/sukses. L1 sama dengan accent: diterima karena accent tidak lagi
dipakai untuk edge; status run dibaca dari kereta, badge, dan border node.
Warna jalur wajib ≥ 3:1 terhadap bg di tiap tema (objek grafis WCAG).

## Typography

**Plus Jakarta Sans** untuk semua teks UI.
Alasan: friendly tanpa kehilangan keterbacaan, spasi glyph yang baik di ukuran
13–14px, dan (kebetulan) namanya nyambung dengan metafora Jalur.

**JetBrains Mono** untuk semua data: expression field `{{$json.x}}`,
JSON viewer, baris log, timestamp, durasi eksekusi, ID.
Alasan: tabular figures (angka tidak joget di kolom), readability di ukuran 11px.

Skala heading 600 semua. h6 = uppercase + letter-spacing 0.06em (hanya untuk
label section: nav group, header kolom log, seksi drawer).

`word-spacing: 0.05em` pada semua teks UI (Plus Jakarta Sans punya spasi kata
sempit secara default; ini sedikit membantu scanning).

## Layout & Spacing

Grid 4px. Kontrol (tombol, input, select) tinggi 32px.

**App frame:**
```
Sidebar (53px collapsed / 216px expanded)
  ↕ Canvas (flex-1)
  ↕ Right drawer (320px, muncul saat node dipilih)
  ↕ Bottom panel (37px collapsed / 236px expanded, log eksekusi)
```

Sidebar collapsible icon-only. Drawer muncul di atas canvas (shadow-2),
bukan menggusur — supaya jalur workflow tetap kelihatan saat konfigurasi.

## Elevation & Depth

Tidak ada glassmorphism atau blur. Elevasi = warna surface + border.

| Level | Token | Dipakai untuk |
|-------|-------|---------------|
| E0 | bg | Canvas, halaman kosong |
| E1 | surface-1 + border-subtle | Sidebar, drawer, bottom panel |
| E2 | surface-2 + border + shadow-1 | Node, kartu workflow |
| E3 | surface-overlay + border-strong + shadow-3 | Dropdown, toast, popover |

## Shapes

Radius kecil dan konsisten.

| Token | Nilai | Dipakai untuk |
|-------|-------|---------------|
| radius-xs | 4px | Token expression, kbd, menu item |
| radius-sm | 6px | Tombol, input, tile ikon node |
| radius-md | 8px | Node, kartu, dropdown |
| radius-lg | 12px | Panel besar, toast, empty state |
| radius-pill | 999px | Badge status, toggle, warna jalur dot |

## Components

### Node Card

Node card di canvas 200px lebar. Anatomi:
```
┌──────────────────────────┐
│ [tile ikon 24px] [label] │  ← h5, warna text
│ [ringkasan config]       │  ← caption, text-muted, mono
│ [port input] [port out]  │  ← di tepi kiri/kanan
└──────────────────────────┘
```

Border node = status: default (border), running (accent-border), success
(success-border), error (danger-border). Warna border berubah via transition
180ms ease-standard.

Node running mendapat sweep bar — garis accent bergerak dari kiri ke kanan
di bagian bawah node (infinite, 1.2s linear). Dimatikan oleh prefers-reduced-motion.

### Edge / Koneksi Jalur

MVP: edge `smoothstep` bawaan React Flow (siku 90°). Routing 45° butuh custom
edge, masuk stretch. Stroke 2px.
- Default: warna `jalur-Ln` workflow bersangkutan
- Draft/belum tersambung valid: warna `edge` (abu)
- Running: tetap `jalur-Ln` + kereta (dot bergerak); status tetap tertulis di badge
- `prefers-reduced-motion`: kereta diganti penanda statis di edge aktif

### Motion

| Elemen | Durasi | Easing |
|--------|--------|--------|
| Hover/press tombol | 120ms | ease-standard |
| Status badge/node border | 180ms | ease-standard |
| Drawer masuk | 240ms | ease-standard |
| Drawer keluar | 180ms | ease-exit |
| Toast masuk | 240ms | ease-standard |
| Toast keluar | 180ms | ease-exit |
| Log baris baru | 150ms | ease-standard (slide from bottom) |
| Sweep bar running | 1.2s | linear, infinite |
| Kereta eksekusi | sesuai durasi jalur | linear |
| Canvas drag/zoom/pan | 0ms | — |

## Do's and Don'ts

**Do:**
- Satu warna accent per view (tombol primary, bukan semua tombol berwarna)
- Warna kategori hanya di tile ikon, bukan di border node
- Gunakan border-based elevation, bukan shadow tebal atau blur
- Semua string lewat `next-intl` (tidak ada hardcoded string bahasa)
- Expression field selalu `font-family: mono`

**Don't:**
- Jangan gradient generik biru-ungu tanpa alasan
- Jangan glassmorphism / backdrop-filter blur
- Jangan shadow besar di E1 (sidebar/drawer — surface + border sudah cukup)
- Jangan warna status di elemen non-status (misal: heading berwarna danger)
- Jangan font sans di expression atau log (selalu mono)
- Jangan animasi > 300ms kecuali loop indikator running
