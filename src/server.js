const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const orderCounter = require('./orderCounter');

const app = express();
const PORT = process.env.PORT || process.env.SERVER_PORT || 3000;

app.use(express.json());

// Header user-agent standar
const client = axios.create({
    timeout: 25000,
    headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'AM-AutoRegist-Server/1.0'
    }
});

// Cache inbox lokal sementara
const inboxCache = new Map();

// Direktori data & cache token persisten di disk (tahan restart server)
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}
const TOKEN_CACHE_FILE = path.join(DATA_DIR, 'mailbox_tokens.json');

function saveMailboxToken(email, token, provider) {
    if (!email || !token) return;
    try {
        let store = {};
        if (fs.existsSync(TOKEN_CACHE_FILE)) {
            try { store = JSON.parse(fs.readFileSync(TOKEN_CACHE_FILE, 'utf-8')); } catch {}
        }
        store[email.toLowerCase().trim()] = { token, provider, updatedAt: new Date().toISOString() };
        fs.writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(store, null, 2), 'utf-8');
    } catch (err) {}
}

function getMailboxToken(email) {
    if (!email) return null;
    const clean = email.toLowerCase().trim();
    if (tempMailTokens.has(clean)) return tempMailTokens.get(clean);
    if (guerrillaTokens.has(clean)) return guerrillaTokens.get(clean);
    try {
        if (fs.existsSync(TOKEN_CACHE_FILE)) {
            const store = JSON.parse(fs.readFileSync(TOKEN_CACHE_FILE, 'utf-8'));
            if (store[clean] && store[clean].token) {
                return store[clean].token;
            }
        }
    } catch (err) {}
    return null;
}

// Cache token untuk penyedia email sementara (Multi-Tier)
const mailTmTokens = new Map();
const tempMailTokens = new Map();
const guerrillaTokens = new Map();
const FIXED_PASS = 'AmAutoPass123!@#';

const PREFIX_STYLES = ['creator', 'studio', 'motion', 'pro', 'alight', 'design', 'vip', 'editor', 'prime'];
let domainRotationPointer = Math.floor(Math.random() * 50);
let prefixRotationPointer = 0;

function getRotatedDomain() {
    if (EMAILQU_ROOT_DOMAINS.length === 0) return 'wikinime.com';
    const dom = EMAILQU_ROOT_DOMAINS[domainRotationPointer % EMAILQU_ROOT_DOMAINS.length];
    domainRotationPointer = (domainRotationPointer + 1) % EMAILQU_ROOT_DOMAINS.length;
    return dom;
}

function getRotatedPrefix() {
    const pref = PREFIX_STYLES[prefixRotationPointer % PREFIX_STYLES.length];
    prefixRotationPointer = (prefixRotationPointer + 1) % PREFIX_STYLES.length;
    return pref;
}

// Daftar kata kunci terlarang (Judol, Slot, Bet, Gacor, dll) untuk filter domain
const GAMBLING_BLACKLIST = ['slot', 'bet', 'judi', 'judol', 'gacor', 'togel', 'casino', 'poker', 'sbobet', 'maxwin', 'zeus', 'depo', 'hoki', 'jackpot', 'spin', 'pragmatic', 'olympus', 'sensasional', 'cuan', 'rupiah', 'bola88', 'parlay'];

// Pre-loaded verified root domains resmi & aktif dari emailqu.com (100% teruji & bebas judol)
let EMAILQU_ROOT_DOMAINS = [
    'dingamouu.com', 'broken.best', 'flobati.space', 'apimza.store', 'exspro.site',
    'extraku.net', 'ilysmdesi.com', 'maghbiz.store', 'kacung.me', 'scento.cyou',
    'sakuw.store', 'runatk.site', 'kurmandika.com', 'cempreng.me', 'capemain.games',
    'daisychuu.com', 'telor.studio', 'ccsaku.shop', 'capcute.fun', 'kayyprem.shop',
    'trueword.space', 'wikinime.com', 'gamepass.games', 'akunku.site', 'tolong.engineer'
];

