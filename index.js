require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const PREFIXES = ['!', '?'];
const dbPath = path.join(__dirname, 'embeds.json');
const autoDeleteDbPath = path.join(__dirname, 'autoDeleteChannels.json');
const delayDeleteDbPath = path.join(__dirname, 'delayDeleteChannels.json');
const temporaryVoiceDbPath = path.join(__dirname, 'temporaryVoiceChannels.json');
const warnDbPath = path.join(__dirname, 'warnings.json');

// Database warn per server. Data tetap tersimpan setelah bot restart.
let warnData = { guilds: {} };
if (fs.existsSync(warnDbPath)) {
    try {
        const data = JSON.parse(fs.readFileSync(warnDbPath, 'utf8'));
        warnData = data && typeof data === 'object' && data.guilds ? data : { guilds: {} };
    } catch (error) {
        console.error('Gagal membaca warnings.json:', error);
    }
}

function saveWarnData() {
    fs.writeFileSync(warnDbPath, JSON.stringify(warnData, null, 2), 'utf8');
}

function getWarnGuildData(guildId) {
    if (!warnData.guilds[guildId]) {
        warnData.guilds[guildId] = { logChannelId: null, safeChannelId: null, users: {} };
    }

    const guildData = warnData.guilds[guildId];
    if (!guildData.users || typeof guildData.users !== 'object') guildData.users = {};
    if (!Object.prototype.hasOwnProperty.call(guildData, 'logChannelId')) guildData.logChannelId = null;
    if (!Object.prototype.hasOwnProperty.call(guildData, 'safeChannelId')) guildData.safeChannelId = null;
    return guildData;
}

const MAX_WARNS = 5;
const MUTE_AT_WARN = 3;
const MUTE_DURATION_MS = 30 * 60 * 1000;

// Daftar konservatif: hanya kata utuh yang cocok setelah normalisasi.
// Tambahkan kata baru dengan hati-hati agar tidak memicu false positive.
const PROFANITY_WORDS = new Set([
    // Indonesia / Melayu
    'anjing', 'anjir', 'anjay', 'bangsat', 'bajingan', 'kontol', 'memek', 'ngentot',
    'goblok', 'tolol', 'bodoh', 'kampret', 'jancok', 'jancuk', 'cok', 'asu', 'babi',
    'tai', 'taik', 'peler', 'pepek', 'lonte', 'sundal', 'keparat', 'brengsek',
    // English
    'fuck', 'fucker', 'fucking', 'motherfucker', 'shit', 'bullshit', 'bitch', 'asshole',
    'bastard', 'dickhead', 'cunt', 'slut', 'whore', 'retard',
    // Beberapa bahasa internasional umum
    'puta', 'puto', 'mierda', 'cabron', 'pendejo', 'idiota',
    'merde', 'connard', 'salope',
    'scheisse', 'arschloch',
    'kurwa', 'blyat'
]);

function normalizeModerationText(input) {
    return String(input || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[@4]/g, 'a')
        .replace(/[3]/g, 'e')
        .replace(/[1!|]/g, 'i')
        .replace(/[0]/g, 'o')
        .replace(/[5$]/g, 's')
        .replace(/[7]/g, 't')
        .replace(/(.)\1{2,}/g, '$1$1');
}

function detectViolation(content) {
    const raw = String(content || '');
    const linkRegex = /(?:https?:\/\/|www\.)[^\s<]+|(?:discord\.gg|discord(?:app)?\.com\/invite)\/[A-Za-z0-9-]+/i;
    if (linkRegex.test(raw)) {
        return { type: 'LINK', reason: 'Mengirim link yang tidak diizinkan' };
    }

    const normalized = normalizeModerationText(raw);
    const tokens = normalized.match(/[a-z]+/g) || [];
    const found = tokens.find(token => PROFANITY_WORDS.has(token));
    if (found) {
        return { type: 'KATA_KASAR', reason: 'Menggunakan kata kasar atau menghina' };
    }

    return null;
}

async function sendWarnLog(guild, payload) {
    const guildData = getWarnGuildData(guild.id);
    if (!guildData.logChannelId) return;

    try {
        const channel = await guild.channels.fetch(guildData.logChannelId);
        if (!channel || !channel.isTextBased()) return;

        const embed = new EmbedBuilder()
            .setTitle(payload.title || '⚠️ Moderation Log')
            .setColor(payload.color || '#f1c40f')
            .addFields(
                { name: 'User', value: payload.userId ? `<@${payload.userId}> (\`${payload.userId}\`)` : '-', inline: false },
                { name: 'Warn', value: payload.warnCount != null ? `**${payload.warnCount}/${MAX_WARNS}**` : '-', inline: true },
                { name: 'Tindakan', value: payload.action || 'Warn', inline: true },
                { name: 'Alasan', value: String(payload.reason || '-').slice(0, 1024), inline: false }
            )
            .setTimestamp();

        if (payload.moderatorId) {
            embed.addFields({ name: 'Moderator', value: `<@${payload.moderatorId}>`, inline: false });
        }
        await channel.send({ embeds: [embed] });
    } catch (error) {
        console.error('Gagal mengirim warn log:', error);
    }
}

