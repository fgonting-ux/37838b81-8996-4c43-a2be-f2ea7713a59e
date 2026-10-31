# 🤖 Bot Discord — Moderasi, Reaction Role & Voice Sementara

Bot serbaguna untuk **satu server** (single-guild). Fitur: embed + reaction role pakai
tombol, moderasi otomatis (link & kata kasar) dengan sistem warn, voice sementara
(join-to-create), auto-delete channel, manajemen role, dan utilitas server lainnya.

Dibangun dengan **discord.js v14**, satu file `index.js` (1.232 baris), tanpa database —
semua data tersimpan di file JSON.

---

## 📦 Prasyarat

- **Node.js** v18 atau lebih baru
- **discord.js** `^14.26.4`
- **dotenv** `^17.4.2`
- Bot application di [Discord Developer Portal](https://discord.com/developers/applications)
  dengan **Privileged Gateway Intents** aktif: `Message Content Intent` &
  `Server Members Intent`

## 🔧 Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Isi file `.env` di folder yang sama dengan `index.js`:

   ```env
   DISCORD_TOKEN=token_bot_kamu
   CLIENT_ID=id_aplikasi_bot
   GUILD_ID=id_server_kamu
   ```

   > ⚠️ `DISCORD_TOKEN` wajib. `CLIENT_ID` & `GUILD_ID` saat ini tidak dipakai oleh
   > kode (command didaftarkan secara global, bukan per-guild).

3. Jalankan bot:

   ```bash
   node index.js
   ```

   Bot mendaftarkan semua slash command ke Discord saat startup. Command bersifat
   **global** — butuh waktu **sampai 1 jam** untuk muncul di server.

## 🔐 Invite Bot

Sesuaikan `CLIENT_ID` dan checklist permission sesuai kebutuhan:

```
https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID&permissions=8&scope=bot%20applications.commands
```

Permission angka `8` = Administrator. Untuk minimal, aktifkan permission berikut:

`Manage Messages`, `Manage Roles`, `Manage Channels`, `Kick Members`, `Ban Members`,
`Manage Guild`

---

## 🧠 Intents yang Dipakai

Kode membuat client dengan 4 intents:

| Intent | Fungsi |
|---|---|
| `Guilds` | Cache channel, role, dan slash command |
| `GuildMessages` | Menerima event pesan di server |
| `MessageContent` | Membaca isi pesan — untuk prefix command & deteksi otomatis |
| `GuildVoiceStates` | Event join/leave voice — fitur voice sementara |

---

## 📂 Struktur File

```
.
├── index.js                     # Seluruh kode bot (1.232 baris)
├── package.json                 # Dependencies & metadata
├── .env                         # DISCORD_TOKEN, CLIENT_ID, GUILD_ID
├── embeds.json                  # Database embed + tombol role
├── warnings.json                # Database warn per server
├── temporaryVoiceChannels.json  # Konfigurasi & daftar voice sementara
├── autoDeleteChannels.json      # Daftar channel auto-delete (delety/clear-message)
└── delayDeleteChannels.json     # Daftar channel delete-delay
```

Semua file JSON dibuat otomatis saat pertama kali diperlukan. Data **tetap tersimpan
setelah bot restart**.

---

## 🎛️ Daftar Command

### Prefix Command (`!` atau `?`)

Prefix bisa `!` atau `?`. Contoh: `!ping` atau `?ping`.

| Command | Permission | Keterangan |
|---|---|---|
| `!ping` | — | Cek latency bot & API Discord |
| `!warn @user <alasan>` | Manage Messages | Beri warn manual ke member |
| `!clear <1-100>` | Manage Messages | Hapus pesan secara massal (maks 100, pesan < 14 hari) |
| `!role @user @role` | Manage Roles | Kasih role ke member |
| `!role create <nama> <warnaHex> [permission]` | Manage Roles | Bikin role baru |
| `!role delete @role` | Manage Roles | Hapus role |

Permission yang dikenal di `!role create` (opsional): `Administrator`, `ManageMessages`,
`ManageChannels`, `ManageRoles`, `KickMembers`, `BanMembers`. Kosongkan atau tulis
`None` untuk role tanpa permission.

### Slash Command

#### Embed & Reaction Role

**`/setup-embed`** — Administrator
Bikin embed baru atau edit teks embed yang sudah ada.

| Opsi | Wajib | Keterangan |
|---|---|---|
| `nama` | ✅ | Nama unik sebagai ID embed (autocompletion) |
| `title` | ❌ | Judul embed |
| `deskripsi` | ❌ | Isi deskripsi. Gunakan `\n` untuk baris baru |
| `warna` | ❌ | Kode HEX, contoh `#FF0000` (dengan/tanpa `#`) |
| `footer` | ❌ | Teks footer embed |

Jika `nama` sudah ada → teks embed yang sudah dikirim akan diupdate.
Jika baru → embed dikirim ke channel tempat command dipakai.

**`/button-edit`** — Administrator
Pasang atau edit tombol role pada embed. Maksimal **6 tombol**, 5 tombol per baris.

| Opsi | Wajib | Keterangan |
|---|---|---|
| `nama` | ✅ | Embed yang ingin diberi tombol (autocompletion) |
| `button1`–`button6` | ❌ | Role untuk tombol ke-1 sampai ke-6 |
| `label1`–`label6` | ❌ | Teks & emoji tombol. Contoh: `👦 Teen`, `<:nama:123>` |

Tombol & label harus berpasangan. Jika salah satu kosong, tombol itu dilewati.
Saat tombol diklik, bot kasih role tersebut ke member. **Member hanya bisa memilih
satu tombol** — begitu sudah punya salah satu role dari pilihan itu, tidak bisa
milih lagi.

#### Manajemen Role

**`/role`** — Manage Roles

| Subcommand | Keterangan |
|---|---|
| `/role give <user> <role>` | Kasih role ke member |
| `/role create <nama> <warna> [permissions]` | Bikin role baru |
| `/role delete <role>` | Hapus role dari server |

Pencegahan bawaan: bot tidak bisa kasih/hapus role yang posisinya sama atau lebih
tinggi dari role tertinggi bot. Hal yang sama berlaku untuk role pengguna, kecuali
pemilik server. Role `@everyone`, role integrasi/managed, dan role yang lebih tinggi
dari kamu tidak bisa dihapus.

#### Moderasi & Sistem Warn

**`/warn <user> <reason>`** — Manage Messages
Beri warn ke member. Tidak bisa memberi warn ke diri sendiri atau ke bot.

**`/warn-list`** — Manage Messages
Lihat daftar member yang memiliki warn, diurutkan dari jumlah terbanyak (maks 25).

**`/warn-log <channel>`** — Manage Guild
Atur channel untuk log setiap pelanggaran & tindakan warn.

**`/warn-reset <user>`** — Manage Messages
Reset seluruh warn member menjadi 0.

**`/warn-safe-channel <channel>`** — Manage Guild
Tetapkan **satu channel** yang bebas dari deteksi warn otomatis. Berguna untuk
channel administrasi atau channel khusus. Hanya ada satu channel aman per server.

#### Voice Sementara (Join to Create)

**`/voice-setup`** — Manage Channels

| Subcommand | Keterangan |
|---|---|
| `/voice-setup set <channel>` | Pilih voice pemicu. Saat member masuk, bot bikin voice baru |
| `/voice-setup off` | Matikan pembuatan voice sementara |
| `/voice-setup status` | Lihat voice pemicu & jumlah voice aktif |

- Nama voice sementara otomatis pakai display name member, contoh: `Voice Holis`
- Maksimal **5 voice sementara** per server. Jika sudah penuh, member yang masuk
  akan dikeluarkan dari voice pemicu
- Voice dihapus otomatis setelah member terakhir keluar
- Saat bot restart, voice sementara yang kosong langsung dibersihkan
- Karakter terlarang (`\ / : * ? " < > |`) dihilangkan dari nama, maksimal 80 karakter

#### Auto-Delete Channel

**`/clear-message <channel>`** — Manage Messages
Aktifkan/nonaktifkan auto-delete di channel tertentu. Semua pesan user di channel
itu akan langsung dihapus.

**`/delety <channel>`** — Manage Messages
Hampir sama dengan `/clear-message`, tapi tidak bisa dipakai di channel yang
sudah aktif. Untuk mematikan, gunakan `/delety-turn-off`.

**`/delety-turn-off`** — Manage Messages
Matikan semua channel yang diaktifkan lewat `/delety`.

**`/delety-delay <channel>`** — Manage Messages
Set/unset channel agar pesan terhapus otomatis **dengan delay**:
- Pesan **user** dihapus dalam **5 detik**
- Pesan **bot** dihapus dalam **3 detik**

#### Utilitas

**`/ping`** — semua member
Cek latency bot & API Discord.

---

## 🛡️ Deteksi Otomatis

Berjalan di setiap pesan, kecuali untuk moderator (permission Manage Messages),
di channel aman (`/warn-safe-channel`), atau saat memakai prefix command.

### 1. Link Terlarang

Dihapus jika mengandung:

- URL apa pun (`http://`, `https://`)
- `www.` domain
- Discord invite: `discord.gg/xxx`, `discord.com/invite/xxx`,
  `discordapp.com/invite/xxx`

### 2. Kata Kasar

Pesan di-**normalisasi** dulu untuk mencegah bypass, baru dicocokkan dengan daftar kata:

1. Unicode di-normalisasi (NFKD), dihapuskan diakritik/aksennya
2. Dikonversi ke huruf kecil
3. Leetspeak diterjemahkan: `4/@`→a, `3`→e, `1/!/|`→i, `0`→o, `5/$`→s, `7`→t
4. Huruf yang diulang 3+ kali dirapatkan jadi 2 (contoh: `fuuccckkk` → `fuucck`)

Daftar kata mencakup:

- **Indonesia/Melayu**: anjing, anjir, anjay, bangsat, bajingan, kontol, memek,
  ngentot, goblok, tolol, bodoh, kampret, jancok, jancuk, cok, asu, babi, tai, taik,
  peler, pepek, lonte, sundal, keparat, brengsek
- **Inggris**: fuck, fucker, fucking, motherfucker, shit, bullshit, bitch, asshole,
  bastard, dickhead, cunt, slut, whore, retard
- **Lainnya**: puta, puto, mierda, cabron, pendejo, idiota (Spanyol); merde, connard,
  salope (Prancis); scheisse, arschloch (Jerman); kurwa, blyat (Polandia/Rusia)

### 3. Sistem Punishment

Setiap pelanggaran member dapat warn otomatis:

| Jumlah Warn | Tindakan |
|---|---|
| 1–2 | Hanya warn + notifikasi di channel |
| 3 | **Timeout 30 menit** |
| 4 | Hanya warn |
| 5 | **Kick otomatis** |

Notifikasi pelanggaran dihapus otomatis setelah **8 detik**.
Semua tindakan dicatat di channel log (jika sudah diatur lewat `/warn-log`).

---

## 🗃️ Format Database

### `embeds.json`

```json
{
  "GENDER": {
    "channelId": "1522598040744104048",
    "messageId": "1524934876296511631",
    "title": "PICK GENDER WITH BUTTON",
    "description": "--------------------------------------------------\n----✦\n\n# ~",
    "color": "#FF0000",
    "footer": null,
    "buttons": [
      { "roleId": "1522598XXXXXXXXXXXX", "label": "MALE", "emoji": null }
    ]
  }
}
```

### `warnings.json`

```json
{
  "guilds": {
    "1496773664748732446": {
      "logChannelId": null,
      "safeChannelId": "1496773666451750944",
      "users": {
        "1425924622666436690": {
          "count": 5,
          "history": [
            {
              "reason": "Menggunakan kata kasar atau menghina (KATA_KASAR)",
              "moderatorId": "152243XXXXXXXXXXXXX",
              "source": "AUTO",
              "timestamp": "2026-09-18T08:30:00.000Z"
            }
          ]
        }
      }
    }
  }
}
```

`source` bernilai `AUTO` (dari deteksi otomatis) atau `MANUAL` (dari moderator).
History dibatasi maksimal **20 entri** per member. `moderatorId` berisi ID bot
untuk pelanggaran otomatis.

### `temporaryVoiceChannels.json`

```json
{
  "guilds": { "1496773664748732446": { "triggerChannelId": "1525099868673278164" } },
  "channels": []
}
```

`guilds` menyimpan voice pemicu per server. `channels` adalah daftar ID voice
sementara yang sedang aktif.

### `autoDeleteChannels.json` & `delayDeleteChannels.json`

```json
{ "channels": [] }
```

Array berisi ID channel yang sedang aktif.

---

## ⚙️ Konfigurasi di Kode

Beberapa nilai bisa diubah langsung di `index.js`:

| Baris | Variabel | Nilai Default | Keterangan |
|---|---|---|---|
| 15 | `PREFIXES` | `['!', '?']` | Prefix untuk prefix command |
| 49 | `MAX_WARNS` | `5` | Jumlah warn sebelum di-kick |
| 50 | `MUTE_AT_WARN` | `3` | Jumlah warn yang memicu timeout |
| 51 | `MUTE_DURATION_MS` | `1800000` | Durasi timeout (30 menit) |
| 184 | `MAX_TEMPORARY_VOICE_CHANNELS` | `5` | Maksimal voice sementara per server |

Daftar kata kasar ada di baris **55–68** (`PROFANITY_WORDS`).

---

## 📝 Catatan & Tips

- **Penting**: taruh role bot di **posisi paling atas** dari daftar role server,
  supaya bisa mengelola role lain dan memberikan timeout/kick
- Slash command didaftarkan **global** (`Routes.applicationCommands`), jadi butuh
  waktu sampai 1 jam untuk muncul. Jika hanya untuk satu server, ubah ke
  `Routes.applicationGuildCommands(client.user.id, GUILD_ID)` biar instan
- Bot memakai satu file `index.js`. Masih oke untuk skala saat ini, tapi jika
  fitur bertambah, sebaiknya pisahkan ke folder `commands/` dan `events/`
- Tidak ada error handler global (`process.on('unhandledRejection')`). Bot bisa
  crash jika terjadi error tidak tertangkap — sebaiknya ditambahkan
- File `.env` berisi token asli. **Jangan pernah** commit atau share file ini.
  Jika token bocor, segera regenerate di Developer Portal
- Restart bot tidak menghapus data. Tapi selalu backup folder ini sebelum
  mengedit file JSON secara manual