// Muat langsung domain terverifikasi aktif dari disk jika tersedia
const VERIFIED_156_FILE = path.join(DATA_DIR, 'verified_156_domains.json');
const VERIFIED_156_ROOT = path.join(__dirname, '..', 'verified_156_domains.json');
const fileToLoad = fs.existsSync(VERIFIED_156_FILE) ? VERIFIED_156_FILE : (fs.existsSync(VERIFIED_156_ROOT) ? VERIFIED_156_ROOT : null);
if (fileToLoad) {
    try {
        const loaded = JSON.parse(fs.readFileSync(fileToLoad, 'utf-8'));
        if (Array.isArray(loaded) && loaded.length > 0) {
            EMAILQU_ROOT_DOMAINS = loaded;
        }
    } catch {}
}

// Sinkronisasi otomatis daftar domain bersih dari emailqu secara berkala dengan filter anti-judol
async function refreshEmailquDomains() {
    try {
        const res = await client.get('https://emailqu.com/api/domains/random', { timeout: 5000 });
        const list = res.data?.domains;
        if (Array.isArray(list) && list.length > 0) {
            const clean = list
                .filter(d => !d.is_subdomain && !d.is_hidden && d.domain)
                .map(d => String(d.domain).replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase())
                .filter(d => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d))
                .filter(d => !GAMBLING_BLACKLIST.some(bad => d.includes(bad)));
            if (clean.length > 10) {
                EMAILQU_ROOT_DOMAINS = Array.from(new Set([...EMAILQU_ROOT_DOMAINS, ...clean]));
            }
        }
    } catch (err) {}
}
refreshEmailquDomains();
setInterval(refreshEmailquDomains, 30 * 60 * 1000);

// -------------------------------------------------------------
// 1. Endpoint: GET /api/get-email (Rotasi Dinamis Multi-Domain & Multi-Provider)
// -------------------------------------------------------------
let emailProviderCycle = 0;
let guerrillaDomainPointer = 0;
const GUERRILLA_ACTIVE_DOMAINS = [
    'sharklasers.com',
    'pokemail.net',
    'guerrillamail.com',
    'grr.la',
    'guerrillamailblock.com',
    'spam4.me'
];

app.get('/api/get-email', async (req, res) => {
    try {
        const prefix = getRotatedPrefix();
        const domain = getRotatedDomain();
        const randNum = Math.floor(1000 + Math.random() * 9000);
        const email = `${prefix}_${randNum}@${domain}`;
        return res.json({ success: true, email, provider: 'emailqu' });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Gagal membuat email' });
    }
});

const ALIGHT_FIREBASE_API_KEY = process.env.ALIGHT_FIREBASE_API_KEY || 'AIzaSyDrZ9jr_Y16ltSBqsQR5IH6I04FRga6Ki0';

