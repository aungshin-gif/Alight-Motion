const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const { Telegraf, Markup } = require('telegraf');
const api = require('./api');
const orderCounter = require('./orderCounter');
const i18n = require('./i18n');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error('❌ FATAL: BOT_TOKEN belum diisi di file .env! Silakan masukkan token bot Anda dari @BotFather.');
}
const PORT = process.env.PORT || process.env.SERVER_PORT || 3000;
const API_BASE_URL = (process.env.API_BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/+$/, '');
const OWNER_ID = String(process.env.OWNER_ID || '');
const rawAdminId = process.env.ADMIN_ID || '';
const ADMIN_IDS = rawAdminId
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

let CHANNEL_ID = process.env.CHANNEL_ID || '';
if (CHANNEL_ID && /^\d+$/.test(String(CHANNEL_ID))) {
    CHANNEL_ID = `-${CHANNEL_ID}`;
}
let forceSubEnabled = true;
let isQueueOpen = true;

function isOwner(userId) {
    if (!userId || !OWNER_ID) return false;
    const uid = String(userId);
    return uid === OWNER_ID;
}

function isAdmin(userId) {
    if (!userId) return false;
    const uid = String(userId);
    return isOwner(uid) || ADMIN_IDS.includes(uid);
}

function escapeMarkdown(text) {
    if (!text) return '';
    return String(text).replace(/([_*`\[\]()])/g, '\\$1');
}

function safeFormatError(errMessage, lang = 'id') {
    const raw = String(errMessage || '');
    if (raw.includes('QUOTA_EXCEEDED') || raw.includes('Exceeded daily quota')) {
        return '⚠️ Kuota aktivasi Alight Motion global saat ini telah tercapai. Layanan akan otomatis dibuka kembali begitu kuota selesai direset.';
    }
    return escapeMarkdown(raw);
}

// Database Sederhana Pengguna Bot (data/bot_users.json)
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}
const USERS_FILE = path.join(DATA_DIR, 'bot_users.json');
const ROOT_USERS_FILE = path.join(__dirname, '..', 'bot_users.json');
let registeredUsers = new Set();

function loadRegisteredUsers() {
    try {
        if (fs.existsSync(ROOT_USERS_FILE)) {
            const rootRaw = fs.readFileSync(ROOT_USERS_FILE, 'utf-8');
            const rootData = JSON.parse(rootRaw);
            if (Array.isArray(rootData)) {
                rootData.forEach(id => registeredUsers.add(String(id)));
            }
        }
        if (fs.existsSync(USERS_FILE)) {
            const raw = fs.readFileSync(USERS_FILE, 'utf-8');
            const data = JSON.parse(raw);
            if (Array.isArray(data)) {
                data.forEach(id => registeredUsers.add(String(id)));
            }
        }
    } catch (e) {
        console.warn('⚠️ Gagal membaca bot_users.json:', e.message);
    }
    if (OWNER_ID) registeredUsers.add(OWNER_ID);
    ADMIN_IDS.forEach(id => registeredUsers.add(id));
    saveRegisteredUsers();
}

function saveRegisteredUsers() {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(Array.from(registeredUsers), null, 2), 'utf-8');
    } catch (e) {
        console.warn('⚠️ Gagal menyimpan bot_users.json:', e.message);
    }
}

function trackUser(userId) {
    if (!userId) return;
    const sId = String(userId);
    if (!registeredUsers.has(sId)) {
        registeredUsers.add(sId);
        saveRegisteredUsers();
    }
}
loadRegisteredUsers();

// -------------------------------------------------------------
// Database Bahasa Pengguna Bot (data/user_languages.json)
// -------------------------------------------------------------
const USER_LANGUAGES_FILE = path.join(DATA_DIR, 'user_languages.json');
const userLanguages = new Map();

function detectLanguageFromCode(code) {
    if (!code) return 'id';
    const low = String(code).toLowerCase();
    if (low.startsWith('id') || low.startsWith('in')) return 'id';
    if (low.startsWith('ms')) return 'ms';
    if (low.startsWith('fil') || low.startsWith('tl')) return 'fil';
    if (low.startsWith('ar')) return 'ar';
    if (low.startsWith('ru') || low.startsWith('uk') || low.startsWith('be')) return 'ru';
    if (low.startsWith('es')) return 'es';
    if (low.startsWith('hi')) return 'hi';
    if (low.startsWith('en')) return 'en';
    return 'id';
}

function loadUserLanguages() {
    try {
        if (fs.existsSync(USER_LANGUAGES_FILE)) {
            const raw = fs.readFileSync(USER_LANGUAGES_FILE, 'utf-8');
            const data = JSON.parse(raw);
            if (data && typeof data === 'object') {
                for (const [uid, lang] of Object.entries(data)) {
                    userLanguages.set(String(uid), String(lang));
                }
            }
        }
    } catch (e) {
        console.warn('⚠️ Gagal membaca user_languages.json:', e.message);
    }
}

function saveUserLanguages() {
    try {
        const obj = {};
        for (const [uid, lang] of userLanguages.entries()) {
            obj[uid] = lang;
        }
        fs.writeFileSync(USER_LANGUAGES_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (e) {
        console.warn('⚠️ Gagal menyimpan user_languages.json:', e.message);
    }
}

function getUserLang(userId, ctxFrom = null) {
    if (!userId) return 'id';
    const sId = String(userId);
    if (userLanguages.has(sId)) {
        return userLanguages.get(sId);
    }
    // Jika belum tersimpan, deteksi otomatis dari bahasa aplikasi Telegram pengguna
    if (ctxFrom && ctxFrom.language_code) {
        const detected = detectLanguageFromCode(ctxFrom.language_code);
        userLanguages.set(sId, detected);
        saveUserLanguages();
        return detected;
    }
    return 'id';
}

function setUserLang(userId, langCode) {
    if (!userId || !langCode) return;
    const sId = String(userId);
    userLanguages.set(sId, langCode);
    saveUserLanguages();
}
loadUserLanguages();

// -------------------------------------------------------------
// Database Status Pemeliharaan Sistem (data/maintenance.json)
// -------------------------------------------------------------
const MAINTENANCE_FILE = path.join(DATA_DIR, 'maintenance.json');
let isMaintenance = false;

function loadMaintenanceState() {
    try {
        if (fs.existsSync(MAINTENANCE_FILE)) {
            const raw = fs.readFileSync(MAINTENANCE_FILE, 'utf-8');
            const data = JSON.parse(raw);
            if (typeof data.isMaintenance === 'boolean') {
                isMaintenance = data.isMaintenance;
                if (isMaintenance) isQueueOpen = false;
            }
        }
    } catch (e) {
        console.warn('⚠️ Gagal membaca maintenance.json:', e.message);
    }
}

function saveMaintenanceState(active, by = 'ADMIN') {
    isMaintenance = !!active;
    if (isMaintenance) {
        isQueueOpen = false;
        if (typeof startAutoQuotaChecker === 'function') startAutoQuotaChecker();
    } else {
        if (typeof stopAutoQuotaChecker === 'function') stopAutoQuotaChecker();
    }
    try {
        fs.writeFileSync(MAINTENANCE_FILE, JSON.stringify({
            isMaintenance: isMaintenance,
            updatedAt: new Date().toISOString(),
            updatedBy: String(by)
        }, null, 2), 'utf-8');
    } catch (e) {
        console.warn('⚠️ Gagal menyimpan maintenance.json:', e.message);
    }
}
loadMaintenanceState();

if (!BOT_TOKEN || BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
    console.error('===========================================================');
    console.error('⚠️  PERINGATAN: BOT_TOKEN belum diisi di file .env!');
    console.error('===========================================================');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Tracking otomatis setiap pengguna yang berinteraksi dengan bot
bot.use(async (ctx, next) => {
    if (ctx.from && ctx.from.id) {
        trackUser(ctx.from.id);
        getUserLang(ctx.from.id, ctx.from);
    }
    return next();
});


// Global Safety Guard: Mencegah bot crash jika terjadi gangguan jaringan Pterodactyl / Telegram
process.on('uncaughtException', (err) => {
    console.error('🛡️ [Bot Guard] Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
    console.error('🛡️ [Bot Guard] Unhandled Rejection:', reason?.message || reason);
});

// Manajemen sesi pengguna
const userSessions = new Map();
const userBulkLock = new Set();
const userBulkStop = new Map();

function getSession(userId) {
    if (!userSessions.has(userId)) {
        userSessions.set(userId, { state: 'IDLE', data: {}, lastActive: Date.now() });
    }
    const session = userSessions.get(userId);
    session.lastActive = Date.now();
    return session;
}

function clearSession(userId) {
    userSessions.delete(userId);
}

// Auto-cleanup sesi tidak aktif setiap 15 menit (TTL 30 menit) agar memori RAM selalu stabil dan ringan
setInterval(() => {
    const now = Date.now();
    const TTL = 30 * 60 * 1000;
    for (const [userId, session] of userSessions.entries()) {
        if (session.lastActive && (now - session.lastActive > TTL)) {
            userSessions.delete(userId);
        }
    }
}, 15 * 60 * 1000).unref();

/**
 * Format sensor email untuk keamanan di channel publik (Variasi B)
 * Menyembunyikan nama user & sebagian nama domain untuk menjaga privasi provider.
 * Contoh: 
 * - oyebatman@guerrillamailblock.com -> oye***@gu***.com
 * - aufalmarom914@gmail.com -> auf***@gm***.com
 * - user@yahoo.co.id -> use***@ya***.co.id
 */
function maskEmail(email) {
    if (!email || typeof email !== 'string' || !email.includes('@')) return 'ak***@em***.com';
    const [name, fullDomain] = email.split('@');

    let nameVisible = '';
    if (name.length <= 2) {
        nameVisible = name[0] || 'a';
    } else if (name.length === 3) {
        nameVisible = name.substring(0, 2);
    } else {
        nameVisible = name.substring(0, 3);
    }

    if (!fullDomain) return `${nameVisible}***@em***.com`;

    const parts = fullDomain.split('.');
    if (parts.length < 2) {
        const domVis = fullDomain.length <= 2 ? fullDomain[0] : fullDomain.substring(0, 2);
        return `${nameVisible}***@${domVis}***`;
    }

    const domainName = parts[0];
    const extension = parts.slice(1).join('.');
    const domVisible = domainName.length <= 2 ? domainName[0] : domainName.substring(0, 2);

    return `${nameVisible}***@${domVisible}***.${extension}`;
}

/**
 * Format nama dan ID Telegram pengguna untuk tampilan di Channel
 * Contoh: Budi Santoso (ID: 562918374) -> Budi Santoso (ID: 562****)
 */
function formatUserIdentity(from) {
    if (!from) return 'Pengguna';
    const rawName = from.first_name || from.username || 'Pengguna';
    // Bersihkan karakter markdown agar tidak merusak format teks di Telegram
    const cleanName = rawName.replace(/[*_`\[\]\\]/g, '').trim() || 'Pengguna';

    const idStr = String(from.id || '');
    let maskedId = 'xxxx';
    if (idStr.length >= 3) {
        maskedId = `${idStr.substring(0, 3)}xxxx`;
    } else if (idStr.length > 0) {
        maskedId = `${idStr}xxxx`;
    }

    return `${cleanName} (ID: ${maskedId})`;
}

/**
 * Konfigurasi Kalender & Zona Waktu Otomatis Real-time (8 Negara)
 * Menyesuaikan kalender dan jam lokal akurat per negara tanpa kode singkatan
 */
const COUNTRY_TIME_CONFIG = {
    id: { locale: 'id-ID', timeZone: 'Asia/Jakarta' },
    en: { locale: 'en-US', timeZone: 'Europe/London' },
    ms: { locale: 'ms-MY', timeZone: 'Asia/Kuala_Lumpur' },
    fil: { locale: 'fil-PH', timeZone: 'Asia/Manila' },
    ar: { locale: 'ar-SA', timeZone: 'Asia/Riyadh' },
    ru: { locale: 'ru-RU', timeZone: 'Europe/Moscow' },
    es: { locale: 'es-ES', timeZone: 'Europe/Madrid' },
    hi: { locale: 'hi-IN', timeZone: 'Asia/Kolkata' }
};

/**
 * Format tanggal kalender & jam digital otomatis real-time sesuai negara masing-masing
 * Bersih tanpa singkatan kode (WIB, MYT, BST, dll)
 */
function getDateTimeWIB(lang = 'id', includeDay = false) {
    const now = new Date();
    const cfg = COUNTRY_TIME_CONFIG[lang] || COUNTRY_TIME_CONFIG['id'];
    const dateOptions = {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: cfg.timeZone
    };
    if (includeDay) {
        dateOptions.weekday = 'long';
    }
    let dateStr = now.toLocaleDateString(cfg.locale, dateOptions);
    if (dateStr && dateStr.length > 0) {
        dateStr = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
        if (lang === 'ru') dateStr = dateStr.replace(/\s*г\.?$/, '');
    }
    const timeStr = now.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: cfg.timeZone
    }).replace('.', ':');

    return {
        date: dateStr,
        time: timeStr,
        combined: `${dateStr} • ${timeStr}`
    };
}

function getFormattedWIB(lang = 'id', includeDay = false) {
    return getDateTimeWIB(lang, includeDay).combined;
}

/**
 * Format jam real-time untuk console log yang rapi dan profesional
 */
function getLogTime() {
    const now = new Date();
    return now.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone: 'Asia/Jakarta'
    }).replace(/\./g, ':');
}

function logInfo(tag, message) {
    console.log(`[${getLogTime()} WIB] [${tag}] ${message}`);
}

/**
 * Kirim Notifikasi Transaksi Sukses ke Channel Telegram (Background Asynchronous)
 */
async function sendChannelNotification(type, data = {}) {
    if (!CHANNEL_ID) return;

    try {
        const buyerLang = getUserLang(data.user?.id, data.user);
        const { date: dateFormatted, time: timeFormatted } = getDateTimeWIB(buyerLang, false);
        let message = '';
        let buttonText = i18n.t(buyerLang, 'channel.btn_single');
        const orderId = data.orderId || orderCounter.getNextOrderId();
        const userDisplay = formatUserIdentity(data.user);

        if (type === 'SINGLE') {
            buttonText = i18n.t(buyerLang, 'channel.btn_single');
            message = `${i18n.t(buyerLang, 'channel.title_single')}\n` +
                `────────────\n` +
                `${i18n.t(buyerLang, 'channel.service_label_single')}\n` +
                `${i18n.t(buyerLang, 'channel.buyer_label')} ${userDisplay}\n` +
                (data.email ? `${i18n.t(buyerLang, 'channel.account_label')} \`${maskEmail(data.email)}\`\n` : '') +
                `${i18n.t(buyerLang, 'channel.time_label')} ${dateFormatted} • ${timeFormatted}\n` +
                `${i18n.t(buyerLang, 'channel.status_single')}\n` +
                `────────────\n` +
                `${i18n.t(buyerLang, 'channel.cta_single')}`;
        } else if (type === 'CUSTOM_EMAIL') {
            buttonText = i18n.t(buyerLang, 'channel.btn_custom');
            message = `${i18n.t(buyerLang, 'channel.title_custom')}\n` +
                `────────────\n` +
                `${i18n.t(buyerLang, 'channel.service_label_custom')}\n` +
                `${i18n.t(buyerLang, 'channel.buyer_label')} ${userDisplay}\n` +
                (data.email ? `${i18n.t(buyerLang, 'channel.account_label')} \`${maskEmail(data.email)}\`\n` : '') +
                `${i18n.t(buyerLang, 'channel.time_label')} ${dateFormatted} • ${timeFormatted}\n` +
                `${i18n.t(buyerLang, 'channel.status_custom')}\n` +
                `────────────\n` +
                `${i18n.t(buyerLang, 'channel.cta_custom')}`;
        } else if (type === 'BULK') {
            buttonText = i18n.t(buyerLang, 'channel.btn_bulk');
            message = `${i18n.t(buyerLang, 'channel.title_bulk')}\n` +
                `────────────\n` +
                `${i18n.t(buyerLang, 'channel.service_label_bulk')}\n` +
                `${i18n.t(buyerLang, 'channel.buyer_label')} ${userDisplay}\n` +
                `${i18n.t(buyerLang, 'channel.total_label', data.count)}\n` +
                `${i18n.t(buyerLang, 'channel.time_label')} ${dateFormatted} • ${timeFormatted}\n` +
                `${i18n.t(buyerLang, 'channel.status_bulk')}\n` +
                `────────────\n` +
                `${i18n.t(buyerLang, 'channel.cta_bulk')}`;
        }

        const botLink = (bot.botInfo && bot.botInfo.username) ? `https://t.me/${bot.botInfo.username}` : 'https://t.me/alightmotionpass_bot';
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.url(buttonText, botLink)]
        ]);

        try {
            await bot.telegram.sendMessage(CHANNEL_ID, message, {
                parse_mode: 'Markdown',
                ...keyboard
            });
            logInfo('CHANNEL', `📢 Notifikasi ${type} [${buyerLang.toUpperCase()}] berhasil diposting ke ${CHANNEL_ID}`);
        } catch (sendErr) {
            console.warn(`[Channel] Peringatan format Markdown (${sendErr.message}), mengirim via fallback teks polos...`);
            await bot.telegram.sendMessage(CHANNEL_ID, message.replace(/[*_`]/g, ''), keyboard).catch((err2) => {
                console.error(`[Channel] Gagal kirim notifikasi ke channel:`, err2.message);
            });
        }
    } catch (err) {
        console.error(`[Channel] Gagal memproses notifikasi:`, err.message);
    }
}

function getChannelUsername() {
    if (CHANNEL_ID && String(CHANNEL_ID).startsWith('@')) {
        return String(CHANNEL_ID);
    }
    return '@ChannelAnda';
}

function getChannelUrl() {
    if (CHANNEL_ID && String(CHANNEL_ID).startsWith('@')) {
        return `https://t.me/${String(CHANNEL_ID).replace('@', '')}`;
    }
    if (CHANNEL_ID && String(CHANNEL_ID).startsWith('https://t.me/')) {
        return CHANNEL_ID;
    }
    return 'https://t.me/telegram';
}

function getMaintenanceCard(lang) {
    const text = i18n.t(lang, 'menu.maintenance_msg');
    const chanUrl = getChannelUrl();
    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.url(i18n.t(lang, 'menu.btn_channel_info'), chanUrl),
            Markup.button.callback(i18n.t(lang, 'menu.btn_refresh_status'), 'refresh_maintenance')
        ]
    ]);
    return { text, keyboard };
}