async function applyWarn({ guild, member, reason, moderatorId = null, source = 'MANUAL' }) {
    const guildData = getWarnGuildData(guild.id);
    const userId = member.id;
    const current = guildData.users[userId] || { count: 0, history: [] };

    current.count = Math.min((Number(current.count) || 0) + 1, MAX_WARNS);
    current.history = Array.isArray(current.history) ? current.history : [];
    current.history.push({
        reason: String(reason || 'Tidak ada alasan').slice(0, 500),
        moderatorId,
        source,
        timestamp: new Date().toISOString()
    });
    if (current.history.length > 20) current.history = current.history.slice(-20);
    guildData.users[userId] = current;
    saveWarnData();

    let action = 'Warn diberikan';
    let actionError = null;

    if (current.count >= MAX_WARNS) {
        action = 'Kick otomatis';
        try {
            if (!member.kickable) throw new Error('Member tidak dapat di-kick oleh bot');
            await member.kick(`Mencapai ${MAX_WARNS} warn. Pelanggaran terakhir: ${reason}`);
        } catch (error) {
            actionError = error.message;
            action = 'Kick gagal';
        }
    } else if (current.count === MUTE_AT_WARN) {
        action = 'Timeout 30 menit';
        try {
            if (!member.moderatable) throw new Error('Member tidak dapat di-timeout oleh bot');
            await member.timeout(MUTE_DURATION_MS, `Mencapai ${MUTE_AT_WARN} warn. Pelanggaran terakhir: ${reason}`);
        } catch (error) {
            actionError = error.message;
            action = 'Timeout gagal';
        }
    }

    await sendWarnLog(guild, {
        title: source === 'AUTO' ? '🚨 Pelanggaran Terdeteksi' : '⚠️ Warn Manual',
        userId,
        warnCount: current.count,
        action: actionError ? `${action}: ${actionError}` : action,
        reason,
        moderatorId,
        color: current.count >= MAX_WARNS ? '#e74c3c' : current.count >= MUTE_AT_WARN ? '#e67e22' : '#f1c40f'
    });

    return { count: current.count, action, actionError };
}

// Konfigurasi fitur voice sementara (Join to Create).
// Maksimal 5 voice sementara aktif untuk setiap server.
const MAX_TEMPORARY_VOICE_CHANNELS = 5;
let temporaryVoiceData = { guilds: {}, channels: [] };
if (fs.existsSync(temporaryVoiceDbPath)) {
    try {
        const data = JSON.parse(fs.readFileSync(temporaryVoiceDbPath, 'utf8'));
        temporaryVoiceData = {
            guilds: data.guilds && typeof data.guilds === 'object' ? data.guilds : {},
            channels: Array.isArray(data.channels) ? data.channels : []
        };
    } catch (e) {
        console.error('Gagal membaca temporaryVoiceChannels.json:', e);
    }
}

const temporaryVoiceChannels = new Set(temporaryVoiceData.channels);
const voiceCreationLocks = new Set();

// Channel yang diaktifkan untuk auto-delete akan disimpan di file ini,
// jadi tidak hilang walaupun bot restart.
let autoDeleteChannels = new Set();
if (fs.existsSync(autoDeleteDbPath)) {
    try {
        const data = JSON.parse(fs.readFileSync(autoDeleteDbPath, 'utf8'));
        autoDeleteChannels = new Set(Array.isArray(data.channels) ? data.channels : []);
    } catch (e) {
        console.error('Gagal membaca autoDeleteChannels.json:', e);
    }
}

// Channel yang diaktifkan untuk delete-delay akan disimpan di file ini,
// jadi tidak hilang walaupun bot restart.
let delayDeleteChannels = new Set();
if (fs.existsSync(delayDeleteDbPath)) {
    try {
        const data = JSON.parse(fs.readFileSync(delayDeleteDbPath, 'utf8'));
        delayDeleteChannels = new Set(Array.isArray(data.channels) ? data.channels : []);
    } catch (e) {
        console.error('Gagal membaca delayDeleteChannels.json:', e);
    }
}

let embedCollection = new Map();
if (fs.existsSync(dbPath)) {
    try {
        const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        embedCollection = new Map(Object.entries(data));
    } catch (e) {
        console.error(e);
    }
}

function saveDatabase() {
    const obj = Object.fromEntries(embedCollection);
    fs.writeFileSync(dbPath, JSON.stringify(obj, null, 2), 'utf8');
}

function saveAutoDeleteChannels() {
    fs.writeFileSync(
        autoDeleteDbPath,
        JSON.stringify({ channels: Array.from(autoDeleteChannels) }, null, 2),
        'utf8'
    );
}

function saveDelayDeleteChannels() {
    fs.writeFileSync(
        delayDeleteDbPath,
        JSON.stringify({ channels: Array.from(delayDeleteChannels) }, null, 2),
        'utf8'
    );
}

function saveTemporaryVoiceData() {
    temporaryVoiceData.channels = Array.from(temporaryVoiceChannels);
    fs.writeFileSync(temporaryVoiceDbPath, JSON.stringify(temporaryVoiceData, null, 2), 'utf8');
}

function getGuildTemporaryVoiceCount(guild) {
    return guild.channels.cache.filter(channel => temporaryVoiceChannels.has(channel.id)).size;
}

async function deleteTemporaryVoiceIfEmpty(channel) {
    if (!channel || !temporaryVoiceChannels.has(channel.id)) return;
    if (channel.members.size > 0) return;

    temporaryVoiceChannels.delete(channel.id);
    saveTemporaryVoiceData();

    try {
        await channel.delete('Voice sementara kosong, jadi dihapus otomatis');
    } catch (error) {
        if (error.code !== 10003) {
            console.error('Gagal menghapus voice sementara:', error);
        }
    }
}

function scheduleDeleteMessage(message) {
    if (!message || !message.deletable) return;

    const delayMs = message.author?.bot ? 3000 : 5000;

    setTimeout(async () => {
        try {
            if (message.deletable) await message.delete();
        } catch (error) {
            if (error.code !== 10008) {
                console.error('Gagal menghapus pesan delay-delete:', error);
            }
        }
    }, delayMs);
}

function canDeleteRole(guildMember, botMember, role) {
    if (!role) return { ok: false, reason: 'Role tidak ditemukan.' };
    if (role.managed) return { ok: false, reason: 'Role ini managed/integrasi, jadi tidak bisa dihapus manual.' };
    if (role.id === role.guild.id) return { ok: false, reason: 'Role @everyone tidak bisa dihapus.' };
    if (guildMember && role.position >= guildMember.roles.highest.position && guildMember.id !== role.guild.ownerId) {
        return { ok: false, reason: 'Posisi role itu lebih tinggi atau sama dengan role kamu.' };
    }
    if (botMember && role.position >= botMember.roles.highest.position) {
        return { ok: false, reason: 'Posisi role itu lebih tinggi atau sama dengan role bot.' };
    }
    return { ok: true };
}