// -------------------------------------------------------------
// 2. Endpoint: POST /api/send-link (100% Mandiri Langsung ke Google Firebase)
// -------------------------------------------------------------
app.post('/api/send-link', async (req, res) => {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
        return res.status(400).json({ success: false, message: 'Format email tidak valid' });
    }

    const cleanEmail = email.trim();

    try {
        // Tembak langsung ke Google Firebase Auth resmi Alight Motion (tanpa retry & tanpa fallback)
        const fbRes = await client.post(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${ALIGHT_FIREBASE_API_KEY}`, {
            requestType: 'EMAIL_SIGNIN',
            email: cleanEmail,
            continueUrl: 'https://alightcreative.com?ui_sid=0366624874&ui_sd=0',
            canHandleCodeInApp: true,
            android: {
                packageName: 'com.alightcreative.motion',
                installApp: true,
                minimumVersion: '1'
            },
            iOS: {
                bundleId: 'com.alightcreative.motion'
            }
        }, {
            headers: {
                'Referer': 'https://alight-creative.firebaseapp.com',
                'Origin': 'https://alight-creative.firebaseapp.com'
            },
            timeout: 5000
        });

        if (fbRes.data && fbRes.data.email) {
            return res.json({ success: true, message: 'Link berhasil dikirim langsung via Google Firebase' });
        }
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.response?.data?.error?.message || err.message || 'Gagal mengirim magic link'
        });
    }
});

// -------------------------------------------------------------
// 3. Endpoint: GET /api/check-inbox (Pengecekan Langsung Cepat - Tanpa Auto Fallback)
// -------------------------------------------------------------
app.get('/api/check-inbox', async (req, res) => {
    const email = req.query.email;
    const qToken = req.query.token;
    if (!email) {
        return res.status(400).json({ success: false, message: 'Parameter email diperlukan' });
    }

    try {
        const cleanEmail = String(email).replace('%40', '@').trim().toLowerCase();
        const domain = cleanEmail.split('@')[1] || '';

        // 1. Pengecekan Akun Guerrilla Mail (HANYA jika domain guerrilla)
        const isGuerrilla = domain.includes('guerrillamail') || domain.includes('sharklasers') || domain.includes('grr.la') || domain.includes('pokemail') || domain.includes('spam4.me');
        if (isGuerrilla) {
            let sid = qToken || getMailboxToken(cleanEmail);
            if (!sid) {
                const [user] = cleanEmail.split('@');
                const init = await client.get('https://api.guerrillamail.com/ajax.php?f=get_email_address', { timeout: 3000 });
                if (init.data && init.data.sid_token) {
                    sid = init.data.sid_token;
                    guerrillaTokens.set(cleanEmail, sid);
                    saveMailboxToken(cleanEmail, sid, 'guerrillamail');
                    await client.get(`https://api.guerrillamail.com/ajax.php?f=set_email_user&email_user=${encodeURIComponent(user)}&lang=en&sid_token=${sid}`, { timeout: 2500 }).catch(() => {});
                }
            }

            if (sid) {
                const gRes = await client.get(`https://api.guerrillamail.com/ajax.php?f=get_email_list&offset=0&sid_token=${sid}`, { timeout: 3000 });
                const list = gRes.data?.list;
                if (Array.isArray(list) && list.length > 0) {
                    const messages = await Promise.all(
                        list.slice(0, 5).map(m =>
                            client.get(`https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${m.mail_id}&sid_token=${sid}`, { timeout: 2500 })
                                .then(r => {
                                    const d = r.data;
                                    if (!d) return null;
                                    return {
                                        id: d.mail_id || m.mail_id,
                                        from: d.mail_from || m.mail_from || 'Alight Creative',
                                        subject: d.mail_subject || m.mail_subject || 'Notifikasi',
                                        body: d.mail_body || d.mail_excerpt || '',
                                        body_html: d.mail_body || '',
                                        date: d.mail_date || m.mail_date || new Date().toISOString()
                                    };
                                })
                                .catch(() => null)
                        )
                    );
                    const valid = messages.filter(Boolean);
                    if (valid.length > 0) {
                        return res.json({ success: true, data: valid });
                    }
                }
            }
            return res.json({ success: false, data: [] });
        }

        // 2. Pengecekan Akun tempmail.lol (HANYA jika domain tempmail)
        const isTempMail = domain.includes('tempmail.lol') || domain.includes('26ai.art') || domain.includes('prominentghost.com') || domain.includes('imagesthere.com');
        if (isTempMail) {
            const tmToken = qToken || getMailboxToken(cleanEmail);
            if (tmToken) {
                const tmRes = await client.get(`https://api.tempmail.lol/auth/${tmToken}`, { timeout: 3000 });
                const list = tmRes.data?.email;
                if (Array.isArray(list) && list.length > 0) {
                    const normalized = list.map(m => ({
                        id: m._id || m.id,
                        from: m.from || 'Alight Creative',
                        subject: m.subject || 'Notifikasi',
                        body: m.body || m.html || m.text || '',
                        body_html: m.html || m.body || '',
                        date: m.date || new Date().toISOString()
                    }));
                    return res.json({ success: true, data: normalized });
                }
            }
            return res.json({ success: false, data: [] });
        }

        // 3. Pengecekan Langsung Cepat via emailqu.com (156 Root Domains - Cepat ~150ms & Tanpa Fallback)
        const eqRes = await client.get(`https://emailqu.com/api/public/emails/${encodeURIComponent(cleanEmail)}`, { timeout: 3000 });
        const eqList = eqRes.data?.emails;
        if (Array.isArray(eqList) && eqList.length > 0) {
            return res.json({
                success: true,
                data: eqList
            });
        }

        return res.json({ success: false, data: [] });
    } catch (err) {
        return res.json({ success: false, data: [] });
    }
});