async function broadcastMaintenanceToChannel(isActivating) {
    if (!CHANNEL_ID) return;
    try {
        const botUsername = (bot.botInfo && bot.botInfo.username) ? bot.botInfo.username : 'motionpass_bot';
        const botLink = `https://t.me/${botUsername}`;

        let message = '';
        let buttonText = '';

        if (isActivating) {
            message = `🛠️ *PENGUMUMAN PEMELIHARAAN*\n` +
                `────────────\n` +
                `Halo member setia Alight Motion!\n\n` +
                `Layanan pembuatan & upgrade akun Alight Motion saat ini sedang *DIISTIRAHATKAN SEMENTARA* untuk pembaruan kuota.\n\n` +
                `📋 *Status:* Sedang Berlangsung ⛔\n` +
                `💡 Seluruh data & antrean Anda aman.\n\n` +
                `Pembaruan kuota sedang dipantau secara berkala. Begitu kuota telah aktif kembali, channel ini akan langsung memberikan info pembukaan! 🚀\n` +
                `────────────\n` +
                `🤖 *Bot Layanan:* @${botUsername}`;
            buttonText = '🤖 Buka Bot Layanan';
        } else {
            message = `🚀 *LAYANAN KEMBALI ONLINE!*\n` +
                `────────────\n` +
                `Kabar gembira! Pembaruan kuota telah selesai.\n\n` +
                `Layanan bot Alight Motion kini telah *DIBUKA KEMBALI*! Silakan buat akun baru atau upgrade email Anda seperti biasa.\n\n` +
                `🟢 *Status* : Normal & Siap Digunakan\n` +
                `⚡ *Server* : Super Cepat & Stabil\n\n` +
                `Langsung gas sekarang di bot resmi kami! 👇\n` +
                `────────────\n` +
                `🤖 *Bot Layanan:* @${botUsername}`;
            buttonText = '⚡ Buka Bot Sekarang';
        }

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.url(buttonText, botLink)]
        ]);

        try {
            await bot.telegram.sendMessage(CHANNEL_ID, message, {
                parse_mode: 'Markdown',
                ...keyboard
            });
            logInfo('CHANNEL', `📢 Pengumuman Maintenance (${isActivating ? 'ON' : 'OFF'}) berhasil diposting ke ${CHANNEL_ID}`);
        } catch (sendErr) {
            console.warn(`[Channel] Peringatan format Markdown pengumuman maintenance (${sendErr.message}), mengirim plain text...`);
            await bot.telegram.sendMessage(CHANNEL_ID, message.replace(/[*_`]/g, ''), keyboard).catch((err2) => {
                console.error(`[Channel] Gagal kirim pengumuman maintenance ke channel:`, err2.message);
            });
        }
    } catch (err) {
        console.error(`[Channel] Gagal memproses pengumuman maintenance:`, err.message);
    }
}

// -------------------------------------------------------------
// SISTEM OTOMATISASI REALTIME KUOTA ALIGHT MOTION (24 JAM)
// -------------------------------------------------------------
async function sendOwnerAlert(text) {
    if (!OWNER_ID) return;
    try {
        await bot.telegram.sendMessage(OWNER_ID, text, { parse_mode: 'Markdown' });
    } catch {
        await bot.telegram.sendMessage(OWNER_ID, text.replace(/[*_`]/g, '')).catch(() => {});
    }
}

let lastAutoTriggerTime = 0;
async function handleAutoMaintenanceTrigger(errMessage, source = 'SYSTEM') {
    const raw = String(errMessage || '');
    const isQuotaLimit = raw.includes('QUOTA_EXCEEDED') || raw.includes('Exceeded daily quota');

    if (!isQuotaLimit) return;

    // Hindari trigger berulang dalam jeda 30 detik
    const now = Date.now();
    if (now - lastAutoTriggerTime < 30000) return;
    lastAutoTriggerTime = now;

    if (!isMaintenance) {
        logInfo('AUTO-MAINTENANCE', `🚨 Terdeteksi QUOTA_EXCEEDED dari ${source}! Mengaktifkan mode maintenance otomatis...`);
        saveMaintenanceState(true, `AUTO_${source}`);
        isQueueOpen = false;

        // Broadcast pengumuman pemeliharaan ke channel
        broadcastMaintenanceToChannel(true).catch(() => {});

        // Jalankan background probe untuk mendeteksi reset kuota
        startAutoQuotaChecker();

        // Kirim alert darurat ke Owner
        const timeNow = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' });
        const alertText = `🚨 *PERINGATAN KUOTA ALIGHT MOTION LIMIT!*\n` +
            `────────────\n` +
            `Terdeteksi batasan kuota dari server Alight Motion:\n` +
            `• Sumber  : *${source}*\n` +
            `• Error   : \`QUOTA_EXCEEDED (Limit Kuota Harian)\`\n` +
            `• Waktu   : *${timeNow} WIB*\n` +
            `• Status  : *Mode Pemeliharaan DIAKTIFKAN* ⛔\n` +
            `• Channel : Pengumuman telah diposting ke ${CHANNEL_ID}\n` +
            `────────────\n` +
            `💡 Pemantauan server sedang berjalan. Layanan akan langsung dibuka kembali begitu kuota telah siap!`;

        sendOwnerAlert(alertText);
    }
}

let quotaCheckTimer = null;
let isProbeRunning = false;

function stopAutoQuotaChecker() {
    if (quotaCheckTimer) {
        clearInterval(quotaCheckTimer);
        quotaCheckTimer = null;
    }
}

function startAutoQuotaChecker() {
    if (quotaCheckTimer) clearInterval(quotaCheckTimer);

    logInfo('PROBE', '📡 Background Heartbeat Checker kuota Alight Motion AKTIF (Cek tiap 5 menit)...');

    // Cek setiap 5 menit (300.000 ms) di background
    quotaCheckTimer = setInterval(async () => {
        if (!isMaintenance) {
            stopAutoQuotaChecker();
            return;
        }

        if (isProbeRunning) return;
        isProbeRunning = true;

        try {
            logInfo('PROBE', '🔍 Menguji apakah kuota Alight Motion sudah direset...');
            const probeEmail = `probe.${Date.now()}@wikinime.com`;
            const checkRes = await api.sendLink(API_BASE_URL, probeEmail);

            const msg = String(checkRes?.message || '');
            if (!checkRes?.success && (msg.includes('QUOTA_EXCEEDED') || msg.includes('Exceeded daily quota'))) {
                logInfo('PROBE', '⏳ Server Alight Motion masih limit. Bot tetap dalam mode maintenance.');
                isProbeRunning = false;
                return;
            }

            // Jika berhasil (200 OK) atau tidak ada error QUOTA_EXCEEDED:
            if (checkRes?.success) {
                logInfo('PROBE', '🎉 Kuota Alight Motion BERHASIL DIRESET! Mematikan maintenance otomatis...');
                saveMaintenanceState(false, 'AUTO_RECOVERY');
                isQueueOpen = true;
                stopAutoQuotaChecker();

                // Broadcast ke channel bahwa layanan buka kembali
                broadcastMaintenanceToChannel(false).catch(() => {});

                // Kirim notifikasi pemulihan ke Owner
                const timeNow = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' });
                const reopenText = `🟢 *INFO KUOTA ALIGHT MOTION SUDAH RESET!*\n` +
                    `────────────\n` +
                    `Pengecekan mendeteksi server telah normal kembali:\n` +
                    `• Waktu Pulih : *${timeNow} WIB*\n` +
                    `• Status Bot  : *ONLINE (Normal)* ✅\n` +
                    `• Channel     : Pengumuman pembukaan telah diposting ke ${CHANNEL_ID}\n` +
                    `────────────\n` +
                    `Pengguna sudah dapat melakukan pemesanan kembali! 🚀`;

                sendOwnerAlert(reopenText);
            }
        } catch (probeErr) {
            logInfo('PROBE', `⚠️ Gagal menghubungi server saat probe: ${probeErr.message}`);
        } finally {
            isProbeRunning = false;
        }
    }, 5 * 60 * 1000);
}

// Inisialisasi checker jika saat boot bot sudah dalam kondisi maintenance
if (isMaintenance) {
    startAutoQuotaChecker();
}

/**
 * Cek apakah pengguna sudah bergabung ke channel resmi (Force Subscription)
 */
async function isUserSubscribed(userId) {
    if (!forceSubEnabled || !CHANNEL_ID) return true;
    if (isAdmin(userId)) return true; // Owner & Admin otomatis bypass
    try {
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500));
        const checkPromise = bot.telegram.getChatMember(CHANNEL_ID, userId);
        const member = await Promise.race([checkPromise, timeoutPromise]);
        const validStatuses = ['creator', 'administrator', 'member', 'restricted'];
        return validStatuses.includes(member.status);
    } catch (err) {
        if (err.response && err.response.error_code === 400) {
            return false;
        }
        return true;
    }
}

function getJoinChannelText(lang = 'id') {
    const raw = i18n.t(lang, 'channel_gate.desc');
    return raw.replace(/\{CHANNEL\}/g, getChannelUsername());
}

function getJoinChannelKeyboard(lang = 'id') {
    const chanUrl = getChannelUrl();
    const btnJoinText = i18n.t(lang, 'channel_gate.btn_join').replace(/\{CHANNEL\}/g, getChannelUsername());
    const btnVerifyText = i18n.t(lang, 'channel_gate.btn_verify');
    return Markup.inlineKeyboard([
        [Markup.button.url(btnJoinText, chanUrl)],
        [Markup.button.callback(btnVerifyText, 'check_joined')]
    ]);
}

// Warna tombol Telegram (Bot API: style = 'primary' biru | 'success' hijau)
function styledBtn(text, data, style) {
    return { ...Markup.button.callback(text, data), style };
}

// -------------------------------------------------------------
// Keyboard Menu Utama (Publik - Grid 2x2 Kompak & Rapi)
// -------------------------------------------------------------
function getMainKeyboard(userId, ctxFrom = null) {
    const lang = getUserLang(userId, ctxFrom);
    return Markup.inlineKeyboard([
        [
            styledBtn(i18n.t(lang, 'menu.btn_single'), 'menu_single', 'primary'),
            styledBtn(i18n.t(lang, 'menu.btn_custom'), 'menu_custom_email', 'success')
        ],
        [
            styledBtn(i18n.t(lang, 'menu.btn_bulk'), 'menu_bulk', 'success'),
            styledBtn(i18n.t(lang, 'menu.btn_language'), 'menu_language', 'primary')
        ]
    ]);
}

// -------------------------------------------------------------
// Perintah /start
// -------------------------------------------------------------
function getMainMenuWelcomeText(userId, ctxFrom = null) {
    const lang = getUserLang(userId, ctxFrom);
    const rawName = ctxFrom?.username ? `@${ctxFrom.username}` : (ctxFrom?.first_name || 'Kawan');
    const cleanName = escapeMarkdown(rawName);
    return i18n.t(lang, 'menu.title', cleanName);
}

function getLanguageMenuText(userId, ctxFrom = null) {
    const currentLang = getUserLang(userId, ctxFrom);
    const meta = i18n.getLanguageMeta(currentLang);
    const displayActive = `${meta.flag} ${meta.name}`;
    return i18n.t(currentLang, 'lang_menu.title', displayActive);
}

function getLanguageKeyboard(userId, ctxFrom = null) {
    const currentLang = getUserLang(userId, ctxFrom);
    const langs = i18n.getSupportedLanguages();
    const rows = [];
    for (let i = 0; i < langs.length; i += 2) {
        const row = [];
        const l1 = langs[i];
        row.push(Markup.button.callback(`${l1.flag} ${l1.name}`, `set_lang_${l1.code}`));

        if (i + 1 < langs.length) {
            const l2 = langs[i + 1];
            row.push(Markup.button.callback(`${l2.flag} ${l2.name}`, `set_lang_${l2.code}`));
        }
        rows.push(row);
    }
    rows.push([styledBtn(i18n.t(currentLang, 'menu.btn_back'), 'menu_main', 'primary')]);
    return Markup.inlineKeyboard(rows);
}

bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const lang = getUserLang(userId, ctx.from);
    clearSession(userId);

    // Cek wajib gabung channel secara real-time
    const subscribed = await isUserSubscribed(userId);
    if (!subscribed) {
        return ctx.reply(getJoinChannelText(lang), {
            parse_mode: 'Markdown',
            ...getJoinChannelKeyboard(lang)
        });
    }

    if (isMaintenance && !isAdmin(userId)) {
        const { text, keyboard } = getMaintenanceCard(lang);
        return ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
    }

    await ctx.reply(getMainMenuWelcomeText(userId, ctx.from), { parse_mode: 'Markdown', ...getMainKeyboard(userId, ctx.from) });
});

bot.command('cancel', async (ctx) => {
    const userId = ctx.from.id;
    const lang = getUserLang(userId, ctx.from);
    clearSession(userId);
    await ctx.reply(i18n.t(lang, 'alerts.canceled'), getMainKeyboard(userId, ctx.from));
});

bot.command(['lang', 'language', 'bahasa'], async (ctx) => {
    const userId = ctx.from.id;
    const text = getLanguageMenuText(userId, ctx.from);
    return ctx.reply(text, {
        parse_mode: 'Markdown',
        ...getLanguageKeyboard(userId, ctx.from)
    });
});

bot.action('menu_language', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    const userId = ctx.from.id;
    const text = getLanguageMenuText(userId, ctx.from);
    const kb = getLanguageKeyboard(userId, ctx.from);

    try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...kb });
    } catch {
        await ctx.reply(text, { parse_mode: 'Markdown', ...kb });
    }
});

bot.action(/^set_lang_(\w+)$/, async (ctx) => {
    const userId = ctx.from.id;
    const targetLang = ctx.match[1];
    const currentLang = getUserLang(userId, ctx.from);

    if (targetLang === currentLang) {
        return ctx.answerCbQuery(i18n.t(currentLang, 'lang_menu.already_active'), { show_alert: false }).catch(() => { });
    }

    setUserLang(userId, targetLang);
    await ctx.answerCbQuery(i18n.t(targetLang, 'lang_menu.switched_toast'), { show_alert: false }).catch(() => { });

    // Secara realtime langsung alihkan tampilan ke Menu Utama dalam bahasa terpilih
    const text = getMainMenuWelcomeText(userId, ctx.from);
    const kb = getMainKeyboard(userId, ctx.from);

    try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...kb });
    } catch {
        await ctx.reply(text, { parse_mode: 'Markdown', ...kb });
    }
});

// Aksi Cek Status Verifikasi Gabung Channel
bot.action('check_joined', async (ctx) => {
    const userId = ctx.from.id;
    const lang = getUserLang(userId, ctx.from);
    const subscribed = await isUserSubscribed(userId);

    if (!subscribed) {
        const notJoinedAlert = i18n.t(lang, 'channel_gate.alert_not_joined').replace(/\{CHANNEL\}/g, getChannelUsername());
        return ctx.answerCbQuery(
            notJoinedAlert,
            { show_alert: true }
        ).catch(() => { });
    }

    await ctx.answerCbQuery(i18n.t(lang, 'channel_gate.toast_joined'), { show_alert: false }).catch(() => { });
    clearSession(userId);

    const text = getMainMenuWelcomeText(userId, ctx.from);

    try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...getMainKeyboard(userId, ctx.from) });
    } catch {
        await ctx.reply(text, { parse_mode: 'Markdown', ...getMainKeyboard(userId, ctx.from) });
    }
});

bot.action('menu_main', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    const userId = ctx.from.id;
    clearSession(userId);

    const lang = getUserLang(userId, ctx.from);
    const subscribed = await isUserSubscribed(userId);
    if (!subscribed) {
        try {
            return await ctx.editMessageText(getJoinChannelText(lang), {
                parse_mode: 'Markdown',
                ...getJoinChannelKeyboard(lang)
            });
        } catch {
            return await ctx.reply(getJoinChannelText(lang), {
                parse_mode: 'Markdown',
                ...getJoinChannelKeyboard(lang)
            });
        }
    }

    if (isMaintenance && !isAdmin(userId)) {
        const { text, keyboard } = getMaintenanceCard(lang);
        try {
            return await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
        } catch {
            return await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
        }
    }

    const text = getMainMenuWelcomeText(userId, ctx.from);

    try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...getMainKeyboard(userId, ctx.from) });
    } catch {
        await ctx.reply(text, { parse_mode: 'Markdown', ...getMainKeyboard(userId, ctx.from) });
    }
});

bot.action('refresh_maintenance', async (ctx) => {
    const userId = ctx.from.id;
    const lang = getUserLang(userId, ctx.from);

    if (isMaintenance) {
        return ctx.answerCbQuery(i18n.t(lang, 'menu.maintenance_toast_still'), { show_alert: true }).catch(() => { });
    }

    await ctx.answerCbQuery(i18n.t(lang, 'menu.maintenance_toast_open'), { show_alert: false }).catch(() => { });
    clearSession(userId);
    const welcomeText = getMainMenuWelcomeText(userId, ctx.from);
    const kb = getMainKeyboard(userId, ctx.from);
    try {
        await ctx.editMessageText(welcomeText, { parse_mode: 'Markdown', ...kb });
    } catch {
        await ctx.reply(welcomeText, { parse_mode: 'Markdown', ...kb });
    }
});

bot.command(['help', 'bantuan'], async (ctx) => {
    const userId = ctx.from.id;
    return ctx.reply(getMainMenuWelcomeText(userId, ctx.from), {
        parse_mode: 'Markdown',
        ...getMainKeyboard(userId, ctx.from)
    });
});

// =============================================================
// PANEL KONTROL & PENGATURAN KHUSUS OWNER
// =============================================================

function getOwnerDashboardText(userId = null) {
    const lastCounter = orderCounter.getCurrentCounter();
    const nextCounter = lastCounter + 1;
    const totalUsers = registeredUsers.size;
    const activeCount = typeof activeBulkJobs !== 'undefined' ? activeBulkJobs.size : (activeBulkJob ? 1 : 0);
    const totalQueue = bulkQueue.length + activeCount;
    const queueStatus = isQueueOpen
        ? (totalQueue > 0 ? `${totalQueue} Queued (${activeCount} Active Slots) ⏳` : 'Empty (Ready for Orders)')
        : '🛑 CLOSED (Maintenance)';
    const channelStatus = CHANNEL_ID 
        ? (forceSubEnabled ? `${CHANNEL_ID} (Active) 📢` : `${CHANNEL_ID} (Inactive) ⚪`) 
        : 'Not set (Open Access) ⚪';
    const titleRole = (userId && !isOwner(userId)) ? '🛡️ *ADMIN CONTROL PANEL*' : '👑 *OWNER CONTROL PANEL*';
    const sapaan = (userId && !isOwner(userId)) ? 'Hello admin, here is the Alight Motion store summary:' : 'Hello boss, here is your Alight Motion store summary:';

    return `${titleRole}\n` +
        `────────────\n` +
        `${sapaan}\n\n` +
        `📋 *TRANSACTION INFO:*\n` +
        `• Last Order Number   : \`AM-ACT-${lastCounter}\`\n` +
        `• Next Order Number   : \`AM-ACT-${nextCounter}\`\n` +
        `• Total Bot Users   : *${totalUsers}* Users\n\n` +
        `⚡ *CURRENT BOT STATUS:*\n` +
        `• Bot Status           : ${isMaintenance ? '🛠️ Maintenance (Offline) ⛔' : 'Running Normally ✅'}\n` +
        `• Buyer Queue          : ${queueStatus}\n` +
        `• Channel Requirement : ${channelStatus}\n` +
        `────────────\n` +
        `💡 Please choose a control category below:`;
}

function getOwnerDashboardKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('📊 1. Manage Transactions & Queue', 'owner_cat_transaksi')],
        [Markup.button.callback('📢 2. Marketing & Channel', 'owner_cat_pemasaran')],
        [Markup.button.callback('🛠️ 3. Maintenance & Help', 'owner_cat_sistem')],
        [
            Markup.button.callback('🔄 Refresh Data', 'owner_refresh_dash'),
            Markup.button.callback('« Main Menu', 'menu_main')
        ]
    ]);
}

// -------------------------------------------------------------
// Kategori 1: Transaksi & Antrean
// -------------------------------------------------------------
function getOwnerCatTransaksiText() {
    const lastCounter = orderCounter.getCurrentCounter();
    const nextCounter = lastCounter + 1;
    const activeCount = typeof activeBulkJobs !== 'undefined' ? activeBulkJobs.size : (activeBulkJob ? 1 : 0);
    const totalQueue = bulkQueue.length + activeCount;
    const queueStatus = isQueueOpen
        ? (totalQueue > 0 ? `${totalQueue} Queued (${activeCount} Active Slots) ⏳` : 'Open (Ready for Orders) ✅')
        : '🛑 CLOSED (Maintenance)';

    return `📊 *MANAGE TRANSACTIONS & QUEUE*\n` +
        `────────────\n` +
        `Current store transaction and queue summary:\n\n` +
        `• Last Order Number   : \`AM-ACT-${lastCounter}\`\n` +
        `• Next Order Number   : \`AM-ACT-${nextCounter}\`\n` +
        `• Store Queue Status   : ${queueStatus}\n` +
        `────────────\n` +
        `Please choose a transaction feature below:`;
}

function getOwnerCatTransaksiKeyboard() {
    const queueBtnText = isQueueOpen ? '🛑 Stop Queue' : '🟢 Open Queue';
    return Markup.inlineKeyboard([
        [Markup.button.callback('🔢 Change Order Number', 'owner_change_counter')],
        [Markup.button.callback(queueBtnText, 'owner_toggle_queue')],
        [
            Markup.button.callback('🔄 Refresh', 'owner_refresh_cat1'),
            Markup.button.callback('« Back to Panel', 'owner_dashboard')
        ]
    ]);
}

// -------------------------------------------------------------
// Kategori 2: Pemasaran & Channel
// -------------------------------------------------------------
function getOwnerCatPemasaranText() {
    const totalUsers = registeredUsers.size;
    const channelStatus = CHANNEL_ID 
        ? (forceSubEnabled ? `${CHANNEL_ID} (Active) 📢` : `${CHANNEL_ID} (Inactive) ⚪`) 
        : 'Not set (Open Access) ⚪';

    return `📢 *MARKETING & CHANNEL SETTINGS*\n` +
        `────────────\n` +
        `Current store promotion and channel summary:\n\n` +
        `• Total Store Users    : *${totalUsers}* Users\n` +
        `• Required Channel    : ${channelStatus}\n` +
        `────────────\n` +
        `Please choose a marketing feature below:`;
}

function getOwnerCatPemasaranKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('📢 Send Broadcast Message', 'owner_broadcast')],
        [Markup.button.callback('⚙️ Channel Requirement Settings', 'owner_channel_settings')],
        [Markup.button.callback('👥 Customer Data & Stats', 'owner_user_stats')],
        [Markup.button.callback('« Back to Panel', 'owner_dashboard')]
    ]);
}

// -------------------------------------------------------------
// Kategori 3: Pemeliharaan & Bantuan
// -------------------------------------------------------------
function getOwnerCatSistemText() {
    const sessionCount = userSessions.size;
    const mtStatus = isMaintenance ? 'Active (Offline) ⛔' : 'Inactive (Online) 🟢';
    return `🛠️ *SYSTEM MAINTENANCE & HELP*\n` +
        `────────────\n` +
        `Operational and maintenance tools for the bot server:\n\n` +
        `• Maintenance Status: *${mtStatus}*\n` +
        `• Active Sessions in RAM : *${sessionCount}* Sessions\n` +
        `• Counter Database  : \`order_counter.json\` (Ready to Back Up)\n` +
        `• User Database     : \`bot_users.json\` (${registeredUsers.size} User)\n` +
        `────────────\n` +
        `Please choose a maintenance tool below:`;
}

function getOwnerCatSistemKeyboard() {
    const mtBtnText = isMaintenance ? '🟢 Disable Maintenance (Open Bot)' : '🛠️ Enable Maintenance (Close Bot)';
    const mtBtnAction = isMaintenance ? 'owner_maintenance_off' : 'owner_maintenance_on';
    return Markup.inlineKeyboard([
        [Markup.button.callback(mtBtnText, mtBtnAction)],
        [
            Markup.button.callback('📬 Check Buyer OTP', 'owner_check_otp'),
            Markup.button.callback('💾 Download Data Backup', 'owner_backup_data')
        ],
        [
            Markup.button.callback('🧹 Clear RAM Cache', 'owner_clear_cache'),
            Markup.button.callback('📖 Command Guide (CMD)', 'owner_help_cmd')
        ],
        [Markup.button.callback('« Back to Panel', 'owner_dashboard')]
    ]);
}

function getOwnerHelpText() {
    return `📖 *OWNER COMMAND LIST*\n` +
        `────────────\n` +
        `Quick commands you can type directly in chat:\n\n` +
        `👑 *Navigation & Dashboard:*\n` +
        `• \`/owner\` or \`/admin\` - Open the owner dashboard\n` +
        `• \`/cmd\` - Show this command guide\n\n` +
        `🛠️ *Maintenance:*\n` +
        `• \`/maintenance on\` (alias \`/mt on\`) - Enable maintenance mode & announce to channel\n` +
        `• \`/maintenance off\` (alias \`/mt off\`) - Disable maintenance & announce to channel\n` +
        `• \`/maintenance\` (alias \`/mt\`) - Check current maintenance status\n\n` +
        `🔢 *Transactions & Queue:*\n` +
        `• \`/setpesanan <number>\` or \`/setnota\` - Change order number (example: \`/setpesanan 514500\`)\n` +
        `• \`/stopqueue\` - Temporarily close the order queue\n` +
        `• \`/startqueue\` - Reopen the order queue\n` +
        `• \`/clearqueue\` - Clear the bulk order queue\n\n` +
        `📢 *Marketing & Users:*\n` +
        `• \`/broadcast <message>\` - Send a broadcast to all users\n` +
        `• \`/broadcastpin <message>\` - Send a broadcast & pin it\n` +
        `• \`/users\` - Check total bot user stats\n\n` +
        `📬 *Customer Support:*\n` +
        `• \`/cekinbox <email>\` - Peek at a buyer account's inbox & OTP\n\n` +
        `⚙️ *Settings & Maintenance:*\n` +
        `• \`/forcesub <on/off>\` - Enable/disable the required channel join\n` +
        `• \`/setchannel <@channel>\` - Change the required channel username\n` +
        `• \`/backup\` - Download counter & user database backup\n` +
        `• \`/clearsession\` - Clear all RAM cache & stuck sessions\n` +
        `────────────`;
}

async function sendBackupFiles(ctx) {
    try {
        const counterFile = path.join(DATA_DIR, 'order_counter.json');
        const usersFile = path.join(DATA_DIR, 'bot_users.json');

        await ctx.reply('💾 *Sending store data backup files...*', { parse_mode: 'Markdown' });

        if (fs.existsSync(counterFile)) {
            await ctx.telegram.sendDocument(ctx.chat.id, { source: counterFile }, {
                caption: `📊 *Transaction Data Backup*\n• Last Order Number: \`AM-ACT-${orderCounter.getCurrentCounter()}\``,
                parse_mode: 'Markdown'
            });
        }
        if (fs.existsSync(usersFile)) {
            await ctx.telegram.sendDocument(ctx.chat.id, { source: usersFile }, {
                caption: `👥 *Customer Database Backup*\n• Total Users: *${registeredUsers.size} Users*`,
                parse_mode: 'Markdown'
            });
        }

        await ctx.reply('💾 *Store database backup sent successfully!*', {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('« Back to Maintenance', 'owner_cat_sistem')]])
        });
    } catch (err) {
        return ctx.reply(`❌ Failed to send backup: ${err.message}`, {
            ...Markup.inlineKeyboard([[Markup.button.callback('« Back to Maintenance', 'owner_cat_sistem')]])
        });
    }
}

async function sendBroadcastMessage(ctx, messageText, shouldPin = false) {
    const userList = Array.from(registeredUsers);
    const total = userList.length;
    if (total === 0) {
        return ctx.reply('⚠️ No registered users to broadcast to.', {
            ...Markup.inlineKeyboard([[Markup.button.callback('« Back to Marketing', 'owner_cat_pemasaran')]])
        });
    }

    const progressMsg = await ctx.reply(
        `📢 *STARTING BROADCAST...*\n────────────\nTarget : *${total} Users*\nPlease wait while the messages are being sent...`,
        { parse_mode: 'Markdown' }
    );

    let successCount = 0;
    let failCount = 0;
    let cleanedCount = 0;

    for (let i = 0; i < userList.length; i++) {
        const uId = userList[i];
        try {
            let sent = null;
            try {
                sent = await bot.telegram.sendMessage(uId, messageText, { parse_mode: 'Markdown' });
            } catch (mdErr) {
                // Fallback otomatis jika teks memuat karakter Markdown yang tidak valid (misal tanda underscore/bintang acak)
                sent = await bot.telegram.sendMessage(uId, messageText);
            }
            if (shouldPin && sent && sent.message_id) {
                await bot.telegram.pinChatMessage(uId, sent.message_id, { disable_notification: false }).catch(() => { });
            }
            successCount++;
        } catch (err) {
            // Tangani rate limit Telegram 429 jika ada
            if (err.response?.error_code === 429 && err.response?.parameters?.retry_after) {
                const waitSec = err.response.parameters.retry_after || 1;
                await new Promise(r => setTimeout(r, waitSec * 1000));
                try {
                    const retrySent = await bot.telegram.sendMessage(uId, messageText).catch(() => null);
                    if (retrySent) {
                        successCount++;
                        continue;
                    }
                } catch {}
            }

            // Otomatis bersihkan ID yang memblokir bot atau akun sudah mati/belum pernah start bot baru
            const errCode = err.response?.error_code;
            const errMsg = String(err.message || '');
            if (errCode === 403 || (errCode === 400 && (errMsg.includes('chat not found') || errMsg.includes('user is deactivated')))) {
                if (!isOwner(uId) && !isAdmin(uId)) {
                    registeredUsers.delete(String(uId));
                    cleanedCount++;
                }
            }

            failCount++;
        }
        // Jeda 40ms agar mematuhi batas rate limit Telegram
        await new Promise(r => setTimeout(r, 40));
    }

    if (cleanedCount > 0) {
        saveRegisteredUsers();
    }

    const report = `📢 *BROADCAST REPORT COMPLETED*\n` +
        `────────────\n` +
        `• Target Users    : *${total} Users*\n` +
        `• Sent Successfully : *${successCount}* ✅\n` +
        `• Failed / Rejected : *${failCount}* ❌\n` +
        (cleanedCount > 0 ? `• Database Cleaned  : *${cleanedCount} Inactive Accounts Removed* 🧹\n` : '') +
        (shouldPin ? `• Pin Status        : Pinned 📌\n` : '') +
        `────────────\n` +
        `Broadcast processing is complete.`;

    const finishKb = Markup.inlineKeyboard([
        [Markup.button.callback('« Back to Marketing', 'owner_cat_pemasaran')],
        [Markup.button.callback('👑 Owner Panel', 'owner_dashboard')]
    ]);

    await ctx.telegram.editMessageText(ctx.chat.id, progressMsg.message_id, null, report, {
        parse_mode: 'Markdown',
        ...finishKb
    }).catch(async () => {
        await ctx.reply(report, {
            parse_mode: 'Markdown',
            ...finishKb
        });
    });
}

// -------------------------------------------------------------
// Perintah Chat Cepat Khusus Owner & Admin
// -------------------------------------------------------------
bot.command(['owner', 'admin'], async (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) {
        return ctx.reply('⛔ Restricted: This command can only be used by the store Owner / Admin.');
    }
    clearSession(userId);
    return ctx.reply(getOwnerDashboardText(userId), {
        parse_mode: 'Markdown',
        ...getOwnerDashboardKeyboard()
    });
});

bot.command(['setnota', 'setpesanan'], async (ctx) => {
    if (!isOwner(ctx.from.id)) {
        return ctx.reply('⛔ Access Denied: Only the main store Owner can change the order number.');
    }
    const parts = ctx.message.text.trim().split(/\s+/);
    const cleanedDigits = parts.length >= 2 ? parts[1].replace(/\D/g, '') : '';
    if (!cleanedDigits || isNaN(parseInt(cleanedDigits, 10))) {
        return ctx.reply('⚠️ Invalid format. Use: `/setpesanan <angka>`\nExample: `/setpesanan 514500` (or `/setpesanan AM-ACT-514500`)', { parse_mode: 'Markdown' });
    }
    const newNum = parseInt(cleanedDigits, 10);
    orderCounter.setCounter(newNum);
    return ctx.reply(
        `✅ *ORDER NUMBER CHANGED SUCCESSFULLY!*\n────────────\n` +
        `• Current order number : \`AM-ACT-${newNum}\`\n` +
        `• Next order number    : \`AM-ACT-${newNum + 1}\`\n────────────`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('« Back to Transactions', 'owner_cat_transaksi')],
                [Markup.button.callback('👑 Owner Panel', 'owner_dashboard')]
            ])
        }
    );
});

bot.command('broadcast', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('⛔ Restricted: This command can only be used by the store Owner / Admin.');
    }
    const msg = ctx.message.text.replace(/^\/broadcast(@\w+)?\s*/i, '').trim();
    if (!msg) {
        return ctx.reply('⚠️ Invalid format. Enter the message you want to broadcast.\nExample: `/broadcast Hello everyone, the bot is ready for orders!`', { parse_mode: 'Markdown' });
    }
    return sendBroadcastMessage(ctx, msg, false);
});

bot.command('broadcastpin', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('⛔ Restricted: This command can only be used by the store Owner / Admin.');
    }
    const msg = ctx.message.text.replace(/^\/broadcastpin(@\w+)?\s*/i, '').trim();
    if (!msg) {
        return ctx.reply('⚠️ Invalid format. Enter the message you want to broadcast & pin.\nExample: `/broadcastpin IMPORTANT ANNOUNCEMENT...`', { parse_mode: 'Markdown' });
    }
    return sendBroadcastMessage(ctx, msg, true);
});

bot.command('forcesub', async (ctx) => {
    if (!isOwner(ctx.from.id)) {
        return ctx.reply('⛔ Access Denied: Only the main store Owner can change channel settings.');
    }
    const arg = ctx.message.text.split(/\s+/)[1]?.toLowerCase();
    if (arg === 'on') {
        forceSubEnabled = true;
    } else if (arg === 'off') {
        forceSubEnabled = false;
    } else {
        forceSubEnabled = !forceSubEnabled;
    }
    return ctx.reply(
        `⚙️ Required channel join for ${CHANNEL_ID} is now: *${forceSubEnabled ? 'ACTIVE ✅' : 'INACTIVE ❌'}*`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('« Manage Channel', 'owner_channel_settings')]])
        }
    );
});

bot.command('setchannel', async (ctx) => {
    if (!isOwner(ctx.from.id)) {
        return ctx.reply('⛔ Access Denied: Only the main store Owner can change channel settings.');
    }
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 2) {
        return ctx.reply('⚠️ Invalid format. Use: `/setchannel <@channelname>`\nExample: `/setchannel @canvalive`', { parse_mode: 'Markdown' });
    }
    let ch = parts[1].trim();
    if (!ch.startsWith('@') && !ch.startsWith('-100')) {
        ch = '@' + ch;
    }
    CHANNEL_ID = ch;

    // Simpan permanen ke file .env jika ada
    try {
        const envPath = path.join(__dirname, '..', '.env');
        if (fs.existsSync(envPath)) {
            let envContent = fs.readFileSync(envPath, 'utf-8');
            if (envContent.includes('CHANNEL_ID=')) {
                envContent = envContent.replace(/CHANNEL_ID=.*/g, `CHANNEL_ID=${ch}`);
            } else {
                envContent += `\nCHANNEL_ID=${ch}`;
            }
            fs.writeFileSync(envPath, envContent, 'utf-8');
        }
    } catch { }

    return ctx.reply(
        `✅ *CHANNEL CHANGED SUCCESSFULLY!*\n────────────\nCurrent channel: *${CHANNEL_ID}*`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('« Manage Channel', 'owner_channel_settings')]])
        }
    );
});

bot.command('cekinbox', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('⛔ Restricted: This command can only be used by the store Owner / Admin.');
    }
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 2 || !parts[1].includes('@')) {
        return ctx.reply('⚠️ Invalid format. Use: `/cekinbox <email>`\nExample: `/cekinbox user@domain.com`', { parse_mode: 'Markdown' });
    }
    const email = parts[1].toLowerCase().trim();
    const waitMsg = await ctx.reply(`⏳ *Checking inbox for \`${email}\`...*`, { parse_mode: 'Markdown' });
    return await renderInboxView(ctx, email, false, waitMsg?.message_id);
});

bot.command('backup', async (ctx) => {
    if (!isOwner(ctx.from.id)) {
        return ctx.reply('⛔ Access Denied: Only the main store Owner can download database backups.');
    }
    return sendBackupFiles(ctx);
});