function resolvePermission(str) {
    if (!str) return [];
    const upper = str.toUpperCase().replace(/_/g, '');
    if (['ADMINISTRATOR', 'ADMIN'].includes(upper)) return [PermissionFlagsBits.Administrator];
    if (['MANAGEMESSAGES', 'MANAGE_MESSAGES'].includes(upper)) return [PermissionFlagsBits.ManageMessages];
    if (['MANAGECHANNELS', 'MANAGE_CHANNELS'].includes(upper)) return [PermissionFlagsBits.ManageChannels];
    if (['MANAGEROLES', 'MANAGE_ROLES'].includes(upper)) return [PermissionFlagsBits.ManageRoles];
    if (['KICK', 'KICKMEMBERS'].includes(upper)) return [PermissionFlagsBits.KickMembers];
    if (['BAN', 'BANMEMBERS'].includes(upper)) return [PermissionFlagsBits.BanMembers];
    return [];
}

function parseEmojiAndLabel(inputString) {
    if (!inputString) return { label: null, emoji: null };
    
    const customEmojiRegex = /^<(a)?:(\w+):(\d+)>/;
    const customMatch = inputString.match(customEmojiRegex);
    
    if (customMatch) {
        const fullEmoji = customMatch[0];
        const labelText = inputString.replace(fullEmoji, '').trim();
        return { label: labelText || ' ', emoji: fullEmoji };
    }
    
    const unicodeEmojiRegex = /^([\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}])/u;
    const unicodeMatch = inputString.match(unicodeEmojiRegex);
    
    if (unicodeMatch) {
        const emoji = unicodeMatch[1];
        const labelText = inputString.replace(emoji, '').trim();
        return { label: labelText || ' ', emoji: emoji };
    }
    
    return { label: inputString, emoji: null };
}

const setupCommand = new SlashCommandBuilder()
    .setName('setup-embed')
    .setDescription('Bikin baru atau edit isi teks embed dengan gaya aesthetic')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option => option.setName('nama').setDescription('Nama unik sebagai ID embed').setRequired(true).setAutocomplete(true))
    .addStringOption(option => option.setName('title').setDescription('Judul dari embed').setRequired(false))
    .addStringOption(option => option.setName('deskripsi').setDescription('Isi deskripsi embed (Gunakan \\n untuk baris baru)').setRequired(false))
    .addStringOption(option => option.setName('warna').setDescription('Kode HEX warna (Contoh: #FF0000)').setRequired(false))
    .addStringOption(option => option.setName('footer').setDescription('Teks footer embed').setRequired(false));

const buttonEditCommand = new SlashCommandBuilder()
    .setName('button-edit')
    .setDescription('Pasang atau edit susunan tombol role pada embed (Maks 6 tombol)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option => option.setName('nama').setDescription('Pilih nama embed yang mau dipasang tombol').setRequired(true).setAutocomplete(true));

for (let i = 1; i <= 6; i++) {
    buttonEditCommand.addRoleOption(option => option.setName(`button${i}`).setDescription(`Role buat tombol ke-${i}`).setRequired(false));
    buttonEditCommand.addStringOption(option => option.setName(`label${i}`).setDescription(`Teks & Emoji tombol ke-${i} (Contoh: 👦 Teen)`).setRequired(false));
}

const roleCommand = new SlashCommandBuilder()
    .setName('role')
    .setDescription('Pengaturan dan manajemen role server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(sub =>
        sub.setName('give')
            .setDescription('Ngasih role ke member')
            .addUserOption(option => option.setName('user').setDescription('Pilih member').setRequired(true))
            .addRoleOption(option => option.setName('role').setDescription('Pilih role').setRequired(true))
    )
    .addSubcommand(sub =>
        sub.setName('create')
            .setDescription('Bikin role baru di server')
            .addStringOption(option => option.setName('nama').setDescription('Nama role baru').setRequired(true))
            .addStringOption(option => option.setName('warna').setDescription('Kode HEX warna role (Contoh: #FF0000)').setRequired(true))
            .addStringOption(option => option.setName('permissions').setDescription('Permission utama (Contoh: Administrator, ManageMessages, None)').setRequired(false))
    )
    .addSubcommand(sub =>
        sub.setName('delete')
            .setDescription('Hapus role dari server')
            .addRoleOption(option => option.setName('role').setDescription('Pilih role yang mau dihapus').setRequired(true))
    );

const warnCommand = new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Berikan warn kepada member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(option => option.setName('user').setDescription('Member yang akan diberi warn').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Alasan warn').setRequired(true).setMaxLength(500));

const warnListCommand = new SlashCommandBuilder()
    .setName('warn-list')
    .setDescription('Lihat daftar member yang memiliki warn')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

const warnLogCommand = new SlashCommandBuilder()
    .setName('warn-log')
    .setDescription('Atur channel untuk log pelanggaran dan tindakan warn')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(option =>
        option.setName('channel')
            .setDescription('Channel tujuan log warn')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
    );

const warnResetCommand = new SlashCommandBuilder()
    .setName('warn-reset')
    .setDescription('Reset seluruh warn member menjadi 0')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(option =>
        option.setName('user')
            .setDescription('Member yang warn-nya ingin direset')
            .setRequired(true)
    );

const warnSafeChannelCommand = new SlashCommandBuilder()
    .setName('warn-safe-channel')
    .setDescription('Tetapkan satu channel yang bebas dari deteksi warn otomatis')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(option =>
        option.setName('channel')
            .setDescription('Channel yang akan dibebaskan dari warn otomatis')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
    );

const voiceSetupCommand = new SlashCommandBuilder()
    .setName('voice-setup')
    .setDescription('Atur sistem voice sementara (maksimal 5 voice)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand(sub =>
        sub.setName('set')
            .setDescription('Pilih voice yang menjadi tombol Join to Create')
            .addChannelOption(option =>
                option.setName('channel')
                    .setDescription('Voice pemicu untuk membuat voice sementara')
                    .setRequired(true)
                    .addChannelTypes(ChannelType.GuildVoice)
            )
    )
    .addSubcommand(sub =>
        sub.setName('off')
            .setDescription('Matikan pembuatan voice sementara di server ini')
    )
    .addSubcommand(sub =>
        sub.setName('status')
            .setDescription('Lihat pengaturan dan jumlah voice sementara')
    );

const commands = [
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Memunculkan latency dan kecepatan bot'),
    new SlashCommandBuilder()
        .setName('clear-message')
        .setDescription('Aktifkan/nonaktifkan hapus pesan otomatis di channel tertentu')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addChannelOption(option => 
            option.setName('channel')
                .setDescription('Pilih channel yang mau di-set')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText)
        ),
    new SlashCommandBuilder()
        .setName('delety')
        .setDescription('Nyalakan auto-delete pesan user di channel tertentu')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Pilih channel yang mau dibuat auto-delete')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText)
        ),
    new SlashCommandBuilder()
        .setName('delety-turn-off')
        .setDescription('Matikan semua channel yang aktif dari command /delety')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    new SlashCommandBuilder()
        .setName('delety-delay')
        .setDescription('Set/unset channel agar pesan user/bot terhapus otomatis dengan delay')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Pilih channel yang mau dibuat delete-delay')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText)
        ),
    setupCommand,
    buttonEditCommand,
    roleCommand,
    warnCommand,
    warnListCommand,
    warnLogCommand,
    warnResetCommand,
    warnSafeChannelCommand,
    voiceSetupCommand
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('ready', async () => {
    console.log(`🤖 Bot telah online sebagai ${client.user.tag}!`);
    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );
    } catch (error) {
        console.error(error);
    }

    // Bersihkan ID channel lama dan hapus voice sementara yang kosong setelah restart.
    for (const channelId of Array.from(temporaryVoiceChannels)) {
        try {
            const channel = await client.channels.fetch(channelId);
            if (!channel || channel.type !== ChannelType.GuildVoice) {
                temporaryVoiceChannels.delete(channelId);
                continue;
            }
            await deleteTemporaryVoiceIfEmpty(channel);
        } catch (error) {
            if (error.code === 10003) temporaryVoiceChannels.delete(channelId);
            else console.error('Gagal mengecek voice sementara saat startup:', error);
        }
    }
    saveTemporaryVoiceData();
});