// -------------------------------------------------------------
// 4. Endpoint: POST /api/verify-link (100% Mandiri Langsung ke Alight Creative & Google Firebase)
// -------------------------------------------------------------
app.post('/api/verify-link', async (req, res) => {
    const { email, magicLink } = req.body;
    if (!email || !magicLink) {
        return res.status(400).json({ success: false, message: 'Email dan link diperlukan' });
    }

    const cleanEmail = email.trim();
    let oob = magicLink;
    const match = magicLink.match(/oobCode(?:=|%3D|%253D)([-_a-zA-Z0-9]+)/i);
    if (match) oob = match[1];

    const dip = () => `${crypto.randomInt(1, 255)}.${crypto.randomInt(0, 255)}.${crypto.randomInt(0, 255)}.${crypto.randomInt(1, 255)}`;
    const sp = h => ({
        ...h,
        'x-forwarded-for': dip(),
        'x-real-ip': dip(),
        'client-ip': dip(),
        'x-client-ip': dip(),
        'x-originating-ip': dip(),
        'x-cluster-client-ip': dip()
    });

    const androidHeaders = {
        'content-type': 'application/json',
        'x-android-package': 'com.alightcreative.motion',
        'x-android-cert': 'ECA6BF91B8715A6F810ED0BBFC65B6CD578F52A8',
        'user-agent': 'dalvik/2.1.0 (linux; u; android 15; 23127pn0cc build/bp1a.250505.005)'
    };

    const okhttpHeaders = {
        'content-type': 'application/json; charset=utf-8',
        'user-agent': 'okhttp/3.12.1',
        'accept-encoding': 'gzip'
    };

    try {
        // 1. Otentikasi langsung sebagai Android Client ke Firebase Auth
        const fbRes = await axios.post('https://www.googleapis.com/identitytoolkit/v3/relyingparty/emailLinkSignin?key=AIzaSyDtG1AU22ErnQD60AzBAcaknySiz9_CEq0', {
            email: cleanEmail,
            oobCode: oob,
            clientType: 'CLIENT_TYPE_ANDROID'
        }, {
            headers: sp(androidHeaders),
            timeout: 15000
        });

        if (!fbRes.data || !fbRes.data.idToken) {
            return res.status(400).json({ success: false, message: 'Gagal verifikasi kode autentikasi' });
        }

        const idToken = fbRes.data.idToken;
        const uid = fbRes.data.localId;

        // 2. Eksekusi aktivasi lisensi 1 Tahun Alight Motion Langsung ke Server Resmi Alight Creative (Cukup 1x Langsung Sukses)
        let subData = null;
        try {
            const subRes = await axios.post('https://us-central1-alight-creative.cloudfunctions.net/verifyPurchase', {
                data: {
                    productId: 'am.full.sub.annual.19q4',
                    token: 'mmgaobamlahbbeccfplmbkbb.AO-J1OzqG0or_GJJIx-ms8GrTm-jaglCRfhQSRPUZKpl2YspYS-oN7_94uv8RC5vQbvd_Ios2pPDStZ2n7F0hLE3FiOU7HS3R6Fquulv5xLXFECSv4ctElw',
                    skuType: 'subs',
                    orderId: 'neo-' + crypto.randomBytes(6).toString('hex')
                }
            }, {
                headers: sp({
                    ...okhttpHeaders,
                    'authorization': `Bearer ${idToken}`,
                    'firebase-instance-id-token': 'cSDnCyp3T-uwp07z3tL86T:APA91bFkmvvsHw5nnqa1SBFci-99DRsKClLiETdRrVcJjS5yBx1v_FbCb1d8WhBuea_zmwnYBktyTIzcRhN4b6uNOUur9wPc0gKXmJDoZic0LhNq5V2s0xI'
                }),
                timeout: 25000
            });

            subData = subRes.data?.result || subRes.data;
            if (subData && (subData.valid === true || subData.status === 'success')) {
                console.log(`[SUBSCRIPTION] Aktivasi sukses untuk ${cleanEmail}:`, subData.status || 'OK');
            }
        } catch (subErr) {
            console.error(`[SUBSCRIPTION] Gagal untuk ${cleanEmail}:`, subErr.response?.data || subErr.message);
        }

        return res.json({
            success: true,
            data: {
                email: fbRes.data.email || cleanEmail,
                uid: uid,
                idToken: idToken,
                refreshToken: fbRes.data.refreshToken,
                isNewUser: fbRes.data.isNewUser,
                subscription: subData
            }
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.response?.data?.error?.message || err.message || 'Gagal aktivasi akun'
        });
    }
});

// Jalankan Server Mandiri
app.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 AM AUTO REGIST API Server aktif di port ${PORT}`);
});

module.exports = app;