bot.command(['maintenance', 'mt'], async (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) {
        return ctx.reply('⛔ Restricted: This command can only be used by the store Owner / Admin.');
    }

    const text = ctx.message.text.trim();
    const parts = text.split(/\s+/);
    const action = (parts[1] || '').toLowerCase();

    if (action === 'on' || action === 'aktif' || action === 'start') {
        if (isMaintenance) {
            return ctx.reply('ℹ️ Maintenance mode is already *ACTIVE*.', { parse_mode: 'Markdown' });
        }
        saveMaintenanceState(true, userId);
        broadcastMaintenanceToChannel(true).catch(() => {});
        return ctx.reply(
            `🛠️ *SYSTEM MAINTENANCE ENABLED*\n────────────\n` +
            `• Bot Status : *OFFLINE (Maintenance)* ⛔\n` +
            `• Users      : Cannot place new orders\n` +
            `• Channel    : Announcement posted to ${CHANNEL_ID}\n` +
            `• Admin      : Can still access and test the bot\n────────────\n` +
            `Use \`/maintenance off\` or the button below to end maintenance.`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([[Markup.button.callback('🟢 Disable Maintenance', 'owner_maintenance_off')]])
            }
        );
    }

    if (action === 'off' || action === 'nonaktif' || action === 'stop') {
        if (!isMaintenance) {
            return ctx.reply('ℹ️ Maintenance mode is already *INACTIVE*.', { parse_mode: 'Markdown' });
        }
        saveMaintenanceState(false, userId);
        broadcastMaintenanceToChannel(false).catch(() => {});
        return ctx.reply(
            `🟢 *SYSTEM MAINTENANCE DISABLED*\n────────────\n` +
            `• Bot Status : *ONLINE (Normal)* ✅\n` +
            `• Users      : Can order normally again\n` +
            `• Channel    : Reopening announcement posted to ${CHANNEL_ID}\n────────────`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([[Markup.button.callback('👑 Owner Panel', 'owner_dashboard')]])
            }
        );
    }

    const statusText = isMaintenance ? '*ACTIVE (OFFLINE)* ⛔' : '*INACTIVE (ONLINE)* 🟢';
    const toggleBtn = isMaintenance
        ? Markup.button.callback('🟢 Disable Maintenance (Open Bot)', 'owner_maintenance_off')
        : Markup.button.callback('🛠️ Enable Maintenance (Close Bot)', 'owner_maintenance_on');

    return ctx.reply(
        `🛠️ *MAINTENANCE STATUS*\n────────────\n` +
        `• Current Status : ${statusText}\n` +
        `• Target Channel : ${CHANNEL_ID}\n` +
        `────────────\n` +
        `Use these commands:\n` +
        `• \`/maintenance on\` - Enable maintenance & notify the channel\n` +
        `• \`/maintenance off\` - Disable maintenance & notify the channel\n` +
        `• Quick aliases: \`/mt on\` and \`/mt off\``,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [toggleBtn],
                [Markup.button.callback('👑 Owner Panel', 'owner_dashboard')]
            ])
        }
    );
});

bot.action('owner_maintenance_on', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.answerCbQuery('⛔ Owner / Admin only.', { show_alert: true }).catch(() => { });
    }
    saveMaintenanceState(true, ctx.from.id);
    broadcastMaintenanceToChannel(true).catch(() => {});
    await ctx.answerCbQuery('🛠️ Maintenance ENABLED successfully!', { show_alert: true }).catch(() => {});
    const text = getOwnerCatSistemText();
    try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...getOwnerCatSistemKeyboard() });
    } catch {
        await ctx.reply('🛠️ *Maintenance Mode ACTIVE*. Announcement posted to the channel.', {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('🟢 Disable Maintenance', 'owner_maintenance_off')]])
        });
    }
});

bot.action('owner_maintenance_off', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.answerCbQuery('⛔ Owner / Admin only.', { show_alert: true }).catch(() => { });
    }
    saveMaintenanceState(false, ctx.from.id);
    broadcastMaintenanceToChannel(false).catch(() => {});
    await ctx.answerCbQuery('🟢 Maintenance DISABLED successfully!', { show_alert: true }).catch(() => {});
    const text = getOwnerCatSistemText();
    try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...getOwnerCatSistemKeyboard() });
    } catch {
        await ctx.reply('🟢 *Maintenance Mode INACTIVE*. The bot has been reopened & announced to the channel.', {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('👑 Owner Panel', 'owner_dashboard')]])
        });
    }
});

bot.command('stopqueue', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('⛔ Restricted: This command can only be used by the store Owner / Admin.');
    }
    isQueueOpen = false;
    return ctx.reply('🛑 *QUEUE CLOSED SUCCESSFULLY*\nRegular users cannot place new orders until it is reopened.', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('🟢 Open Queue', 'owner_toggle_queue')]])
    });
});

bot.command('startqueue', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('⛔ Restricted: This command can only be used by the store Owner / Admin.');
    }
    isQueueOpen = true;
    return ctx.reply('🟢 *QUEUE OPENED SUCCESSFULLY*\nUsers can place orders as usual.', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('👑 Owner Panel', 'owner_dashboard')]])
    });
});

bot.command('clearqueue', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('⛔ Restricted: This command can only be used by the store Owner / Admin.');
    }
    const qCount = bulkQueue.length;
    bulkQueue.length = 0;
    saveBulkQueue();
    return ctx.reply(`🧹 *QUEUE CLEARED*\n${qCount} waiting queue entries have been cleared.`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('👑 Owner Panel', 'owner_dashboard')]])
    });
});

bot.command('clearsession', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('⛔ Restricted: This command can only be used by the store Owner / Admin.');
    }
    const countSessions = userSessions.size;
    userSessions.clear();
    userBulkLock.clear();
    userBulkStop.clear();
    if (typeof activeBulkJobs !== 'undefined') {
        for (const job of activeBulkJobs.values()) {
            if (job && job.userId) {
                userBulkLock.add(job.userId);
                userBulkStop.set(job.userId, false);
            }
        }
    } else if (activeBulkJob && activeBulkJob.userId) {
        userBulkLock.add(activeBulkJob.userId);
        userBulkStop.set(activeBulkJob.userId, false);
    }
    return ctx.reply(
        `🧹 *CACHE CLEARED SUCCESSFULLY*\n────────────\n• Sessions removed : *${countSessions}*\n• RAM Status       : Free & Optimal ✅`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('👑 Owner Panel', 'owner_dashboard')]])
        }
    );
});

bot.command('users', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('⛔ Restricted: This command can only be used by the store Owner / Admin.');
    }
    return ctx.reply(
        `👥 *BOT USER STATISTICS*\n────────────\n` +
        `• Total Registered Users : *${registeredUsers.size} Users*\n` +
        `• Active Sessions in RAM : *${userSessions.size} Sessions*\n` +
        `• Bulk Orders Running    : *${userBulkLock.size} Jobs*\n────────────\n` +
        `Verified Owner ID : \`${OWNER_ID || 'Not set'}\``,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('📢 Broadcast Message', 'owner_broadcast')],
                [Markup.button.callback('👑 Owner Panel', 'owner_dashboard')]
            ])
        }
    );
});

bot.command(['cmd', 'helpadmin'], async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('⛔ Restricted: This command can only be used by the store Owner / Admin.');
    }
    return ctx.reply(getOwnerHelpText(), {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('👑 Owner Panel', 'owner_dashboard')]])
    });
});

// -------------------------------------------------------------
// Action Callbacks Khusus Owner & Admin
// -------------------------------------------------------------
bot.action('owner_dashboard', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('⛔ Restricted: This command can only be used by the store Owner / Admin.');
    }
    clearSession(ctx.from.id);
    const text = getOwnerDashboardText(ctx.from.id);
    try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...getOwnerDashboardKeyboard() });
    } catch {
        await ctx.reply(text, { parse_mode: 'Markdown', ...getOwnerDashboardKeyboard() });
    }
});

bot.action('owner_open_controls', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('⛔ Restricted: This command can only be used by the store Owner / Admin.');
    }
    clearSession(ctx.from.id);
    const text = getOwnerDashboardText(ctx.from.id);
    try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...getOwnerDashboardKeyboard() });
    } catch {
        await ctx.reply(text, { parse_mode: 'Markdown', ...getOwnerDashboardKeyboard() });
    }
});

bot.action('owner_refresh_dash', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.answerCbQuery('⛔ Owner / Admin only.', { show_alert: true }).catch(() => { });
    }
    await ctx.answerCbQuery('🔄 Store data refreshed!').catch(() => { });
    const text = getOwnerDashboardText(ctx.from.id);
    try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...getOwnerDashboardKeyboard() });
    } catch { }
});

// Aksi Kategori 1: Transaksi & Antrean
bot.action('owner_cat_transaksi', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('⛔ Restricted: This command can only be used by the store Owner / Admin.');
    }
    clearSession(ctx.from.id);
    const text = getOwnerCatTransaksiText();
    try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...getOwnerCatTransaksiKeyboard() });
    } catch {
        await ctx.reply(text, { parse_mode: 'Markdown', ...getOwnerCatTransaksiKeyboard() });
    }
});

bot.action('owner_refresh_cat1', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.answerCbQuery('⛔ Owner / Admin only.', { show_alert: true }).catch(() => { });
    }
    await ctx.answerCbQuery('🔄 Transaction data refreshed!').catch(() => { });
    const text = getOwnerCatTransaksiText();
    try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...getOwnerCatTransaksiKeyboard() });
    } catch { }
});

bot.action('owner_toggle_queue', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.answerCbQuery('⛔ Owner / Admin only.', { show_alert: true }).catch(() => { });
    }
    isQueueOpen = !isQueueOpen;
    const alertMsg = isQueueOpen ? '🟢 Order queue OPENED successfully!' : '🛑 Order queue CLOSED successfully!';
    await ctx.answerCbQuery(alertMsg, { show_alert: true }).catch(() => { });

    const text = getOwnerCatTransaksiText();
    try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...getOwnerCatTransaksiKeyboard() });
    } catch { }
});

bot.action('owner_change_counter', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    if (!isOwner(ctx.from.id)) {
        return ctx.reply('⛔ Restricted: This command can only be used by the store Owner.');
    }
    const session = getSession(ctx.from.id);
    session.state = 'OWNER_SET_COUNTER';

    const currentCounter = orderCounter.getCurrentCounter();
    const promptText = `🔢 *CHANGE TRANSACTION ORDER NUMBER*\n` +
        `────────────\n` +
        `Current order number : \`AM-ACT-${currentCounter}\`\n` +
        `Next order number    : \`AM-ACT-${currentCounter + 1}\`\n\n` +
        `Please type the new order number you want (digits only):\n` +
        `_Example: type \`515000\` or \`AM-ACT-515000\`_\n\n` +
        `_Or type this command anytime: \`/setpesanan <number>\`_`;

    try {
        await ctx.editMessageText(promptText, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('« Cancel', 'owner_cat_transaksi')]])
        });
    } catch {
        await ctx.reply(promptText, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('« Cancel', 'owner_cat_transaksi')]])
        });
    }
});

// Aksi Kategori 2: Pemasaran & Channel
bot.action('owner_cat_pemasaran', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('⛔ Restricted: This command can only be used by the store Owner / Admin.');
    }
    clearSession(ctx.from.id);
    const text = getOwnerCatPemasaranText();
    try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...getOwnerCatPemasaranKeyboard() });
    } catch {
        await ctx.reply(text, { parse_mode: 'Markdown', ...getOwnerCatPemasaranKeyboard() });
    }
});

bot.action('owner_broadcast', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('⛔ Restricted: This command can only be used by the store Owner / Admin.');
    }
    const session = getSession(ctx.from.id);
    session.state = 'OWNER_BROADCAST';

    const promptText = `📢 *SEND BROADCAST MESSAGE*\n` +
        `────────────\n` +
        `Recipients : *${registeredUsers.size} Users*\n\n` +
        `Please type the broadcast message to send to all bot users in this chat:\n` +
        `_(Supports bold, italic, links, and emoji)_\n\n` +
        `_Tip: You can also use these commands anytime:_\n` +
        `• \`/broadcast <pesan>\`\n` +
        `• \`/broadcastpin <pesan>\` (auto-pins the message)`;

    try {
        await ctx.editMessageText(promptText, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('« Cancel', 'owner_cat_pemasaran')]])
        });
    } catch {
        await ctx.reply(promptText, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('« Cancel', 'owner_cat_pemasaran')]])
        });
    }
});

bot.action('owner_channel_settings', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    if (!isOwner(ctx.from.id)) {
        return ctx.reply('⛔ Access Denied: Only the main store Owner can access channel settings.');
    }
    clearSession(ctx.from.id);

    const statusText = forceSubEnabled ? 'Active ✅' : 'Inactive ❌';
    const toggleBtnLabel = forceSubEnabled ? '🔴 Disable Join Requirement' : '🟢 Enable Join Requirement';

    const text = `⚙️ *TELEGRAM CHANNEL SETTINGS*\n` +
        `────────────\n` +
        `Manage the channel used for transaction proofs and bot usage requirements:\n\n` +
        `• Target Channel : *${CHANNEL_ID}*\n` +
        `• Required Join  : *${statusText}*\n` +
        `────────────\n` +
        `Please choose a settings option below:`;

    const kb = Markup.inlineKeyboard([
        [Markup.button.callback(toggleBtnLabel, 'owner_toggle_forcesub')],
        [Markup.button.callback('✏️ Change Channel Username', 'owner_change_channel')],
        [Markup.button.callback('« Back to Marketing', 'owner_cat_pemasaran')]
    ]);

    try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...kb });
    } catch {
        await ctx.reply(text, { parse_mode: 'Markdown', ...kb });
    }
});

bot.action('owner_toggle_forcesub', async (ctx) => {
    if (!isOwner(ctx.from.id)) {
        return ctx.answerCbQuery('⛔ Owner only.', { show_alert: true }).catch(() => { });
    }
    forceSubEnabled = !forceSubEnabled;
    const msg = forceSubEnabled ? '🟢 Required channel join ENABLED!' : '🔴 Required channel join DISABLED!';
    await ctx.answerCbQuery(msg, { show_alert: true }).catch(() => { });

    const statusText = forceSubEnabled ? 'Active ✅' : 'Inactive ❌';
    const toggleBtnLabel = forceSubEnabled ? '🔴 Disable Join Requirement' : '🟢 Enable Join Requirement';

    const text = `⚙️ *TELEGRAM CHANNEL SETTINGS*\n` +
        `────────────\n` +
        `Manage the channel used for transaction proofs and bot usage requirements:\n\n` +
        `• Target Channel : *${CHANNEL_ID}*\n` +
        `• Required Join  : *${statusText}*\n` +
        `────────────\n` +
        `Please choose a settings option below:`;

    const kb = Markup.inlineKeyboard([
        [Markup.button.callback(toggleBtnLabel, 'owner_toggle_forcesub')],
        [Markup.button.callback('✏️ Change Channel Username', 'owner_change_channel')],
        [Markup.button.callback('« Back to Marketing', 'owner_cat_pemasaran')]
    ]);

    try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...kb });
    } catch { }
});

bot.action('owner_change_channel', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    if (!isOwner(ctx.from.id)) {
        return ctx.reply('⛔ Restricted: This command can only be used by the store Owner.');
    }
    const session = getSession(ctx.from.id);
    session.state = 'OWNER_SET_CHANNEL';

    const promptText = `✏️ *CHANGE CHANNEL USERNAME*\n` +
        `────────────\n` +
        `Current channel: *${CHANNEL_ID}*\n\n` +
        `Please type your new channel username (example: \`@canvalive\`):\n` +
        `_(Make sure the bot is an Administrator in that channel so it can post notifications)_\n\n` +
        `_Or use the command: \`/setchannel <@channel>\`_`;

    try {
        await ctx.editMessageText(promptText, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('« Cancel', 'owner_channel_settings')]])
        });
    } catch {
        await ctx.reply(promptText, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('« Cancel', 'owner_channel_settings')]])
        });
    }
});

bot.action('owner_user_stats', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('⛔ Restricted: This command can only be used by the store Owner / Admin.');
    }
    clearSession(ctx.from.id);

    const text = `👥 *CUSTOMER DATA & STATS*\n` +
        `────────────\n` +
        `Here are the customer interaction stats for your Alight Motion bot:\n\n` +
        `• Total Registered Users : *${registeredUsers.size} Users*\n` +
        `• Active User Sessions   : *${userSessions.size} Sessions*\n` +
        `• Bulk Orders Running    : *${userBulkLock.size} Jobs*\n` +
        `• Order Queue Status    : *${isQueueOpen ? 'Open (Normal) ✅' : 'Closed (Maintenance) 🛑'}*\n` +
        `────────────\n` +
        `Verified Owner ID : \`${OWNER_ID || 'Not set'}\``;

    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('📢 Send Broadcast Message', 'owner_broadcast')],
        [Markup.button.callback('« Back to Marketing', 'owner_cat_pemasaran')]
    ]);

    try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...kb });
    } catch {
        await ctx.reply(text, { parse_mode: 'Markdown', ...kb });
    }
});

// Aksi Kategori 3: Pemeliharaan & Bantuan
bot.action('owner_cat_sistem', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('⛔ Restricted: This command can only be used by the store Owner / Admin.');
    }
    clearSession(ctx.from.id);
    const text = getOwnerCatSistemText();
    try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...getOwnerCatSistemKeyboard() });
    } catch {
        await ctx.reply(text, { parse_mode: 'Markdown', ...getOwnerCatSistemKeyboard() });
    }
});