client.on('interactionCreate', async interaction => {
    if (interaction.isAutocomplete()) {
        if (interaction.commandName === 'setup-embed' || interaction.commandName === 'button-edit') {
            const focusedValue = interaction.options.getFocused();
            const choices = Array.from(embedCollection.keys());
            const filtered = choices.filter(choice => choice.toLowerCase().includes(focusedValue.toLowerCase())).slice(0, 25);
            await interaction.respond(filtered.map(choice => ({ name: choice, value: choice })));
        }
        return;
    }

    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'ping') {
            const sent = await interaction.reply({ content: 'Memperhitungkan ping...', fetchReply: true });
            const botLatency = sent.createdTimestamp - interaction.createdTimestamp;
            const apiLatency = Math.round(client.ws.ping);
            await interaction.editReply(`🏓 **Pong!**\n• Kecepatan Balas Bot: \`${botLatency}ms\`\n• Latency API Discord: \`${apiLatency}ms\``);
        }

        if (interaction.commandName === 'voice-setup') {
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'set') {
                const triggerChannel = interaction.options.getChannel('channel');
                temporaryVoiceData.guilds[interaction.guildId] = {
                    triggerChannelId: triggerChannel.id
                };
                saveTemporaryVoiceData();

                await interaction.reply({
                    content: `✅ Voice pemicu berhasil diatur ke ${triggerChannel}. Saat member masuk, bot akan membuat voice sementara (maksimal **${MAX_TEMPORARY_VOICE_CHANNELS}**).`,
                    ephemeral: true
                });
            }

            if (subcommand === 'off') {
                delete temporaryVoiceData.guilds[interaction.guildId];
                saveTemporaryVoiceData();
                await interaction.reply({
                    content: '✅ Pembuatan voice sementara berhasil dimatikan. Voice sementara yang masih berisi member tidak akan dihapus sampai kosong.',
                    ephemeral: true
                });
            }

            if (subcommand === 'status') {
                const config = temporaryVoiceData.guilds[interaction.guildId];
                const total = getGuildTemporaryVoiceCount(interaction.guild);
                const triggerText = config ? `<#${config.triggerChannelId}>` : '**Belum diatur**';
                await interaction.reply({
                    content: `🎙️ Voice pemicu: ${triggerText}\n📊 Voice sementara aktif: **${total}/${MAX_TEMPORARY_VOICE_CHANNELS}**`,
                    ephemeral: true
                });
            }
        }

        if (interaction.commandName === 'clear-message') {
            const targetChannel = interaction.options.getChannel('channel');

            if (autoDeleteChannels.has(targetChannel.id)) {
                autoDeleteChannels.delete(targetChannel.id);
                saveAutoDeleteChannels();
                await interaction.reply({ content: `✅ Auto-delete di channel ${targetChannel} sudah **dinonaktifkan**.`, ephemeral: true });
            } else {
                autoDeleteChannels.add(targetChannel.id);
                saveAutoDeleteChannels();
                await interaction.reply({ content: `🔒 Auto-delete di channel ${targetChannel} berhasil **diaktifkan**. Semua pesan user di channel itu akan langsung dihapus.`, ephemeral: true });
            }
        }

        if (interaction.commandName === 'delety') {
            const targetChannel = interaction.options.getChannel('channel');

            if (autoDeleteChannels.has(targetChannel.id)) {
                return interaction.reply({ content: `⚠️ Auto-delete di channel ${targetChannel} sudah **aktif**. Kalau mau matiin, pakai \`/delety-turn-off\`.`, ephemeral: true });
            }

            autoDeleteChannels.add(targetChannel.id);
            saveAutoDeleteChannels();
            await interaction.reply({ content: `🔒 Auto-delete di channel ${targetChannel} berhasil **diaktifkan**. Semua pesan user di channel itu akan langsung dihapus.`, ephemeral: true });
        }

        if (interaction.commandName === 'delety-turn-off') {
            if (autoDeleteChannels.size === 0) {
                return interaction.reply({ content: '⚠️ Tidak ada channel auto-delete dari `/delety` yang sedang aktif.', ephemeral: true });
            }

            const totalChannels = autoDeleteChannels.size;
            autoDeleteChannels.clear();
            saveAutoDeleteChannels();

            await interaction.reply({ content: `✅ Auto-delete dari \`/delety\` berhasil **dimatikan** untuk **${totalChannels} channel**. Untuk menyalakan lagi, pakai \`/delety channel:\`.`, ephemeral: true });
        }

        if (interaction.commandName === 'delety-delay') {
            const targetChannel = interaction.options.getChannel('channel');

            if (delayDeleteChannels.has(targetChannel.id)) {
                delayDeleteChannels.delete(targetChannel.id);
                saveDelayDeleteChannels();
                await interaction.reply({ content: `✅ Delete-delay di channel ${targetChannel} sudah **dinonaktifkan**.`, ephemeral: true });
            } else {
                delayDeleteChannels.add(targetChannel.id);
                saveDelayDeleteChannels();
                await interaction.reply({ content: `⏳ Delete-delay di channel ${targetChannel} berhasil **diaktifkan**. Pesan user akan dihapus dalam 5 detik, pesan bot dalam 3 detik.`, ephemeral: true });
            }
        }

        if (interaction.commandName === 'warn-log') {
            const targetChannel = interaction.options.getChannel('channel');
            const guildData = getWarnGuildData(interaction.guildId);
            guildData.logChannelId = targetChannel.id;
            saveWarnData();
            await interaction.reply({ content: `✅ Channel log warn berhasil diatur ke ${targetChannel}.`, ephemeral: true });
        }

        if (interaction.commandName === 'warn-safe-channel') {
            const targetChannel = interaction.options.getChannel('channel');
            const guildData = getWarnGuildData(interaction.guildId);
            const previousChannelId = guildData.safeChannelId;

            guildData.safeChannelId = targetChannel.id;
            saveWarnData();

            const previousText = previousChannelId && previousChannelId !== targetChannel.id
                ? ` Channel aman sebelumnya <#${previousChannelId}> sudah diganti.`
                : '';

            await interaction.reply({
                content: `🛡️ ${targetChannel} sekarang **bebas dari deteksi warn otomatis**.${previousText}`,
                ephemeral: true
            });
        }

        if (interaction.commandName === 'warn-reset') {
            const targetUser = interaction.options.getUser('user', true);
            const guildData = getWarnGuildData(interaction.guildId);
            const existing = guildData.users[targetUser.id];
            const oldCount = Number(existing?.count) || 0;

            if (!existing || oldCount <= 0) {
                return interaction.reply({
                    content: `ℹ️ <@${targetUser.id}> tidak memiliki warn yang perlu direset.`,
                    ephemeral: true
                });
            }

            delete guildData.users[targetUser.id];
            saveWarnData();

            await sendWarnLog(interaction.guild, {
                title: '♻️ Warn Direset',
                userId: targetUser.id,
                warnCount: 0,
                action: 'Reset ke 0',
                reason: `Seluruh warn sebelumnya (${oldCount}/${MAX_WARNS}) telah dihapus`,
                moderatorId: interaction.user.id,
                color: '#2ecc71'
            });

            await interaction.reply({
                content: `✅ Warn <@${targetUser.id}> berhasil direset dari **${oldCount}/${MAX_WARNS}** menjadi **0/${MAX_WARNS}**.`,
                ephemeral: false
            });
        }

        if (interaction.commandName === 'warn') {
            const targetMember = interaction.options.getMember('user');
            const reason = interaction.options.getString('reason', true).trim();

            if (!targetMember || targetMember.user.bot) {
                return interaction.reply({ content: '❌ Target harus berupa member manusia yang masih ada di server.', ephemeral: true });
            }
            if (targetMember.id === interaction.user.id) {
                return interaction.reply({ content: '❌ Kamu tidak bisa memberi warn ke diri sendiri.', ephemeral: true });
            }

            const result = await applyWarn({
                guild: interaction.guild,
                member: targetMember,
                reason,
                moderatorId: interaction.user.id,
                source: 'MANUAL'
            });

            await interaction.reply({
                content: `<@${targetMember.id}> Aku kasih warn ⚠️ (**${result.count}/${MAX_WARNS}**) buat kamu, jangan di ulangin yaa sayang 🥰\nTindakan: **${result.action}**${result.actionError ? `\n❌ ${result.actionError}` : ''}`,
                ephemeral: false
            });
        }

        if (interaction.commandName === 'warn-list') {
            const guildData = getWarnGuildData(interaction.guildId);
            const entries = Object.entries(guildData.users)
                .filter(([, data]) => Number(data.count) > 0)
                .sort((a, b) => Number(b[1].count) - Number(a[1].count));

            if (entries.length === 0) {
                return interaction.reply({ content: '✅ Belum ada member yang memiliki warn.', ephemeral: true });
            }

            const lines = entries.slice(0, 25).map(([userId, data], index) => {
                const last = Array.isArray(data.history) && data.history.length ? data.history[data.history.length - 1] : null;
                const lastReason = last ? String(last.reason).replace(/\n/g, ' ').slice(0, 80) : '-';
                return `**${index + 1}.** <@${userId}> — **${data.count}/${MAX_WARNS}**\n└ ${lastReason}`;
            });

            const embed = new EmbedBuilder()
                .setTitle('📋 Daftar Warn Member')
                .setDescription(lines.join('\n'))
                .setColor('#f1c40f')
                .setFooter({ text: entries.length > 25 ? `Menampilkan 25 dari ${entries.length} member` : `${entries.length} member memiliki warn` })
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (interaction.commandName === 'setup-embed') {
            const nama = interaction.options.getString('nama');
            const rawTitle = interaction.options.getString('title');
            const rawDescription = interaction.options.getString('deskripsi');
            const color = interaction.options.getString('warna');
            const rawFooter = interaction.options.getString('footer');

            const title = rawTitle ? rawTitle.replace(/\\n/g, '\n') : null;
            const description = rawDescription ? rawDescription.replace(/\\n/g, '\n') : null;
            const footer = rawFooter ? rawFooter.replace(/\\n/g, '\n') : null;

            if (embedCollection.has(nama)) {
                const data = embedCollection.get(nama);
                
                if (title !== null) data.title = title;
                if (description !== null) data.description = description;
                if (color !== null) data.color = color.startsWith('#') ? color : `#${color}`;
                if (footer !== null) data.footer = footer;

                const embed = new EmbedBuilder()
                    .setTitle(data.title || ' ')
                    .setDescription(data.description || ' ')
                    .setColor(data.color || '#0099ff');
                if (data.footer) embed.setFooter({ text: data.footer });

                try {
                    const channel = await client.channels.fetch(data.channelId);
                    const message = await channel.messages.fetch(data.messageId);
                    await message.edit({ embeds: [embed], components: message.components });
                    
                    embedCollection.set(nama, data);
                    saveDatabase();
                    
                    await interaction.reply({ content: `🔥 Embed dengan nama **${nama}** berhasil diupdate isi teksnya bro!`, ephemeral: true });
                } catch (err) {
                    await interaction.reply({ content: '❌ Gagal mengedit pesan. Mungkin pesan asli udah kehapus atau bot gak punya akses ke channel itu.', ephemeral: true });
                }
            } else {
                const embedColor = color ? (color.startsWith('#') ? color : `#${color}`) : '#0099ff';
                const formattedDesc = description || 'Custom Description';
                
                const embed = new EmbedBuilder()
                    .setTitle(title || 'Custom Title')
                    .setDescription(formattedDesc)
                    .setColor(embedColor);
                if (footer) embed.setFooter({ text: footer });

                const sentMessage = await interaction.channel.send({ embeds: [embed] });
                
                embedCollection.set(nama, {
                    channelId: interaction.channelId,
                    messageId: sentMessage.id,
                    title: title || 'Custom Title',
                    description: formattedDesc,
                    color: embedColor,
                    footer: footer || null,
                    buttons: []
                });
                saveDatabase();

                await interaction.reply({ content: `✅ Embed baru dengan nama **${nama}** sukses dibuat dan dikirim ke channel ini!`, ephemeral: true });
            }
        }

        if (interaction.commandName === 'button-edit') {
            const nama = interaction.options.getString('nama');

            if (!embedCollection.has(nama)) {
                return interaction.reply({ content: `❌ Nama embed **${nama}** gak ketemu bro! Bikin dulu pakai \`/setup-embed\`.`, ephemeral: true });
            }

            const data = embedCollection.get(nama);
            const newButtonsData = [];
            const rows = [];
            let currentRow = new ActionRowBuilder();
            const buttonStyles = [ButtonStyle.Secondary, ButtonStyle.Secondary, ButtonStyle.Secondary, ButtonStyle.Secondary];

            for (let i = 1; i <= 6; i++) {
                const role = interaction.options.getRole(`button${i}`);
                const labelInput = interaction.options.getString(`label${i}`);

                if (role && labelInput) {
                    const { label, emoji } = parseEmojiAndLabel(labelInput);
                    newButtonsData.push({ roleId: role.id, label, emoji });

                    const style = buttonStyles[(i - 1) % buttonStyles.length];
                    const button = new ButtonBuilder()
                        .setCustomId(`role_click:${nama}:${role.id}`)
                        .setLabel(label)
                        .setStyle(style);

                    if (emoji) {
                        button.setEmoji(emoji);
                    }

                    currentRow.addComponents(button);

                    if (currentRow.components.length === 5) {
                        rows.push(currentRow);
                        currentRow = new ActionRowBuilder();
                    }
                }
            }

            if (currentRow.components.length > 0) {
                rows.push(currentRow);
            }

            try {
                const channel = await client.channels.fetch(data.channelId);
                const message = await channel.messages.fetch(data.messageId);
                
                await message.edit({ embeds: message.embeds, components: rows });

                data.buttons = newButtonsData;
                embedCollection.set(nama, data);
                saveDatabase();

                await interaction.reply({ content: `⚙️ Susunan tombol buat embed **${nama}** berhasil diperbarui!`, ephemeral: true });
            } catch (err) {
                await interaction.reply({ content: '❌ Gagal update tombol. Pastiin pesan utama di channel target belum terhapus.', ephemeral: true });
            }
        }

        if (interaction.commandName === 'role') {
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'give') {
                const targetMember = interaction.options.getMember('user');
                const targetRole = interaction.options.getRole('role');

                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
                    return interaction.reply({ content: '❌ Lu gak punya permission `Manage Roles` bro!', ephemeral: true });
                }

                if (targetRole.position >= interaction.guild.members.me.roles.highest.position) {
                    return interaction.reply({ content: '❌ Gak bisa bro, posisi role itu lebih tinggi atau sama dengan role milik bot!', ephemeral: true });
                }

                if (targetMember.roles.cache.has(targetRole.id)) {
                    return interaction.reply({ content: `⚠️ Member <@${targetMember.id}> udah punya role <@&${targetRole.id}> bro!`, ephemeral: true });
                }

                try {
                    await targetMember.roles.add(targetRole);
                    await interaction.reply({ content: `✅ Berhasil ngasih role <@&${targetRole.id}> ke <@${targetMember.id}>!`, ephemeral: true });
                } catch (error) {
                    console.error(error);
                    await interaction.reply({ content: '❌ Gagal ngasih role, cek posisi role bot di server settings!', ephemeral: true });
                }
            }

            if (subcommand === 'create') {
                const name = interaction.options.getString('nama');
                const colorInput = interaction.options.getString('warna');
                const permInput = interaction.options.getString('permissions');

                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
                    return interaction.reply({ content: '❌ Lu gak punya permission `Manage Roles` bro!', ephemeral: true });
                }

                const roleColor = colorInput.startsWith('#') ? colorInput : `#${colorInput}`;
                const rolePerms = resolvePermission(permInput);

                try {
                    const newRole = await interaction.guild.roles.create({
                        name: name,
                        color: roleColor,
                        permissions: rolePerms
                    });
                    await interaction.reply({ content: `✅ Berhasil membuat role baru: ${newRole} dengan warna \`${roleColor}\`!`, ephemeral: true });
                } catch (error) {
                    console.error(error);
                    await interaction.reply({ content: '❌ Gagal membuat role baru. Pastikan bot punya hak akses tertinggi!', ephemeral: true });
                }
            }

            if (subcommand === 'delete') {
                const targetRole = interaction.options.getRole('role');

                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
                    return interaction.reply({ content: '❌ Lu gak punya permission `Manage Roles` bro!', ephemeral: true });
                }

                const check = canDeleteRole(interaction.member, interaction.guild.members.me, targetRole);
                if (!check.ok) {
                    return interaction.reply({ content: `❌ Gagal hapus role: ${check.reason}`, ephemeral: true });
                }

                try {
                    const roleName = targetRole.name;
                    await targetRole.delete(`Dihapus oleh ${interaction.user.tag} lewat /role delete`);
                    await interaction.reply({ content: `🗑️ Role **${roleName}** berhasil dihapus!`, ephemeral: true });
                } catch (error) {
                    console.error(error);
                    await interaction.reply({ content: '❌ Gagal menghapus role. Pastikan bot punya permission dan posisi role bot paling atas!', ephemeral: true });
                }
            }
        }
    }

    if (interaction.isButton()) {
        if (interaction.customId.startsWith('role_click:')) {
            const [, nama, targetRoleId] = interaction.customId.split(':');
            const data = embedCollection.get(nama);

            if (!data) {
                return interaction.reply({ content: 'Waduh, data buat tombol ini gak kesimpen di database bot bro!', ephemeral: true });
            }

            const member = interaction.member;
            const allRoles = data.buttons.map(b => b.roleId);
            const hasAnyRole = allRoles.some(roleId => member.roles.cache.has(roleId));

            if (hasAnyRole) {
                return interaction.reply({ content: 'Gak bisa milih lagi mas! Lu udah punya salah satu role dari pilihan ini.', ephemeral: true });
            }

            try {
                await member.roles.add(targetRoleId);
                await interaction.reply({ content: `Mantap! Role <@&${targetRoleId}> udah resmi masuk ke profile lu!`, ephemeral: true });
            } catch (error) {
                console.error(error);
                await interaction.reply({ content: 'Waduh, bot gagal ngasih role. Pastiin posisi role milik bot ditaruh di paling atas dalam daftar settings role server!', ephemeral: true });
            }
        }
    }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    // Hapus voice sementara segera setelah member terakhir keluar/pindah.
    if (oldState.channelId && oldState.channelId !== newState.channelId) {
        await deleteTemporaryVoiceIfEmpty(oldState.channel);
    }

    const config = temporaryVoiceData.guilds[newState.guild.id];
    if (!config || newState.channelId !== config.triggerChannelId || !newState.member || newState.member.user.bot) return;

    // Lock per server mencegah jumlah channel melewati batas jika banyak member masuk bersamaan.
    while (voiceCreationLocks.has(newState.guild.id)) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    voiceCreationLocks.add(newState.guild.id);

    try {
        if (getGuildTemporaryVoiceCount(newState.guild) >= MAX_TEMPORARY_VOICE_CHANNELS) {
            try {
                await newState.disconnect('Batas maksimal 5 voice sementara sudah tercapai');
            } catch (error) {
                console.error('Gagal mengeluarkan member dari voice pemicu:', error);
            }
            return;
        }

        const triggerChannel = newState.channel;
        const displayName = newState.member.displayName
            .replace(/[\\/:*?"<>|]/g, '')
            .trim()
            .slice(0, 80) || 'Member';

        const temporaryChannel = await newState.guild.channels.create({
            name: `Voice ${displayName}`,
            type: ChannelType.GuildVoice,
            parent: triggerChannel.parentId,
            reason: `Voice sementara dibuat untuk ${newState.member.user.tag}`
        });

        temporaryVoiceChannels.add(temporaryChannel.id);
        saveTemporaryVoiceData();

        try {
            await newState.setChannel(temporaryChannel, 'Memindahkan member ke voice sementara');
        } catch (error) {
            console.error('Gagal memindahkan member ke voice sementara:', error);
            await deleteTemporaryVoiceIfEmpty(temporaryChannel);
        }
    } catch (error) {
        console.error('Gagal membuat voice sementara:', error);
    } finally {
        voiceCreationLocks.delete(newState.guild.id);
    }
});