bot.action('owner_check_otp', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('⛔ Restricted: This command can only be used by the store Owner / Admin.');
    }
    const session = getSession(ctx.from.id);
    session.state = 'OWNER_CHECK_OTP';

    const promptText = `📬 *CHECK BUYER INBOX & OTP*\n` +
        `────────────\n` +
        `Please type the buyer's email address you want to check:\n\n` +
        `• Example: \`alight1234@wikinime.com\`\n` +
        `• Or use the command: \`/cekinbox email_pembeli\`\n\n` +
        `Type the email address below:`;

    const keyboard = Markup.inlineKeyboard([[Markup.button.callback('« Cancel', 'owner_cat_sistem')]]);

    try {
        await ctx.editMessageText(promptText, {
            parse_mode: 'Markdown',
            ...keyboard
        });
    } catch {
        try {
            await ctx.reply(promptText, {
                parse_mode: 'Markdown',
                ...keyboard
            });
        } catch {
            await ctx.reply(promptText.replace(/[*_`]/g, ''), keyboard);
        }
    }
});

bot.action('owner_backup_data', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    if (!isOwner(ctx.from.id)) {
        return ctx.reply('⛔ Access Denied: Only the main store Owner can download database backups.');
    }
    return sendBackupFiles(ctx);
});

bot.action('owner_clear_cache', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.answerCbQuery('⛔ Owner / Admin only.', { show_alert: true }).catch(() => { });
    }
    const sessionCount = userSessions.size;
    userSessions.clear();
    userBulkLock.clear();
    userBulkStop.clear();

    await ctx.answerCbQuery('🧹 Memory cache & sessions cleared successfully!', { show_alert: true }).catch(() => { });

    const text = `🧹 *CACHE CLEARED SUCCESSFULLY*\n` +
        `────────────\n` +
        `• RAM sessions cleared : *${sessionCount} Sessions*\n` +
        `• Process Locks        : *0 (Free)*\n` +
        `• Bot Condition        : *Fresh & Light* ✅\n` +
        `────────────`;

    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('« Back to Maintenance', 'owner_cat_sistem')]
    ]);

    try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...kb });
    } catch {
        await ctx.reply(text, { parse_mode: 'Markdown', ...kb });
    }
});

bot.action('owner_help_cmd', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('⛔ Restricted: This command can only be used by the store Owner / Admin.');
    }
    clearSession(ctx.from.id);

    const text = getOwnerHelpText();
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('« Back to Maintenance', 'owner_cat_sistem')]
    ]);

    try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...kb });
    } catch {
        await ctx.reply(text, { parse_mode: 'Markdown', ...kb });
    }
});


// -------------------------------------------------------------
// 1. ALUR PEMBUATAN 1 AKUN (SATUAN)
// -------------------------------------------------------------
bot.action('menu_single', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    const userId = ctx.from.id;
    const lang = getUserLang(userId, ctx.from);

    if (isMaintenance && !isAdmin(userId)) {
        const { text, keyboard } = getMaintenanceCard(lang);
        try {
            return await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
        } catch {
            return await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
        }
    }

    if (!isQueueOpen && !isAdmin(userId)) {
        return ctx.reply(
            i18n.t(lang, 'alerts.queue_closed'),
            { parse_mode: 'Markdown', ...getMainKeyboard(userId, ctx.from) }
        );
    }

    const subscribed = await isUserSubscribed(userId);
    if (!subscribed) {
        try {
            return await ctx.editMessageText(getJoinChannelText(lang), {
                parse_mode: 'Markdown',
                ...getJoinChannelKeyboard(lang)
            });
        } catch {
            return await ctx.reply(getJoinChannelText(lang), {
                parse_mode: 'Markdown',
                ...getJoinChannelKeyboard(lang)
            });
        }
    }

    const isUserActive = typeof activeBulkJobs !== 'undefined'
        ? Array.from(activeBulkJobs.values()).some(q => q && q.userId === userId)
        : (activeBulkJob && activeBulkJob.userId === userId);
    if (userBulkLock.has(userId) || isUserActive || bulkQueue.some(q => q.userId === userId)) {
        return ctx.answerCbQuery('⚠️ Pilihan Anda sudah dikunci & pesanan sedang diproses.', { show_alert: true }).catch(() => {});
    }

    // Kunci langsung pada klik pertama (cukup sekali, anti double-click)
    userBulkLock.add(userId);
    await ctx.answerCbQuery('✅ Pilihan dikunci. Memproses 1 akun instan...').catch(() => {});

    // Hilangkan tombol pilihan di Telegram agar tidak bisa diklik ulang
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});

    const step1Text = i18n.t(lang, 'single.step_title') + i18n.t(lang, 'single.step1_working');

    let progressMsg;
    try {
        progressMsg = await ctx.editMessageText(step1Text, { parse_mode: 'Markdown' });
    } catch {
        progressMsg = await ctx.reply(step1Text, { parse_mode: 'Markdown' });
    }

    const targetMsgId = (progressMsg && typeof progressMsg === 'object' && progressMsg.message_id)
        ? progressMsg.message_id
        : (ctx.callbackQuery?.message?.message_id || ctx.message?.message_id);

    const singleStartTime = Date.now();
    logInfo('INSTAN', `👤 User ${userId} [${lang.toUpperCase()}] | Memulai pembuatan akun instan kilat...`);

    try {
        // 1. Buat email instan (0ms via pool domain)
        const mailRes = await api.getEmail(API_BASE_URL, 'single');
        if (!mailRes.success || !mailRes.email) throw new Error(mailRes.message || 'Gagal membuat email');
        const email = mailRes.email;

        // Update Step 2 secara real-time
        if (targetMsgId) {
            const step2Text = i18n.t(lang, 'single.step_title') + i18n.t(lang, 'single.step2_working', email);
            await ctx.telegram.editMessageText(ctx.chat.id, targetMsgId, null, step2Text, { parse_mode: 'Markdown' }).catch(() => { });
        }

        // 2. Kirim magic link langsung ke Firebase
        const sendRes = await api.sendLink(API_BASE_URL, email);
        if (!sendRes.success) throw new Error(sendRes.message || 'Gagal mengirim link aktivasi');

        // 3. Fast Polling inbox langsung (cepat ~350ms per check, tanpa fallback)
        let oob = null;
        let delayMs = 350;
        let totalElapsedMs = 0;
        const maxWaitMs = 15000;

        while (totalElapsedMs < maxWaitMs) {
            await new Promise(r => setTimeout(r, delayMs));
            totalElapsedMs += delayMs;

            const inboxRes = await api.checkInbox(API_BASE_URL, email, mailRes.provider, mailRes.token);
            if (inboxRes && inboxRes.success && inboxRes.data) {
                oob = api.extractOobCode(inboxRes.data);
                if (oob) break;
            }
        }

        if (!oob) throw new Error('Email verifikasi belum masuk. Silakan coba sesaat lagi.');

        // Update Step 3 secara real-time
        if (targetMsgId) {
            const step3Text = i18n.t(lang, 'single.step_title') + i18n.t(lang, 'single.step3_working', email);
            await ctx.telegram.editMessageText(ctx.chat.id, targetMsgId, null, step3Text, { parse_mode: 'Markdown' }).catch(() => { });
        }

        // 4. Verifikasi dan aktivasi lisensi 1 Tahun (1x Eksekusi Langsung tanpa retry/fallback)
        const verifyRes = await api.verifyLink(API_BASE_URL, email, `oobCode=${oob}`);
        if (!verifyRes || !verifyRes.success || !verifyRes.data) {
            throw new Error(verifyRes?.message || 'Gagal mengaktifkan lisensi');
        }

        // 5. Ambil tautan login segar (Fresh) agar bebas dari error "Kode tindakan tidak valid / sudah digunakan"
        const freshRes = await api.getFreshLoginLink(API_BASE_URL, email, oob, mailRes.provider, mailRes.token);
        const loginLink = (freshRes && freshRes.success && freshRes.loginLink) ? freshRes.loginLink : api.buildAlightLoginLink(oob);

        const successText = `${i18n.t(lang, 'single.success_title')}\n` +
            `━━━━━━━━━━━━━━\n\n` +
            `${i18n.t(lang, 'single.label_email')}: \`${email}\`\n\n` +
            `${i18n.t(lang, 'single.label_duration')}: ${i18n.t(lang, 'single.val_duration')}\n\n` +
            `${i18n.t(lang, 'single.label_status')}: ${i18n.t(lang, 'single.val_status')}\n\n` +
            `${i18n.t(lang, 'single.section_how_login')}\n\n` +
            `${i18n.t(lang, 'single.how_login_steps')}\n\n` +
            `━━━━━━━━━━━━━━\n` +
            `✨ Thank you for choosing us!`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.url(i18n.t(lang, 'single.btn_login'), loginLink)],
            [Markup.button.callback(i18n.t(lang, 'single.btn_check_otp'), `check_otp_${email}`)],
            [
                Markup.button.callback(i18n.t(lang, 'single.btn_create_again'), 'menu_single'),
                Markup.button.callback(i18n.t(lang, 'menu.btn_main_menu'), 'menu_main')
            ]
        ]);

        if (targetMsgId) {
            await ctx.telegram.editMessageText(ctx.chat.id, targetMsgId, null, successText, {
                parse_mode: 'Markdown',
                ...keyboard
            }).catch(async () => {
                await ctx.reply(successText, { parse_mode: 'Markdown', ...keyboard });
            });
        } else {
            await ctx.reply(successText, { parse_mode: 'Markdown', ...keyboard });
        }

        const singleDuration = ((Date.now() - singleStartTime) / 1000).toFixed(1);
        logInfo('INSTAN', `✅ SUKSES | ${email} (Durasi: ${singleDuration}s)`);

        // Kirim notifikasi bukti aktivasi ke Channel Telegram (Live)
        sendChannelNotification('SINGLE', { email, user: ctx.from });
    } catch (err) {
        handleAutoMaintenanceTrigger(err.message, 'AKUN SATUAN');
        logInfo('INSTAN', `❌ GAGAL User ${userId}: ${err.message}`);
        const cleanErr = safeFormatError(err.message, lang);
        const errorText = `${i18n.t(lang, 'single.error_title')}\n────────────\n${cleanErr}\n\n${i18n.t(lang, 'single.error_desc')}`;
        const errorKeyboard = Markup.inlineKeyboard([
            [Markup.button.callback(i18n.t(lang, 'menu.btn_try_again'), 'menu_single')],
            [Markup.button.callback(i18n.t(lang, 'menu.btn_main_menu'), 'menu_main')]
        ]);
        const plainText = errorText.replace(/[*_`]/g, '');

        if (targetMsgId) {
            await ctx.telegram.editMessageText(ctx.chat.id, targetMsgId, null, errorText, {
                parse_mode: 'Markdown',
                ...errorKeyboard
            }).catch(async () => {
                await ctx.telegram.editMessageText(ctx.chat.id, targetMsgId, null, plainText, {
                    ...errorKeyboard
                }).catch(async () => {
                    await ctx.reply(plainText, { ...errorKeyboard }).catch(() => {});
                });
            });
        } else {
            await ctx.reply(errorText, { parse_mode: 'Markdown', ...errorKeyboard }).catch(async () => {
                await ctx.reply(plainText, { ...errorKeyboard }).catch(() => {});
            });
        }
    } finally {
        userBulkLock.delete(userId);
    }
});

// -------------------------------------------------------------
// 2. ALUR PEMBUATAN BANYAK AKUN (MASAL)
// -------------------------------------------------------------
bot.action('menu_bulk', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    const userId = ctx.from.id;
    const lang = getUserLang(userId, ctx.from);

    if (isMaintenance && !isAdmin(userId)) {
        const { text, keyboard } = getMaintenanceCard(lang);
        try {
            return await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
        } catch {
            return await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
        }
    }

    if (!isQueueOpen && !isAdmin(userId)) {
        return ctx.reply(
            i18n.t(lang, 'alerts.queue_closed'),
            { parse_mode: 'Markdown', ...getMainKeyboard(userId, ctx.from) }
        );
    }

    const subscribed = await isUserSubscribed(userId);
    if (!subscribed) {
        try {
            return await ctx.editMessageText(getJoinChannelText(lang), {
                parse_mode: 'Markdown',
                ...getJoinChannelKeyboard(lang)
            });
        } catch {
            return await ctx.reply(getJoinChannelText(lang), {
                parse_mode: 'Markdown',
                ...getJoinChannelKeyboard(lang)
            });
        }
    }

    const isUserActiveInSlots = typeof activeBulkJobs !== 'undefined'
        ? Array.from(activeBulkJobs.values()).some(q => q && q.userId === userId)
        : (activeBulkJob && activeBulkJob.userId === userId);
    if (userBulkLock.has(userId) || isUserActiveInSlots || bulkQueue.some(q => q.userId === userId)) {
        return ctx.reply(i18n.t(lang, 'alerts.bulk_running'));
    }

    const text = i18n.t(lang, 'bulk.title');

    const bulkKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback(i18n.t(lang, 'bulk.btn_5'), 'bulk_run_5'), Markup.button.callback(i18n.t(lang, 'bulk.btn_15'), 'bulk_run_15')],
        [Markup.button.callback(i18n.t(lang, 'bulk.btn_25'), 'bulk_run_25'), Markup.button.callback(i18n.t(lang, 'bulk.btn_50'), 'bulk_run_50')],
        [Markup.button.callback(i18n.t(lang, 'bulk.btn_100'), 'bulk_run_100'), Markup.button.callback(i18n.t(lang, 'bulk.btn_custom'), 'bulk_custom_ask')],
        [styledBtn(i18n.t(lang, 'menu.btn_back'), 'menu_main', 'primary')]
    ]);

    try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...bulkKeyboard });
    } catch {
        await ctx.reply(text, { parse_mode: 'Markdown', ...bulkKeyboard });
    }
});

// Input Custom Count
bot.action('bulk_custom_ask', async (ctx) => {
    const userId = ctx.from.id;
    const isUserActive = typeof activeBulkJobs !== 'undefined'
        ? Array.from(activeBulkJobs.values()).some(q => q && q.userId === userId)
        : (activeBulkJob && activeBulkJob.userId === userId);
    if (userBulkLock.has(userId) || isUserActive || bulkQueue.some(q => q.userId === userId)) {
        return ctx.answerCbQuery('⚠️ Pilihan Anda sudah dikunci & pesanan sedang diproses.', { show_alert: true }).catch(() => {});
    }
    await ctx.answerCbQuery().catch(() => { });
    const lang = getUserLang(userId, ctx.from);
    const session = getSession(userId);
    session.state = 'AWAITING_CUSTOM_COUNT';

    const text = i18n.t(lang, 'bulk.custom_ask_title');

    try {
        await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback(i18n.t(lang, 'menu.btn_cancel'), 'menu_bulk')]])
        });
    } catch {
        await ctx.reply(text, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback(i18n.t(lang, 'menu.btn_cancel'), 'menu_bulk')]])
        });
    }
});

// =============================================================
// SISTEM ANTREAN & PEMROSESAN PESANAN MASAL (MULTI-SLOT TURBO 4 JALUR)
// =============================================================

const MAX_BULK_SLOTS = 4;
const MAX_TOTAL_WORKERS = 12;

let activeBulkJob = null; // Kompatibilitas mundur
const activeBulkJobs = new Map(); // jobId -> jobState
const bulkQueue = [];

const BULK_STATE_FILE = path.join(DATA_DIR, 'bulk_active_job.json');
const BULK_QUEUE_FILE = path.join(DATA_DIR, 'bulk_queue.json');

function saveActiveBulkState() {
    activeBulkJob = activeBulkJobs.values().next().value || null;
    if (activeBulkJobs.size === 0) {
        try {
            if (fs.existsSync(BULK_STATE_FILE)) fs.unlinkSync(BULK_STATE_FILE);
        } catch { }
        return;
    }
    try {
        const payload = Array.from(activeBulkJobs.values()).map(job => ({
            jobId: job.jobId,
            userId: job.userId,
            chatId: job.chatId,
            count: job.count,
            startTime: job.startTime,
            successCount: job.successCount || 0,
            failCount: job.failCount || 0,
            progressMsgId: job.progressMsgId || null,
            accountsList: job.accountsList || [],
            user: job.user || null,
            lastUpdated: new Date().toISOString()
        }));
        fs.writeFileSync(BULK_STATE_FILE, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
        console.error('[BulkPersistence] Gagal menyimpan active jobs:', err.message);
    }
}

function clearActiveBulkState() {
    try {
        if (fs.existsSync(BULK_STATE_FILE)) fs.unlinkSync(BULK_STATE_FILE);
    } catch { }
}

function saveBulkQueue() {
    try {
        const serializableQueue = bulkQueue.map(item => ({
            jobId: item.jobId,
            userId: item.userId,
            chatId: item.chatId,
            count: item.count,
            ticketMsgId: item.ticketMsgId || null,
            user: item.user || null
        }));
        fs.writeFileSync(BULK_QUEUE_FILE, JSON.stringify(serializableQueue, null, 2), 'utf-8');
    } catch (err) {
        console.error('[BulkPersistence] Gagal menyimpan antrean:', err.message);
    }
}

function loadBulkQueue() {
    try {
        if (fs.existsSync(BULK_QUEUE_FILE)) {
            const raw = fs.readFileSync(BULK_QUEUE_FILE, 'utf-8');
            const data = JSON.parse(raw);
            if (Array.isArray(data) && data.length > 0) {
                bulkQueue.length = 0;
                data.forEach(item => bulkQueue.push(item));
                logInfo('QUEUE', `📂 Memulihkan ${bulkQueue.length} antrean pesanan masal dari disk.`);
            }
        }
    } catch (err) {
        console.error('[BulkPersistence] Gagal memuat antrean dari disk:', err.message);
    }
}

async function resumeActiveBulkJobIfAny() {
    try {
        if (fs.existsSync(BULK_STATE_FILE)) {
            const raw = fs.readFileSync(BULK_STATE_FILE, 'utf-8');
            const saved = JSON.parse(raw);
            const list = Array.isArray(saved) ? saved : (saved && saved.jobId ? [saved] : []);
            for (const item of list) {
                if (item && item.jobId && item.userId && item.count && activeBulkJobs.size < MAX_BULK_SLOTS) {
                    const alreadyDone = item.successCount || (item.accountsList ? item.accountsList.length : 0);
                    logInfo('BULK', `🔄 AUTO-RESUME: Memulihkan pesanan masal tertunda (Job: ${item.jobId}) untuk User ${item.userId}`);
                    logInfo('BULK', `Progres tersimpan: ${alreadyDone}/${item.count} Akun. Melanjutkan pengerjaan di slot...`);
                    startBulkJob({
                        userId: item.userId,
                        chatId: item.chatId,
                        count: item.count,
                        ticketMsgId: item.progressMsgId,
                        jobId: item.jobId,
                        user: item.user,
                        resumedData: item
                    }).catch((err) => {
                        console.error('[BulkRecovery] Error saat melanjutkan job:', err.message);
                        activeBulkJobs.delete(item.jobId);
                        userBulkLock.delete(item.userId);
                        userBulkStop.delete(item.userId);
                        saveActiveBulkState();
                        dispatchNextBulkSlots();
                    });
                }
            }
        }
    } catch (err) {
        console.error('[BulkPersistence] Gagal resume active bulk jobs:', err.message);
    }

    dispatchNextBulkSlots();
}

function renderProgressBar(current, total, barLength = 10) {
    if (total <= 0) return '▱'.repeat(barLength);
    const ratio = Math.min(Math.max(current / total, 0), 1);
    const filled = Math.round(ratio * barLength);
    const empty = barLength - filled;
    return '▰'.repeat(filled) + '▱'.repeat(empty);
}

function formatEstimate(seconds, lang = 'id') {
    if (seconds <= 0) return i18n.t(lang, 'bulk.time_short');
    if (seconds < 60) return i18n.t(lang, 'bulk.time_sec', Math.max(5, Math.round(seconds)));
    const mins = (seconds / 60).toFixed(1);
    return mins.endsWith('.0') ? i18n.t(lang, 'bulk.time_min', Math.round(seconds / 60)) : i18n.t(lang, 'bulk.time_min', mins);
}

function getQueueWaitSeconds(targetJobId) {
    let waitSec = 0;
    for (const job of activeBulkJobs.values()) {
        const remaining = Math.max(1, job.count - (job.successCount || 0));
        waitSec += Math.ceil((remaining / 4) * 4);
    }
    for (const item of bulkQueue) {
        if (item.jobId === targetJobId) break;
        waitSec += Math.ceil((item.count / 4) * 4);
    }
    return Math.max(5, Math.ceil(waitSec / MAX_BULK_SLOTS));
}

async function updateRemainingQueueTickets() {
    for (let idx = 0; idx < bulkQueue.length; idx++) {
        const item = bulkQueue[idx];
        const newPos = idx + 1;
        const itemLang = getUserLang(item.userId, item.user);
        const waitSec = getQueueWaitSeconds(item.jobId);
        const estText = formatEstimate(waitSec, itemLang);

        const updatedTicket = `${i18n.t(itemLang, 'bulk.ticket_title')}\n` +
            `────────────\n` +
            `${i18n.t(itemLang, 'bulk.ticket_package', item.count)}\n` +
            `${i18n.t(itemLang, 'bulk.ticket_pos', newPos)}\n` +
            `${i18n.t(itemLang, 'bulk.ticket_status', activeBulkJobs.size)}\n` +
            `${i18n.t(itemLang, 'bulk.ticket_est', estText)}\n` +
            `────────────\n` +
            `${i18n.t(itemLang, 'bulk.ticket_footer')}`;

        const kb = Markup.inlineKeyboard([
            [Markup.button.callback(i18n.t(itemLang, 'bulk.btn_cancel_queue'), `cancel_queue_${item.jobId}`)]
        ]);

        const telegram = item.ctx?.telegram || bot.telegram;
        if (item.ticketMsgId && item.chatId) {
            try {
                await telegram.editMessageText(item.chatId, item.ticketMsgId, null, updatedTicket, {
                    parse_mode: 'Markdown',
                    ...kb
                });
            } catch { }
        }
    }
}

// Tangani Tombol Hentikan Pengerjaan (Stop)
bot.action('bulk_stop', async (ctx) => {
    const userId = ctx.from.id;
    const lang = getUserLang(userId, ctx.from);
    userBulkStop.set(userId, true);
    for (const job of activeBulkJobs.values()) {
        if (job.userId === userId) {
            job.isStopping = true;
        }
    }
    if (activeBulkJob && activeBulkJob.userId === userId) {
        activeBulkJob.isStopping = true;
    }
    await ctx.answerCbQuery(i18n.t(lang, 'bulk.stopping_notice').split('\n')[0] || 'Stopping...').catch(() => { });

    const stopNotice = i18n.t(lang, 'bulk.stopping_notice');

    try {
        await ctx.editMessageText(stopNotice, { parse_mode: 'Markdown' });
    } catch { }
});

// Tangani Pembatalan Antrean
bot.action(/cancel_queue_(.+)/, async (ctx) => {
    const targetJobId = ctx.match[1];
    const userId = ctx.from.id;
    const lang = getUserLang(userId, ctx.from);
    const idx = bulkQueue.findIndex(q => q.jobId === targetJobId && q.userId === userId);

    if (idx === -1) {
        return ctx.answerCbQuery('Antrean tidak ditemukan atau sudah mulai diproses!').catch(() => { });
    }

    const removed = bulkQueue.splice(idx, 1)[0];
    saveBulkQueue();
    await ctx.answerCbQuery('Antrean berhasil dibatalkan.').catch(() => { });

    const cancelText = `🛑 *ANTREAN DIBATALKAN*\n` +
        `────────────\n` +
        `Pesanan masal Anda (${removed.count} Akun) telah dibatalkan dari antrean.\n\n` +
        `Pesanan belum diproses dan saldo/kuota Anda tetap aman.`;

    const cancelKb = Markup.inlineKeyboard([
        [styledBtn(i18n.t(lang, 'menu.btn_bulk'), 'menu_bulk', 'success')],
        [Markup.button.callback(i18n.t(lang, 'menu.btn_main_menu'), 'menu_main')]
    ]);

    try {
        await ctx.editMessageText(cancelText, { parse_mode: 'Markdown', ...cancelKb });
    } catch {
        await ctx.reply(cancelText, { parse_mode: 'Markdown', ...cancelKb });
    }

    logInfo('QUEUE', `🛑 User ${userId} membatalkan antrean Job: ${targetJobId}`);
    updateRemainingQueueTickets();
});

// Entry Point Eksekusi Masal (Smart Multi-Slot Router)
async function executeBulk(ctx, count) {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const lang = getUserLang(userId, ctx.from);

    if (isMaintenance && !isAdmin(userId)) {
        const { text, keyboard } = getMaintenanceCard(lang);
        return ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
    }

    if (!isQueueOpen && !isAdmin(userId)) {
        return ctx.reply(
            i18n.t(lang, 'alerts.queue_closed'),
            { parse_mode: 'Markdown', ...getMainKeyboard(userId, ctx.from) }
        );
    }

    const isUserActive = Array.from(activeBulkJobs.values()).some(q => q && q.userId === userId);
    if (isUserActive || (activeBulkJob && activeBulkJob.userId === userId)) {
        return ctx.reply(i18n.t(lang, 'alerts.process_running'));
    }

    const existingIdx = bulkQueue.findIndex(q => q.userId === userId);
    if (existingIdx !== -1) {
        return ctx.reply(i18n.t(lang, 'alerts.already_in_queue', existingIdx + 1));
    }

    // Jika masih ada slot kosong (kurang dari MAX_BULK_SLOTS), langsung jalankan!
    if (activeBulkJobs.size < MAX_BULK_SLOTS) {
        return startBulkJob({
            ctx,
            userId,
            chatId,
            count,
            ticketMsgId: null
        });
    }

    // Jika semua 4 slot sedang aktif, terbitkan Tiket Antrean
    const jobId = `JOB_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const position = bulkQueue.length + 1;
    const waitSec = getQueueWaitSeconds(jobId);
    const estText = formatEstimate(waitSec, lang);

    const ticketText = `${i18n.t(lang, 'bulk.ticket_title')}\n` +
        `────────────\n` +
        `${i18n.t(lang, 'bulk.ticket_package', count)}\n` +
        `${i18n.t(lang, 'bulk.ticket_pos', position)}\n` +
        `${i18n.t(lang, 'bulk.ticket_status', activeBulkJobs.size)}\n` +
        `${i18n.t(lang, 'bulk.ticket_est', estText)}\n` +
        `────────────\n` +
        `${i18n.t(lang, 'bulk.ticket_footer')}`;

    const ticketKb = Markup.inlineKeyboard([
        [Markup.button.callback(i18n.t(lang, 'bulk.btn_cancel_queue'), `cancel_queue_${jobId}`)]
    ]);

    let ticketMsg = await ctx.reply(ticketText, {
        parse_mode: 'Markdown',
        ...ticketKb
    });

    bulkQueue.push({
        jobId,
        userId,
        chatId,
        count,
        ticketMsgId: ticketMsg.message_id,
        user: ctx.from,
        ctx
    });
    saveBulkQueue();

    logInfo('QUEUE', `🎫 User ${userId} [${lang.toUpperCase()}] masuk antrean ke-#${position} (${count} Akun) | Job: ${jobId}`);
}

// Eksekusi Pengerjaan Masal Real-Time Multi-Slot
async function startBulkJob(jobData) {
    const { ctx, userId, chatId, count, ticketMsgId, jobId, user, resumedData } = jobData;
    const currentJobId = jobId || `JOB_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const telegram = ctx?.telegram || bot.telegram;
    const lang = getUserLang(userId, user || ctx?.from);

    const initialAccountsList = (resumedData && Array.isArray(resumedData.accountsList)) ? resumedData.accountsList : [];
    let successCount = (resumedData && typeof resumedData.successCount === 'number') ? resumedData.successCount : initialAccountsList.length;
    let failCount = (resumedData && typeof resumedData.failCount === 'number') ? resumedData.failCount : 0;
    let nextIndex = successCount + 1;
    const accountsList = [...initialAccountsList];

    const currentJob = {
        jobId: currentJobId,
        userId,
        chatId,
        count,
        startTime: (resumedData && resumedData.startTime) ? resumedData.startTime : Date.now(),
        currentI: nextIndex,
        successCount,
        failCount,
        isStopping: false,
        lastEditTime: 0,
        ctx,
        user: user || ctx?.from || null,
        accountsList
    };

    const usedSlots = new Set(Array.from(activeBulkJobs.values()).map(j => j.slotNumber).filter(Boolean));
    let assignedSlot = 1;
    for (let s = 1; s <= MAX_BULK_SLOTS; s++) {
        if (!usedSlots.has(s)) {
            assignedSlot = s;
            break;
        }
    }
    currentJob.slotNumber = (resumedData && resumedData.slotNumber) ? resumedData.slotNumber : assignedSlot;

    activeBulkJobs.set(currentJobId, currentJob);
    activeBulkJob = currentJob;

    userBulkLock.add(userId);
    userBulkStop.set(userId, false);
    saveActiveBulkState();

    const bulkStartTime = currentJob.startTime;
    const activeCount = Math.max(1, activeBulkJobs.size);
    const maxAllowedWorkers = count <= 5 ? Math.min(count, 3) : (count <= 25 ? 4 : 6);
    const CONCURRENCY = Math.max(1, Math.min(maxAllowedWorkers, Math.floor(MAX_TOTAL_WORKERS / activeCount)));

    if (resumedData) {
        logInfo('BULK', `🔄 [SLOT ${currentJob.slotNumber}/${MAX_BULK_SLOTS}] MELANJUTKAN | User ${userId} [${lang.toUpperCase()}] | ${successCount}/${count} Selesai | Lanjut Akun #${nextIndex}... | Job: ${currentJobId}`);
    } else {
        logInfo('BULK', `📦 [SLOT ${currentJob.slotNumber}/${MAX_BULK_SLOTS}] User ${userId} [${lang.toUpperCase()}] | Mulai masal: ${count} Akun (${CONCURRENCY} Worker Paralel) | Job: ${currentJobId}`);
    }

    let progressMsg = null;
    const percent = Math.floor((successCount / count) * 100);
    const initialBar = renderProgressBar(successCount, count, 10);
    const remainingSec = Math.ceil(((count - successCount) / CONCURRENCY) * 4);
    const initialEst = formatEstimate(remainingSec, lang);

    const initialText = `${i18n.t(lang, 'bulk.proc_title')}\n` +
        `────────────\n` +
        `${i18n.t(lang, 'bulk.proc_progress', initialBar, percent, successCount, count)}\n` +
        (resumedData ? `${i18n.t(lang, 'bulk.proc_status_resumed', nextIndex)}\n` : `${i18n.t(lang, 'bulk.proc_status_prep')}\n`) +
        `${i18n.t(lang, 'bulk.proc_est', initialEst)}\n` +
        `────────────\n` +
        `${i18n.t(lang, 'bulk.proc_footer')}`;

    const progressKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback(i18n.t(lang, 'bulk.btn_stop'), 'bulk_stop')]
    ]);

    if (ticketMsgId) {
        try {
            await telegram.editMessageText(chatId, ticketMsgId, null, initialText, {
                parse_mode: 'Markdown',
                ...progressKeyboard
            });
            progressMsg = { message_id: ticketMsgId };
        } catch {
            progressMsg = await telegram.sendMessage(chatId, initialText, {
                parse_mode: 'Markdown',
                ...progressKeyboard
            }).catch(() => null);
        }
    } else {
        progressMsg = await telegram.sendMessage(chatId, initialText, {
            parse_mode: 'Markdown',
            ...progressKeyboard
        }).catch(() => null);
    }

    currentJob.progressMsgId = progressMsg?.message_id;
    saveActiveBulkState();

    let lastEditTime = 0;
    async function updateProgressUI(force = false) {
        if (!progressMsg?.message_id) return;
        if (userBulkStop.get(userId) || currentJob.isStopping) return;

        const now = Date.now();
        if (!force && (now - lastEditTime < 1200)) return;
        lastEditTime = now;

        const pCent = Math.min(100, Math.floor((successCount / count) * 100));
        const bar = renderProgressBar(successCount, count, 10);
        const remAccounts = Math.max(0, count - successCount);
        const remSec = Math.ceil((remAccounts / CONCURRENCY) * 4);
        const remEstText = formatEstimate(remSec, lang);
        const currDisplayI = Math.min(successCount + 1, count);

        const updateText = `${i18n.t(lang, 'bulk.proc_title')}\n` +
            `────────────\n` +
            `${i18n.t(lang, 'bulk.proc_progress', bar, pCent, successCount, count)}\n` +
            `${i18n.t(lang, 'bulk.proc_status_acc', currDisplayI)}\n` +
            `${i18n.t(lang, 'bulk.proc_est', remEstText)}\n` +
            `────────────\n` +
            `${i18n.t(lang, 'bulk.proc_footer')}`;

        await telegram.editMessageText(
            chatId,
            progressMsg.message_id,
            null,
            updateText,
            {
                parse_mode: 'Markdown',
                ...progressKeyboard
            }
        ).catch(() => { });
    }

    let inFlight = 0;
    let consecutiveFails = 0;

    async function worker(workerId) {
        while (successCount < count) {
            if (userBulkStop.get(userId) || currentJob.isStopping) {
                break;
            }

            // Mencegah worker melebihi sisa target pesanan
            if (successCount + inFlight >= count) {
                await new Promise(r => setTimeout(r, 300));
                continue;
            }

            inFlight++;
            const currentDisplayI = Math.min(count, successCount + inFlight);
            currentJob.currentI = currentDisplayI;

            updateProgressUI(false);

            try {
                // 1. Buat email mode bulk (rotasi multi-domain aktif 0ms)
                const mailRes = await api.getEmail(API_BASE_URL, 'bulk');
                if (!mailRes.success || !mailRes.email) throw new Error('Gagal buat email');
                const email = mailRes.email;

                // 2. Kirim magic link ke Google Firebase
                const sendRes = await api.sendLink(API_BASE_URL, email);
                if (!sendRes.success) throw new Error('Gagal kirim link');

                // 3. Fast Polling inbox langsung (cepat ~350ms per check, tanpa auto-fallback)
                let oob = null;
                let delayMs = 350;
                let totalElapsedMs = 0;
                const maxWaitMs = 25000;

                while (totalElapsedMs < maxWaitMs) {
                    if (userBulkStop.get(userId) || currentJob.isStopping) break;
                    await new Promise(r => setTimeout(r, delayMs));
                    totalElapsedMs += delayMs;

                    const inboxRes = await api.checkInbox(API_BASE_URL, email, mailRes.provider, mailRes.token);
                    if (inboxRes && inboxRes.success && inboxRes.data) {
                        oob = api.extractOobCode(inboxRes.data);
                        if (oob) break;
                    }
                }

                if ((userBulkStop.get(userId) || currentJob.isStopping) && !oob) {
                    break;
                }

                if (!oob) throw new Error('Timeout: Link belum masuk');

                // 4. Verifikasi dan aktivasi lisensi 1 Tahun (1x Eksekusi Langsung)
                const verifyRes = await api.verifyLink(API_BASE_URL, email, `oobCode=${oob}`);

                if (verifyRes && verifyRes.success && verifyRes.data) {
                    // 5. Ambil Link Login instan resmi Alight Motion
                    const loginLink = api.buildAlightLoginLink(oob);
                    const orderId = verifyRes.data.orderId || orderCounter.getNextOrderId();

                    successCount++;
                    consecutiveFails = 0; // Reset fail counter
                    currentJob.successCount = successCount;
                    accountsList.push({
                        orderId: orderId,
                        email: email,
                        loginLink: loginLink
                    });
                    saveActiveBulkState();

                    const padLen = count >= 1000 ? 4 : (count >= 100 ? 3 : 2);
                    const padI = String(successCount).padStart(padLen, '0');
                    const padTot = String(count).padStart(padLen, '0');
                    logInfo('BULK', `[SLOT ${currentJob.slotNumber || 1}] [${padI}/${padTot}] ✅ ${email}`);

                    // LANGSUNG UPDATE PROGRES DI TELEGRAM SECARA REAL-TIME!
                    updateProgressUI(true);
                } else {
                    throw new Error('Aktivasi lisensi gagal');
                }
            } catch (err) {
                consecutiveFails++;
                if (err.message && (err.message.includes('QUOTA_EXCEEDED') || err.message.includes('Exceeded daily quota'))) {
                    handleAutoMaintenanceTrigger(err.message, 'AKUN MASAL');
                    currentJob.isStopping = true;
                } else if (consecutiveFails >= 30) {
                    logInfo('BULK', `⚠️ [SLOT ${currentJob.slotNumber || 1}] Dihentikan karena 30 kegagalan berturut-turut (${err.message})`);
                    currentJob.isStopping = true;
                }

                if (!userBulkStop.get(userId) && !currentJob.isStopping) {
                    failCount++;
                    currentJob.failCount = failCount;
                    logInfo('BULK', `[SLOT ${currentJob.slotNumber || 1}] ❌ Gagal 1 akun (${err.message}) -> Mengambil email baru...`);
                    // Backoff singkat 1.5s agar antrean email/jaringan tidak bertumpuk
                    await new Promise(r => setTimeout(r, 1500));
                }
            } finally {
                inFlight--;
            }
        }
    }

    try {
        const workers = [];
        for (let w = 0; w < CONCURRENCY; w++) {
            workers.push(new Promise(r => setTimeout(r, w * 250)).then(() => worker(w + 1)));
        }
        await Promise.all(workers);

        // Hapus pesan progress
        if (progressMsg?.message_id) {
            try {
                await telegram.deleteMessage(chatId, progressMsg.message_id);
            } catch { }
        }

        const wasStopped = userBulkStop.get(userId) || currentJob.isStopping;

        if (successCount > 0) {
            accountsList.sort((a, b) => {
                const numA = parseInt(a.orderId.replace(/\D/g, ''), 10) || 0;
                const numB = parseInt(b.orderId.replace(/\D/g, ''), 10) || 0;
                return numA - numB;
            });

            const bulkDuration = Math.round((Date.now() - bulkStartTime) / 1000);
            const firstOrderId = accountsList[0].orderId;
            const lastOrderId = accountsList[accountsList.length - 1].orderId;
            const rangeOrderId = accountsList.length > 1 ? `${firstOrderId} - ${lastOrderId}` : firstOrderId;

            // Header File Dokumen TXT
            let fileContent = `====================================================\n`;
            fileContent += `       DAFTAR AKUN ALIGHT MOTION PREMIUM            \n`;
            fileContent += `====================================================\n`;
            fileContent += `Total Akun  : ${successCount} Akun\n`;
            fileContent += `Durasi      : 1 Tahun (365 Hari)\n`;
            fileContent += `Masa Aktif  : Hingga ${new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}\n`;
            fileContent += `Tanggal     : ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}\n`;
            fileContent += `====================================================\n\n`;

            const padLen = count >= 1000 ? 4 : (count >= 100 ? 3 : 2);
            accountsList.forEach((acc, index) => {
                const num = String(index + 1).padStart(padLen, '0');
                fileContent += `[${num}]\n`;
                fileContent += `Email      : ${acc.email}\n`;
                fileContent += `Link Login : ${acc.loginLink}\n`;
                fileContent += `----------------------------------------------------\n`;
            });

            fileContent += `\nCara Login:\n`;
            fileContent += `1. Buka aplikasi Alight Motion.\n`;
            fileContent += `2. Link login di atas dapat langsung diklik atau disalin ke browser.\n`;
            fileContent += `3. Akun otomatis menjadi Pro 1 Tahun.\n`;

            const buffer = Buffer.from(fileContent, 'utf-8');
            const fileName = `AlightMotion_Pro_${successCount}_Akun.txt`;

            const titleHeader = wasStopped ? i18n.t(lang, 'bulk.done_title_stopped') : i18n.t(lang, 'bulk.done_title');
            const doneText = `${titleHeader}\n` +
                `────────────\n` +
                `${i18n.t(lang, 'bulk.label_report')}\n\n` +
                `${i18n.t(lang, 'bulk.label_total_accounts', successCount)}\n` +
                `${i18n.t(lang, 'bulk.label_validity')}\n` +
                `${i18n.t(lang, 'bulk.label_duration_time', bulkDuration)}\n` +
                `────────────\n` +
                `${i18n.t(lang, 'bulk.file_footer')}`;

            const resultKb = Markup.inlineKeyboard([
                [Markup.button.callback(i18n.t(lang, 'single.btn_check_otp'), 'bulk_check_otp')],
                [
                    Markup.button.callback(i18n.t(lang, 'bulk.btn_order_again'), 'menu_bulk'),
                    Markup.button.callback(i18n.t(lang, 'menu.btn_main_menu'), 'menu_main')
                ]
            ]);

            await telegram.sendDocument(
                chatId,
                { source: buffer, filename: fileName },
                {
                    caption: doneText,
                    parse_mode: 'Markdown',
                    ...resultKb
                }
            ).catch(async (docErr) => {
                console.error('[Bulk] Gagal sendDocument, mencoba sendMessage:', docErr.message);
                await telegram.sendMessage(chatId, doneText, { parse_mode: 'Markdown', ...resultKb });
            });

            logInfo('BULK', `🎉 SELESAI | ${successCount}/${count} Akun Berhasil | File .txt terkirim (Durasi: ${bulkDuration}s)`);

            // Kirim notifikasi pesanan masal ke Channel Telegram (Live)
            sendChannelNotification('BULK', { count: successCount, orderId: rangeOrderId, user: user || ctx?.from || currentJob?.user });
        } else {
            logInfo('BULK', `❌ GAGAL | Tidak ada akun yang berhasil dibuat untuk user ${userId}`);
            const errorText = `❌ *Tidak Ada Akun yang Berhasil*\n────────────\nTerjadi kendala saat memproses pesanan masal. Silakan coba lagi beberapa saat lagi.`;
            const errorKb = Markup.inlineKeyboard([
                [Markup.button.callback(i18n.t(lang, 'menu.btn_try_again'), 'menu_bulk')],
                [Markup.button.callback(i18n.t(lang, 'menu.btn_main_menu'), 'menu_main')]
            ]);
            await telegram.sendMessage(chatId, errorText, { parse_mode: 'Markdown', ...errorKb }).catch(() => { });
        }
    } catch (err) {
        console.error(`[Bulk] Error eksekusi bulk untuk user ${userId}:`, err.message);
    } finally {
        userBulkLock.delete(userId);
        userBulkStop.delete(userId);
        activeBulkJobs.delete(currentJobId);
        activeBulkJob = activeBulkJobs.values().next().value || null;
        saveActiveBulkState();
        dispatchNextBulkSlots();
    }
}

function dispatchNextBulkSlots() {
    while (activeBulkJobs.size < MAX_BULK_SLOTS && bulkQueue.length > 0) {
        const nextJob = bulkQueue.shift();
        saveBulkQueue();
        logInfo('QUEUE', `⏩ [SLOT ${activeBulkJobs.size + 1}/${MAX_BULK_SLOTS}] Memproses: User ${nextJob.userId} (${nextJob.count} Akun) | Job: ${nextJob.jobId}`);
        startBulkJob(nextJob).catch((err) => {
            console.error('[Queue] Error saat menjalankan slot:', err.message);
            activeBulkJobs.delete(nextJob.jobId);
            userBulkLock.delete(nextJob.userId);
            userBulkStop.delete(nextJob.userId);
            saveActiveBulkState();
            dispatchNextBulkSlots();
        });
    }
    updateRemainingQueueTickets();
}

function processNextInQueue() {
    dispatchNextBulkSlots();
}

// Handler Tombol Paket (Pilihan Ganda Dikunci Cukup Sekali)
bot.action(/bulk_run_(\d+)/, async (ctx) => {
    const userId = ctx.from.id;
    const isUserActive = typeof activeBulkJobs !== 'undefined'
        ? Array.from(activeBulkJobs.values()).some(q => q && q.userId === userId)
        : (activeBulkJob && activeBulkJob.userId === userId);
    if (userBulkLock.has(userId) || isUserActive || bulkQueue.some(q => q.userId === userId)) {
        return ctx.answerCbQuery('⚠️ Pilihan Anda sudah dikunci & pesanan sedang diproses.', { show_alert: true }).catch(() => {});
    }

    // Kunci langsung pada klik pertama (cukup sekali, anti spam / klik ganda)
    userBulkLock.add(userId);
    await ctx.answerCbQuery('✅ Pilihan dikunci. Memproses paket masal...').catch(() => {});

    // Segera hilangkan tombol pilihan ganda di pesan Telegram agar tidak bisa diklik lagi
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});

    const count = parseInt(ctx.match[1], 10);
    executeBulk(ctx, count).catch((err) => {
        userBulkLock.delete(userId);
        console.error('Error executing bulk:', err.message);
    });
});