client.on('messageCreate', async (message) => {
    if (autoDeleteChannels.has(message.channel.id) && !message.author.bot) {
        try {
            await message.delete();
            return;
        } catch (error) {
            console.error('Gagal menghapus pesan auto-delete:', error);
        }
    }

    if (delayDeleteChannels.has(message.channel.id)) {
        scheduleDeleteMessage(message);
    }

    if (message.author.bot) return;

    const prefix = PREFIXES.find(p => message.content.startsWith(p));

    // Deteksi otomatis hanya untuk member biasa. Moderator dan channel aman
    // dikecualikan agar pesan administrasi atau channel khusus tidak terkena warn.
    const warnGuildData = getWarnGuildData(message.guild.id);
    const isWarnSafeChannel = warnGuildData.safeChannelId === message.channel.id;

    if (!prefix && !isWarnSafeChannel && !message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        const violation = detectViolation(message.content);
        if (violation) {
            try {
                if (message.deletable) await message.delete();
            } catch (error) {
                if (error.code !== 10008) console.error('Gagal menghapus pesan pelanggaran:', error);
            }

            const result = await applyWarn({
                guild: message.guild,
                member: message.member,
                reason: `${violation.reason} (${violation.type})`,
                moderatorId: client.user.id,
                source: 'AUTO'
            });

            try {
                const notice = await message.channel.send({
                    content: `<@${message.author.id}> Aku kasih warn ⚠️ (**${result.count}/${MAX_WARNS}**) buat kamu, jangan di ulangin yaa sayang 🥰\nAlasan: **${violation.reason}**\nTindakan: **${result.action}**.`
                });
                setTimeout(() => notice.delete().catch(() => null), 8000);
            } catch (error) {
                console.error('Gagal mengirim pemberitahuan warn:', error);
            }
            return;
        }
    }

    if (!prefix) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'ping') {
        const msg = await message.reply('Memperhitungkan ping...');
        const botLatency = msg.createdTimestamp - message.createdTimestamp;
        const apiLatency = Math.round(client.ws.ping);
        await msg.edit(`🏓 **Pong!**\n - Kecepatan Balas Bot: \`${botLatency}ms\`\n - Latency API Discord: \`${apiLatency}ms\``);
    }

    if (command === 'warn') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return message.reply('❌ Kamu gak punya permission `Manage Messages` untuk memberi warn.');
        }

        const targetMember = message.mentions.members.first();
        const reason = args.slice(1).join(' ').trim();

        if (!targetMember || targetMember.user.bot) {
            return message.reply(`❌ Cara pakai: \`${prefix}warn @user <reason>\``);
        }
        if (!reason) {
            return message.reply(`❌ Alasan wajib diisi. Contoh: \`${prefix}warn @user Spam berulang\``);
        }
        if (targetMember.id === message.author.id) {
            return message.reply('❌ Kamu tidak bisa memberi warn ke diri sendiri.');
        }

        const result = await applyWarn({
            guild: message.guild,
            member: targetMember,
            reason,
            moderatorId: message.author.id,
            source: 'MANUAL'
        });

        return message.reply(`${targetMember} Aku kasih warn ⚠️ (**${result.count}/${MAX_WARNS}**) buat kamu, jangan di ulangin yaa sayang 🥰\nTindakan: **${result.action}**${result.actionError ? `\n❌ ${result.actionError}` : ''}`);
    }

    if (command === 'clear') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return message.reply('❌ Kamu gak punya permission `Manage Messages` buat pakai perintah ini bro!');
        }

        const amount = parseInt(args[0]);

        if (isNaN(amount)) {
            return message.reply('❌ Masukkan jumlah pesan yang mau dihapus dong. Contoh: `!clear 5`');
        } else if (amount < 1 || amount > 100) {
            return message.reply('❌ Kamu cuma bisa menghapus antara 1 sampai 100 pesan sekaligus ya!');
        }

        try {
            await message.delete();
            const deletedMessages = await message.channel.bulkDelete(amount, true);
            const successMsg = await message.channel.send(`🧹 Berhasil menghapus **${deletedMessages.size}** pesan terbaru!`);
            setTimeout(() => successMsg.delete().catch(() => null), 3000);
        } catch (error) {
            console.error(error);
            message.channel.send('❌ Ada error pas mau ngehapus pesan. Pastiin pesannya gak lebih lama dari 14 hari ya!');
        }
    }

    if (command === 'role') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return message.reply('❌ Lu gak punya permission `Manage Roles` bro!');
        }

        if (args[0] === 'delete') {
            const targetRole = message.mentions.roles.first();

            if (!targetRole) {
                return message.reply(`❌ Cara pakainya gini bro: \`${prefix}role delete @role\``);
            }

            const check = canDeleteRole(message.member, message.guild.members.me, targetRole);
            if (!check.ok) {
                return message.reply(`❌ Gagal hapus role: ${check.reason}`);
            }

            try {
                const roleName = targetRole.name;
                await targetRole.delete(`Dihapus oleh ${message.author.tag} lewat ${prefix}role delete`);
                await message.reply(`🗑️ Role **${roleName}** berhasil dihapus!`);
            } catch (error) {
                console.error(error);
                message.reply('❌ Gagal menghapus role. Pastikan bot punya permission dan posisi role bot paling atas!');
            }
            return;
        }

        if (args[0] === 'create') {
            const name = args[1];
            const colorInput = args[2];
            const permInput = args[3];

            if (!name || !colorInput) {
                return message.reply(`❌ Cara pakainya gini bro: \`${prefix}role create <NamaRole> <WarnaHex> [Permission]\`\nContoh: \`${prefix}role create Member VIP FF0000 Administrator\``);
            }

            const roleColor = colorInput.startsWith('#') ? colorInput : `#${colorInput}`;
            const rolePerms = resolvePermission(permInput);

            try {
                const newRole = await message.guild.roles.create({
                    name: name,
                    color: roleColor,
                    permissions: rolePerms
                });
                await message.reply(`✅ Berhasil membuat role baru: ${newRole} dengan warna \`${roleColor}\`!`);
            } catch (error) {
                console.error(error);
                message.reply('❌ Gagal membuat role baru, pastikan posisi role milik bot sudah paling atas!');
            }
            return;
        }

        const targetMember = message.mentions.members.first();
        const targetRole = message.mentions.roles.first();

        if (!targetMember || !targetRole) {
            return message.reply(`❌ Cara pakainya gini bro:\n• Kasih Role: \`${prefix}role @user @role\`\n• Bikin Role: \`${prefix}role create <Nama> <WarnaHex> [Permission]\`\n• Hapus Role: \`${prefix}role delete @role\``);
        }

        if (targetRole.position >= message.guild.members.me.roles.highest.position) {
            return message.reply('❌ Gak bisa bro, posisi role itu lebih tinggi atau sama dengan role milik bot!');
        }

        if (targetMember.roles.cache.has(targetRole.id)) {
            return message.reply(`⚠️ Member ${targetMember} udah punya role ${targetRole} bro!`);
        }

        try {
            await targetMember.roles.add(targetRole);
            await message.reply(`✅ Berhasil ngasih role ${targetRole} ke ${targetMember}!`);
        } catch (error) {
            console.error(error);
            message.reply('❌ Gagal ngasih role, cek posisi role bot di server settings!');
        }
    }
});

client.login(process.env.DISCORD_TOKEN);