// -------------------------------------------------------------
// Fitur: Cek Kotak Masuk & OTP Real-Time Otomatis
// -------------------------------------------------------------
async function renderInboxView(ctx, email, isEdit = false, targetMsgId = null) {
    const cleanEmail = String(email).replace('%40', '@').trim();

    if (ctx.callbackQuery) {
        try {
            await ctx.answerCbQuery('Memeriksa kotak masuk...').catch(() => { });
        } catch { }
    }

    try {
        const inboxRes = await api.checkInbox(API_BASE_URL, cleanEmail);
        const rawList = (inboxRes && inboxRes.data) ? (Array.isArray(inboxRes.data) ? inboxRes.data : [inboxRes.data]) : [];

        // Filter ketat Anti-Spam & Anti-Judol (Slot, Gacor, Casino, dll)
        const GAMBLING_SPAM_WORDS = ['slot', 'bet', 'judi', 'judol', 'gacor', 'togel', 'casino', 'poker', 'sbobet', 'maxwin', 'zeus', 'depo', 'hoki', 'jackpot', 'spin', 'pragmatic', 'olympus', 'sensasional', 'cuan', 'rupiah', 'bola88', 'parlay'];
        const isSpam = (txt) => {
            if (!txt) return false;
            const low = String(txt).toLowerCase();
            return GAMBLING_SPAM_WORDS.some(w => low.includes(w));
        };

        const cleanMessages = rawList.filter(m => {
            if (!m) return false;
            const from = String(m.from?.name || m.from?.address || m.from || m.mail_from || '');
            const subj = String(m.subject || m.mail_subject || '');
            const body = String(m.body_text || m.mail_body || m.text || m.intro || m.html || m.body || '');
            if (isSpam(from) || isSpam(subj) || isSpam(body)) return false;
            return subj || from || body;
        });

        // Utamakan pesan resmi dari Alight Creative jika ada
        const alightPriority = cleanMessages.filter(m => {
            const from = String(m.from?.name || m.from?.address || m.from || m.mail_from || '').toLowerCase();
            const subj = String(m.subject || m.mail_subject || '').toLowerCase();
            return from.includes('alight') || from.includes('firebase') || subj.includes('alight') || subj.includes('sign in') || subj.includes('creative') || subj.includes('login') || subj.includes('autentikasi') || subj.includes('auth');
        });

        const messages = alightPriority.length > 0 ? alightPriority : cleanMessages;

        const isAdm = ctx.from && isAdmin(ctx.from.id);
        const backBtn = isAdm
            ? Markup.button.callback('« Kembali ke Pemeliharaan', 'owner_cat_sistem')
            : Markup.button.callback('« Kembali ke Menu Utama', 'menu_main');

        if (messages.length === 0) {
            const emptyText = `📬 *KOTAK MASUK EMAIL*\n` +
                `────────────\n` +
                `📧 Akun: \`${cleanEmail}\`\n\n` +
                `📭 *Belum Ada Pesan Masuk.*\n\n` +
                `💡 *Kenapa Masih Kosong?*\n` +
                `Pesan dari Alight Motion biasanya butuh waktu sekitar 5–10 detik untuk sampai.\n\n` +
                `👉 *Jika Anda baru saja meminta "Ubah Email" di aplikasi:*\n` +
                `Tunggu beberapa detik, lalu klik tombol *🔄 Segarkan* di bawah.`;

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('🔄 Segarkan (Refresh)', `refresh_otp_${cleanEmail}`)],
                [backBtn]
            ]);

            if (targetMsgId) {
                return await ctx.telegram.editMessageText(ctx.chat.id, targetMsgId, null, emptyText, { parse_mode: 'Markdown', ...keyboard }).catch(async () => {
                    await ctx.reply(emptyText, { parse_mode: 'Markdown', ...keyboard });
                });
            } else if (isEdit) {
                return await ctx.editMessageText(emptyText, { parse_mode: 'Markdown', ...keyboard }).catch(() => { });
            } else {
                return await ctx.reply(emptyText, { parse_mode: 'Markdown', ...keyboard });
            }
        }

        // 1. Urutkan pesan dari yang paling baru (Newest First) agar aksi terakhir (Ubah Email / OTP) langsung terbaca
        messages.sort((a, b) => {
            const timeA = new Date(a.received_at || a.createdAt || a.created_at || a.date || a.mail_timestamp || 0).getTime() || (Number(a.id || a.mail_id) || 0);
            const timeB = new Date(b.received_at || b.createdAt || b.created_at || b.date || b.mail_timestamp || 0).getTime() || (Number(b.id || b.mail_id) || 0);
            return timeB - timeA;
        });

        // Ambil pesan paling baru
        const latestMsg = messages[0];
        const subject = latestMsg.subject || latestMsg.mail_subject || 'Notifikasi Akun Alight Motion';

        let fromName = 'Alight Creative';
        const rawFrom = typeof latestMsg.from === 'string' ? latestMsg.from : (latestMsg.from?.name || latestMsg.from?.address || latestMsg.mail_from || '');
        if (rawFrom.toLowerCase().includes('alight') || rawFrom.toLowerCase().includes('noreply') || rawFrom.toLowerCase().includes('firebaseapp')) {
            fromName = 'Alight Creative';
        } else if (rawFrom) {
            fromName = rawFrom;
        }

        const cleanFromName = String(fromName || 'Alight Creative').replace(/[*_`\[\]]/g, '').trim();
        const cleanSubject = String(subject || 'Notifikasi Akun Alight Motion').replace(/[*_`\[\]]/g, '').trim();

        // Ekstrak teks isi pesan
        let bodyText = '';
        if (typeof latestMsg === 'string') bodyText = latestMsg;
        else if (latestMsg.body_text) bodyText = latestMsg.body_text;
        else if (latestMsg.mail_body) bodyText = latestMsg.mail_body.replace(/<[^>]*>?/gm, ' ');
        else if (latestMsg.intro) bodyText = latestMsg.intro;
        else if (latestMsg.text) bodyText = latestMsg.text;
        else if (latestMsg.body_html) bodyText = latestMsg.body_html.replace(/<[^>]*>?/gm, ' ');
        else if (Array.isArray(latestMsg.html)) bodyText = latestMsg.html.join(' ').replace(/<[^>]*>?/gm, ' ');
        else if (typeof latestMsg.body === 'string') bodyText = latestMsg.body.replace(/<[^>]*>?/gm, ' ');
        else bodyText = JSON.stringify(latestMsg);

        let htmlContent = '';
        if (latestMsg.body_html) htmlContent = latestMsg.body_html;
        else if (latestMsg.mail_body) htmlContent = latestMsg.mail_body;
        else if (Array.isArray(latestMsg.html)) htmlContent = latestMsg.html.join(' ');
        else if (typeof latestMsg.html === 'string') htmlContent = latestMsg.html;
        else if (typeof latestMsg.body === 'string') htmlContent = latestMsg.body;

        const fullMsgContent = htmlContent + ' ' + bodyText;

        // 2. Ekstrak kode OTP 6 digit jika ada
        const otpMatch = fullMsgContent.match(/\b([0-9]{6})\b/);
        const otpCode = otpMatch ? otpMatch[1] : null;

        // 3. Ekstrak Link Aksi Resmi (Ubah Email / Re-autentikasi / Login) yang bebas error 404
        let actionLink = null;
        let isChangeEmail = false;

        const lowerFull = fullMsgContent.toLowerCase();
        const lowerSubject = subject.toLowerCase();
        if (lowerFull.includes('changeemail') || lowerFull.includes('actions%253dchangeemail') || lowerFull.includes('actions%3dchangeemail') || lowerSubject.includes('ubah') || lowerSubject.includes('change') || lowerFull.includes('autentikasi ulang') || lowerFull.includes('re-autentikasi')) {
            isChangeEmail = true;
            // Ambil link resmi dari href dalam HTML (Link Resmi Firebase yang terbukti langsung membuka aplikasi Alight Motion)
            const hrefMatch = htmlContent.match(/href=['"]([^'"]+)['"]/i);
            if (hrefMatch && hrefMatch[1] && hrefMatch[1].startsWith('http')) {
                actionLink = hrefMatch[1].replace(/&amp;/g, '&');
            } else {
                const oob = api.extractOobCode(fullMsgContent);
                if (oob) {
                    actionLink = api.buildAlightLoginLink(oob);
                }
            }
        }

        let contentSnippet = bodyText.trim().replace(/[*_`\[\]()]/g, '').replace(/\s+/g, ' ').substring(0, 160);
        if (contentSnippet.length >= 160) contentSnippet += '...';

        let resultText = `📬 *KOTAK MASUK EMAIL*\n` +
            `────────────\n` +
            `📧 Akun: \`${cleanEmail}\`\n\n` +
            `📩 *Pesan Terbaru Ditemukan:*\n` +
            `• Dari    : *${cleanFromName}*\n` +
            `• Subjek  : *${cleanSubject}*\n` +
            `• Waktu   : *Baru saja*\n\n`;

        const keyboardButtons = [];

        // Prioritas 1: Jika ADA permintaan Ubah Email
        if (isChangeEmail && actionLink) {
            resultText += `🔑 *PERMINTAAN GANTI EMAIL DITEMUKAN!*\n` +
                `Pesan konfirmasi resmi dari Alight Creative sudah masuk.\n\n` +
                `💡 *Cara Konfirmasi:*\n` +
                `Ketuk tombol di bawah untuk langsung menyetujui perubahan email di aplikasi Alight Motion:\n\n` +
                `⚠️ *Penting:* Link ini hanya berlaku 15 menit dan hanya bisa diklik *1 kali*. Segera buka sebelum kadaluarsa!\n\n`;
            keyboardButtons.push([Markup.button.url('🔗 Konfirmasi di Alight Motion', actionLink)]);
        } else if (otpCode) {
            // Prioritas 2: Kode OTP 6 Digit
            resultText += `🔢 *KODE OTP ANDA:*\n` +
                `👉  \`${otpCode}\`  👈 _(Ketuk angka untuk menyalin)_\n\n`;
        } else {
            // Prioritas 3: Link Login Resmi
            const normalOob = api.extractOobCode(fullMsgContent);
            if (normalOob) {
                const autoLink = api.buildAlightLoginLink(normalOob);
                resultText += `🔑 *LINK LOGIN DITEMUKAN!*\n` +
                    `Silakan klik tombol di bawah untuk langsung login ke aplikasi:\n\n` +
                    `💡 *Catatan:* Link login Alight Motion bersifat sekali pakai. Jika muncul peringatan kode tidak valid, ketuk tombol *📨 Minta Link Login Baru* di bawah.\n\n`;
                keyboardButtons.push([Markup.button.url('🔗 Masuk ke Alight Motion', autoLink)]);
                keyboardButtons.push([Markup.button.callback('📨 Minta Link Login Baru', `req_fresh_otp_${cleanEmail}`)]);
            } else {
                resultText += `💬 *Ringkasan Pesan:*\n` +
                    `_${contentSnippet}_\n\n`;
                keyboardButtons.push([Markup.button.callback('📨 Kirim Link Login Baru', `req_fresh_otp_${cleanEmail}`)]);
            }
        }

        keyboardButtons.push([Markup.button.callback('🔄 Segarkan (Refresh)', `refresh_otp_${cleanEmail}`)]);
        keyboardButtons.push([backBtn]);

        const keyboard = Markup.inlineKeyboard(keyboardButtons);

        if (targetMsgId) {
            return await ctx.telegram.editMessageText(ctx.chat.id, targetMsgId, null, resultText, { parse_mode: 'Markdown', ...keyboard }).catch(async () => {
                await ctx.reply(resultText, { parse_mode: 'Markdown', ...keyboard });
            });
        } else if (isEdit) {
            return await ctx.editMessageText(resultText, { parse_mode: 'Markdown', ...keyboard }).catch(() => { });
        } else {
            return await ctx.reply(resultText, { parse_mode: 'Markdown', ...keyboard });
        }
    } catch (err) {
        console.error('[Inbox OTP] Gagal cek inbox:', err.message);
        const errorText = `⚠️ *Gagal Membaca Kotak Masuk*\n────────────\nTerjadi kendala saat membaca inbox untuk \`${cleanEmail}\`. Silakan coba beberapa saat lagi.`;
        const errBackBtn = (ctx.from && isAdmin(ctx.from.id))
            ? Markup.button.callback('« Kembali ke Pemeliharaan', 'owner_cat_sistem')
            : Markup.button.callback('« Menu Utama', 'menu_main');
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Coba Lagi', `refresh_otp_${cleanEmail}`)],
            [errBackBtn]
        ]);
        if (targetMsgId) {
            return await ctx.telegram.editMessageText(ctx.chat.id, targetMsgId, null, errorText, { parse_mode: 'Markdown', ...keyboard }).catch(async () => {
                await ctx.reply(errorText, { parse_mode: 'Markdown', ...keyboard });
            });
        } else if (isEdit) {
            return await ctx.editMessageText(errorText, { parse_mode: 'Markdown', ...keyboard }).catch(() => { });
        } else {
            return await ctx.reply(errorText, { parse_mode: 'Markdown', ...keyboard });
        }
    }
}

// Handler Tombol Cek OTP dari Akun Baru Instan
bot.action(/^check_otp_(.+)$/, async (ctx) => {
    const email = ctx.match[1];
    await renderInboxView(ctx, email, false);
});

// Handler Tombol Refresh OTP
bot.action(/^refresh_otp_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('Menyegarkan kotak masuk...').catch(() => { });
    const email = ctx.match[1];
    await renderInboxView(ctx, email, true);
});

// Handler Tombol Minta Link Login Segar / Baru
bot.action(/^req_fresh_otp_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('Meminta link login baru... 📨').catch(() => { });
    const email = ctx.match[1];
    const waitMsg = await ctx.reply(`⏳ *Meminta link login baru dari Alight Creative untuk \`${email}\`...*`, { parse_mode: 'Markdown' });
    try {
        await api.sendLink(API_BASE_URL, email);
        await new Promise(r => setTimeout(r, 2200));
        await renderInboxView(ctx, email, false, waitMsg.message_id);
    } catch (err) {
        await ctx.telegram.editMessageText(
            ctx.chat.id,
            waitMsg.message_id,
            null,
            `❌ Gagal meminta link baru: ${err.message}`,
            { ...Markup.inlineKeyboard([[Markup.button.callback('« Kembali ke Menu Utama', 'menu_main')]]) }
        ).catch(() => { });
    }
});

// Handler Tombol Cek OTP dari Pesanan Masal
bot.action('bulk_check_otp', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    const session = getSession(ctx.from.id);
    session.state = 'AWAITING_BULK_OTP_EMAIL';

    const promptText = `📬 *CEK KOTAK MASUK / KODE OTP*\n` +
        `────────────\n` +
        `Menu ini digunakan untuk menerima pesan dari Alight Motion (seperti link ganti email atau kode masuk baru).\n\n` +
        `📌 *3 Langkah Mudah:*\n` +
        `1. Di aplikasi Alight Motion: Minta "Ubah Email" terlebih dahulu.\n` +
        `2. Salin alamat email akun Anda dari file .txt.\n` +
        `3. Kirimkan alamat email tersebut ke chat bot ini.\n\n` +
        `Silakan ketik / tempel email akun Anda sekarang:\n` +
        `(Contoh: \`creator1234@wikinime.com\`)`;

    await ctx.reply(promptText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('« Batal', 'menu_main')]])
    });
});

// -------------------------------------------------------------
// 3. ALUR UPGRADE EMAIL SENDIRI (PRIBADI)
// -------------------------------------------------------------
bot.action('menu_custom_email', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    const userId = ctx.from.id;
    const lang = getUserLang(userId, ctx.from);

    if (isMaintenance && !isAdmin(userId)) {
        const { text, keyboard } = getMaintenanceCard(lang);
        try {
            return await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
        } catch {
            return await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
        }
    }

    if (!isQueueOpen && !isAdmin(userId)) {
        return ctx.reply(
            i18n.t(lang, 'alerts.queue_closed'),
            { parse_mode: 'Markdown', ...getMainKeyboard(userId, ctx.from) }
        );
    }

    const subscribed = await isUserSubscribed(userId);
    if (!subscribed) {
        try {
            return await ctx.editMessageText(getJoinChannelText(lang), {
                parse_mode: 'Markdown',
                ...getJoinChannelKeyboard(lang)
            });
        } catch {
            return await ctx.reply(getJoinChannelText(lang), {
                parse_mode: 'Markdown',
                ...getJoinChannelKeyboard(lang)
            });
        }
    }

    const isUserActive = typeof activeBulkJobs !== 'undefined'
        ? Array.from(activeBulkJobs.values()).some(q => q && q.userId === userId)
        : (activeBulkJob && activeBulkJob.userId === userId);
    if (userBulkLock.has(userId) || isUserActive || bulkQueue.some(q => q.userId === userId)) {
        return ctx.answerCbQuery('⚠️ Pesanan sedang diproses, mohon tunggu...', { show_alert: true }).catch(() => {});
    }

    const session = getSession(userId);
    session.state = 'AWAITING_CUSTOM_EMAIL';
    session.data = {};

    const text = i18n.t(lang, 'custom_email.title');

    const keyboard = Markup.inlineKeyboard([
        [styledBtn(i18n.t(lang, 'menu.btn_back'), 'menu_main', 'primary')]
    ]);

    try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    } catch {
        await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
    }
});

// -------------------------------------------------------------
// Text Handler (Menangani input email custom, link, dan angka masal)
// -------------------------------------------------------------
bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    const userId = ctx.from.id;
    const lang = getUserLang(userId, ctx.from);
    const session = getSession(userId);

    if (text.toLowerCase() === 'batal' || text.toLowerCase() === 'cancel' || text === '/cancel') {
        clearSession(userId);
        return ctx.reply(i18n.t(lang, 'alerts.canceled'), getMainKeyboard(userId, ctx.from));
    }

    if (isMaintenance && !isAdmin(userId)) {
        if (session.state === 'AWAITING_CUSTOM_COUNT' || session.state === 'AWAITING_CUSTOM_EMAIL' || session.state === 'AWAITING_BULK_OTP_EMAIL') {
            clearSession(userId);
            const { text: mtText, keyboard: mtKb } = getMaintenanceCard(lang);
            return ctx.reply(mtText, { parse_mode: 'Markdown', ...mtKb });
        }
    }

    // A. Input Nomor Pesanan Baru oleh Owner
    if (session.state === 'OWNER_SET_COUNTER') {
        if (!isOwner(userId)) {
            clearSession(userId);
            return ctx.reply('⛔ Access denied.');
        }
        const cleanedDigits = text.replace(/\D/g, '');
        const newNum = parseInt(cleanedDigits, 10);
        if (!cleanedDigits || isNaN(newNum) || newNum < 1) {
            return ctx.reply(
                '⚠️ Please enter a valid order number (example: `514500` or `AM-ACT-514500`):',
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([[Markup.button.callback('« Cancel', 'owner_cat_transaksi')]])
                }
            );
        }
        orderCounter.setCounter(newNum);
        clearSession(userId);
        return ctx.reply(
            `✅ *ORDER NUMBER CHANGED SUCCESSFULLY!*\n────────────\n` +
            `• Current order number : \`AM-ACT-${newNum}\`\n` +
            `• Next order number    : \`AM-ACT-${newNum + 1}\`\n────────────`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('« Back to Transactions', 'owner_cat_transaksi')],
                    [Markup.button.callback('👑 Owner Panel', 'owner_dashboard')]
                ])
            }
        );
    }

    // B. Input Pesan Siaran (Broadcast) oleh Owner / Admin
    if (session.state === 'OWNER_BROADCAST') {
        if (!isAdmin(userId)) {
            clearSession(userId);
            return ctx.reply('⛔ Access denied.');
        }
        clearSession(userId);
        return sendBroadcastMessage(ctx, text, false);
    }

    // C. Input Email Pembeli untuk Cek OTP oleh Owner / Admin
    if (session.state === 'OWNER_CHECK_OTP') {
        if (!isAdmin(userId)) {
            clearSession(userId);
            return ctx.reply('⛔ Access denied.');
        }
        const emailInput = text.toLowerCase().trim();
        if (!emailInput.includes('@') || !emailInput.includes('.')) {
            return ctx.reply(
                '⚠️ Invalid email format. Enter a valid email address (example: `user@wikinime.com`):',
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([[Markup.button.callback('« Cancel', 'owner_cat_sistem')]])
                }
            );
        }
        clearSession(userId);
        const waitMsg = await ctx.reply(`⏳ *Checking inbox for \`${emailInput}\`...*`, { parse_mode: 'Markdown' });
        return await renderInboxView(ctx, emailInput, false, waitMsg?.message_id);
    }

    // D. Input Channel Baru oleh Owner
    if (session.state === 'OWNER_SET_CHANNEL') {
        if (!isOwner(userId)) {
            clearSession(userId);
            return ctx.reply('⛔ Access denied.');
        }
        let ch = text.trim();
        if (!ch.startsWith('@') && !ch.startsWith('-100')) {
            ch = '@' + ch;
        }
        CHANNEL_ID = ch;

        // Simpan permanen ke file .env jika ada
        try {
            const envPath = path.join(__dirname, '..', '.env');
            if (fs.existsSync(envPath)) {
                let envContent = fs.readFileSync(envPath, 'utf-8');
                if (envContent.includes('CHANNEL_ID=')) {
                    envContent = envContent.replace(/CHANNEL_ID=.*/g, `CHANNEL_ID=${ch}`);
                } else {
                    envContent += `\nCHANNEL_ID=${ch}`;
                }
                fs.writeFileSync(envPath, envContent, 'utf-8');
            }
        } catch { }

        clearSession(userId);
        return ctx.reply(
            `✅ *CHANNEL CHANGED SUCCESSFULLY!*\n────────────\nCurrent channel: *${CHANNEL_ID}*`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([[Markup.button.callback('« Back to Settings', 'owner_channel_settings')]])
            }
        );
    }

    // 1. Input Jumlah Akun Masal Custom
    if (session.state === 'AWAITING_CUSTOM_COUNT') {
        const count = parseInt(text, 10);
        if (isNaN(count) || count < 1) {
            return ctx.reply(
                i18n.t(lang, 'bulk.custom_invalid'),
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([[Markup.button.callback(i18n.t(lang, 'menu.btn_cancel'), 'menu_bulk')]])
                }
            );
        }

        if (count > 1000) {
            return ctx.reply(
                i18n.t(lang, 'bulk.custom_exceed'),
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([[Markup.button.callback(i18n.t(lang, 'menu.btn_cancel'), 'menu_bulk')]])
                }
            );
        }

        clearSession(userId);
        executeBulk(ctx, count).catch((err) => {
            console.error('Error executing custom bulk:', err.message);
        });
        return;
    }

    // 2. Input Email Akun Masal untuk Cek Kotak Masuk / OTP
    if (session.state === 'AWAITING_BULK_OTP_EMAIL') {
        const emailInput = text.toLowerCase().trim();
        if (!emailInput.includes('@') || !emailInput.includes('.')) {
            return ctx.reply(
                '⚠️ Format email tidak valid. Pastikan menyertakan `@` dan domain (contoh: `alight_1234@wikinime.com`):',
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([[Markup.button.callback(i18n.t(lang, 'menu.btn_cancel'), 'menu_main')]])
                }
            );
        }

        clearSession(userId);
        const waitMsg = await ctx.reply(`⏳ *Memeriksa kotak masuk untuk \`${emailInput}\`...*`, { parse_mode: 'Markdown' });
        return await renderInboxView(ctx, emailInput, false, waitMsg?.message_id);
    }

    // 3. Input Email Pribadi untuk Di-upgrade
    if (session.state === 'AWAITING_CUSTOM_EMAIL') {
        const email = text.toLowerCase().trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return ctx.reply(
                i18n.t(lang, 'custom_email.invalid_email'),
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([[Markup.button.callback(i18n.t(lang, 'menu.btn_cancel'), 'menu_main')]])
                }
            );
        }

        const waitMsg = await ctx.reply(i18n.t(lang, 'custom_email.sending_link', email), { parse_mode: 'Markdown' });

        try {
            logInfo('UPGRADE', `✉️ User ${userId} [${lang.toUpperCase()}] | Mengirim link aktivasi ke: ${email}`);
            const sendRes = await api.sendLink(API_BASE_URL, email);
            if (!sendRes.success) throw new Error(sendRes.message || 'Gagal mengirim link ke email');

            session.state = 'AWAITING_CUSTOM_LINK';
            session.data = { email };

            const instructionText = `${i18n.t(lang, 'custom_email.sent_title')}\n` +
                `────────────\n` +
                `${i18n.t(lang, 'custom_email.sent_desc', email)}`;

            await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, null, instructionText, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([[Markup.button.callback(i18n.t(lang, 'menu.btn_cancel'), 'menu_main')]])
            });
        } catch (err) {
            handleAutoMaintenanceTrigger(err.message, 'UPGRADE EMAIL');
            const cleanErr = safeFormatError(err.message, lang);
            const errTitle = i18n.t(lang, 'custom_email.error_title');
            const errDesc = i18n.t(lang, 'custom_email.error_desc');
            const errorText = `${errTitle}\n────────────\n${cleanErr}\n\n${errDesc}`;
            const errorKb = Markup.inlineKeyboard([[Markup.button.callback(i18n.t(lang, 'menu.btn_main_menu'), 'menu_main')]]);
            const plainText = errorText.replace(/[*_`]/g, '');

            await ctx.telegram.editMessageText(
                ctx.chat.id,
                waitMsg.message_id,
                null,
                errorText,
                {
                    parse_mode: 'Markdown',
                    ...errorKb
                }
            ).catch(async () => {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    waitMsg.message_id,
                    null,
                    plainText,
                    { ...errorKb }
                ).catch(() => {});
            });
            clearSession(userId);
        }
        return;
    }

    // 3. Input Link yang Dicopy dari Email untuk Verifikasi Lisensi
    if (session.state === 'AWAITING_CUSTOM_LINK') {
        const link = text.trim();
        const email = session.data.email;
        const oob = api.extractOobCode(link);

        if (!oob) {
            return ctx.reply(
                i18n.t(lang, 'custom_email.invalid_link'),
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([[Markup.button.callback(i18n.t(lang, 'menu.btn_cancel'), 'menu_main')]])
                }
            );
        }

        const waitMsg = await ctx.reply(i18n.t(lang, 'custom_email.verifying', email), { parse_mode: 'Markdown' });

        try {
            // Verifikasi dan aktivasi lisensi 1 Tahun (Cukup 1x Eksekusi Langsung)
            const verifyRes = await api.verifyLink(API_BASE_URL, email, `oobCode=${oob}`);
            if (!verifyRes || !verifyRes.success || !verifyRes.data) {
                throw new Error(verifyRes?.message || 'Gagal memverifikasi lisensi');
            }

            const customOrderId = verifyRes.data?.orderId || orderCounter.getNextOrderId();
            const { date: customDate, time: customTime } = getDateTimeWIB(lang, true);

            clearSession(userId);

            const isGmail = email.endsWith('@gmail.com');
            const loginInstructions = isGmail
                ? i18n.t(lang, 'custom_email.login_gmail')
                : i18n.t(lang, 'custom_email.login_other');

            const successText = `${i18n.t(lang, 'custom_email.success_title')}\n` +
                `────────────\n` +
                `${i18n.t(lang, 'custom_email.section_data')}\n\n` +
                `› ${i18n.t(lang, 'single.label_email')}  : \`${email}\`\n` +
                `› ${i18n.t(lang, 'single.label_duration')} : ${i18n.t(lang, 'single.val_duration')}\n` +
                `› ${i18n.t(lang, 'single.label_status')} : ${i18n.t(lang, 'single.val_status')}\n\n` +
                loginInstructions;

            const keyboardButtons = [
                [
                    Markup.button.callback(i18n.t(lang, 'custom_email.btn_upgrade_again'), 'menu_custom_email'),
                    Markup.button.callback(i18n.t(lang, 'menu.btn_main_menu'), 'menu_main')
                ]
            ];

            await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, null, successText, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(keyboardButtons)
            });

            // Kirim notifikasi upgrade email ke Channel Telegram (Live)
            logInfo('UPGRADE', `✅ SUKSES | ${email} Aktif 1 Tahun`);
            sendChannelNotification('CUSTOM_EMAIL', { email, user: ctx.from });
        } catch (err) {
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                waitMsg.message_id,
                null,
                `${i18n.t(lang, 'custom_email.error_title')}\n────────────\n${err.message}\n\n${i18n.t(lang, 'custom_email.error_desc')}`,
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback(i18n.t(lang, 'menu.btn_try_again'), 'menu_custom_email')],
                        [Markup.button.callback(i18n.t(lang, 'menu.btn_main_menu'), 'menu_main')]
                    ])
                }
            );
            clearSession(userId);
        }
        return;
    }

    // 4. Deteksi Otomatis Real-time jika Pengguna Menempelkan Link Alight Motion Kapan Saja
    const detectedOob = api.extractOobCode(text);
    if (detectedOob) {
        const autoLoginLink = api.buildAlightLoginLink(detectedOob);
        return ctx.reply(
            `⚡ *LINK LOGIN INSTAN TERDETEKSI!*\n` +
            `────────────\n` +
            `Tautan Alight Motion Anda telah otomatis dikonversi ke format resmi Firebase agar bebas dari error 404.\n\n` +
            `Silakan klik tombol di bawah untuk langsung login ke aplikasi:`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.url('🔗 Klik untuk Langsung Login', autoLoginLink)],
                    [Markup.button.callback('« Menu Utama', 'menu_main')]
                ])
            }
        );
    }

    // Default respon jika chat sembarangan
    await ctx.reply(
        `Ketik /start untuk membuka kontrol layanan aktivasi lisensi.`,
        { parse_mode: 'Markdown', ...getMainKeyboard(userId) }
    );
});

// Tangani error global Telegraf agar bot tetap stabil
bot.catch((err, ctx) => {
    const msg = err?.message || '';
    // Saring error non-fatal Telegram (tombol usang / pesan tidak berubah) agar terminal bersih
    if (msg.includes('query is too old') || msg.includes('message is not modified') || msg.includes('query ID is invalid')) {
        return;
    }
    console.error(`⚠️ Error Bot Telegram [${ctx?.updateType || 'unknown'}]:`, msg);
});

// Jalankan Bot Telegram
bot.telegram.getMe().then((botInfo) => {
    console.log('===========================================================');
    console.log(`🤖 ALIGHT MOTION PREMIUM BOT - LIVE MONITOR`);
    console.log(`Koneksi: @${botInfo.username} (Online) | Waktu: WIB (Asia/Jakarta)`);
    console.log('Siap menerima perintah dan memproses akun...');
    console.log('===========================================================');

    // Pulihkan antrean dan pesanan masal tertunda dari disk secara otomatis
    loadBulkQueue();
    resumeActiveBulkJobIfAny().catch((err) => {
        console.error('[BulkRecovery] Gagal memulihkan antrean:', err.message);
    });
}).catch((err) => {
    console.error('Gagal mengambil info bot:', err.message);
});

bot.launch().catch((err) => {
    console.error('Gagal menghubungkan bot:', err.message);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
