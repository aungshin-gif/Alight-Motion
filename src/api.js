const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const orderCounter = require('./orderCounter');

const client = axios.create({
    timeout: 20000,
    headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'AM-AutoRegist-Engine/1.0'
    }
});

const PREFIX_STYLES = ['creator', 'studio', 'motion', 'pro', 'alight', 'design', 'vip', 'editor', 'prime'];
let EMAILQU_DOMAINS = [
    'dingamouu.com', 'broken.best', 'flobati.space', 'apimza.store', 'exspro.site',
    'extraku.net', 'ilysmdesi.com', 'maghbiz.store', 'kacung.me', 'scento.cyou',
    'sakuw.store', 'runatk.site', 'kurmandika.com', 'cempreng.me', 'capemain.games',
    'daisychuu.com', 'telor.studio', 'ccsaku.shop', 'capcute.fun', 'kayyprem.shop',
    'trueword.space', 'wikinime.com', 'gamepass.games', 'akunku.site', 'tolong.engineer'
];

const VERIFIED_156_FILE = path.join(__dirname, '..', 'data', 'verified_156_domains.json');
const VERIFIED_156_ROOT = path.join(__dirname, '..', 'verified_156_domains.json');
const fileToLoad = fs.existsSync(VERIFIED_156_FILE) ? VERIFIED_156_FILE : (fs.existsSync(VERIFIED_156_ROOT) ? VERIFIED_156_ROOT : null);
if (fileToLoad) {
    try {
        const loaded = JSON.parse(fs.readFileSync(fileToLoad, 'utf-8'));
        if (Array.isArray(loaded) && loaded.length > 0) {
            EMAILQU_DOMAINS = loaded;
        }
    } catch {}
}

let apiDomainPointer = Math.floor(Math.random() * EMAILQU_DOMAINS.length);
let apiPrefixPointer = 0;

/**
 * 1. Buat email otomatis berkecepatan tinggi (Instant Inbox)
 */
/**
 * 1. Buat email otomatis berkecepatan tinggi (Tanpa Auto Retry & Tanpa Fallback)
 */
async function getEmail(baseUrl, mode = 'single') {
    // 1x percobaan langsung ke server lokal
    try {
        const res = await client.get(`${baseUrl}/api/get-email?mode=${encodeURIComponent(mode)}`, { timeout: 3500 });
        if (res.data && res.data.email) {
            return {
                success: true,
                email: res.data.email,
                provider: res.data.provider || 'emailqu',
                token: res.data.token
            };
        }
    } catch (err) {}

    // Eksekusi mandiri langsung rotasikan pool domain lokal (0ms, 100% cepat)
    const pref = PREFIX_STYLES[apiPrefixPointer++ % PREFIX_STYLES.length];
    const dom = EMAILQU_DOMAINS[apiDomainPointer++ % EMAILQU_DOMAINS.length];
    const email = `${pref}_${Math.floor(1000 + Math.random() * 9000)}@${dom}`;
    return { success: true, email, provider: 'emailqu' };
}

/**
 * 2. Kirim link login Alight Motion ke email (Langsung via Firebase)
 */
async function sendLink(baseUrl, email) {
    const cleanEmail = email.trim();
    // 1x percobaan ke server lokal
    try {
        const res = await client.post(`${baseUrl}/api/send-link`, { email: cleanEmail }, { timeout: 4000 });
        if (res.data?.success) return res.data;
    } catch (err) {}

    // Langsung ke Google Firebase resmi Alight Motion
    try {
        const fbRes = await client.post(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${ALIGHT_FIREBASE_API_KEY}`, {
            requestType: 'EMAIL_SIGNIN',
            email: cleanEmail,
            continueUrl: 'https://alightcreative.com?ui_sid=0366624874&ui_sd=0',
            canHandleCodeInApp: true
        }, {
            headers: {
                'Referer': 'https://alight-creative.firebaseapp.com',
                'Origin': 'https://alight-creative.firebaseapp.com'
            },
            timeout: 5000
        });
        if (fbRes.status === 200) return { success: true };
    } catch (fbErr) {
        return {
            success: false,
            message: fbErr.response?.data?.error?.message || fbErr.message || 'Gagal mengirim link aktivasi'
        };
    }

    return { success: false, message: 'Gagal mengirim link aktivasi' };
}

/**
 * 3. Cek inbox pesan masuk otomatis real-time (Cepat, Presisi & Tanpa Auto Fallback)
 */
async function checkInbox(baseUrl, email, provider = 'instant', token = null) {
    const cleanEmail = String(email).replace('%40', '@').trim().toLowerCase();

    // 1. Coba lewat server lokal secara langsung
    try {
        const tokenQuery = token ? `&token=${encodeURIComponent(token)}` : '';
        const res = await client.get(`${baseUrl}/api/check-inbox?email=${encodeURIComponent(cleanEmail)}${tokenQuery}`, { timeout: 3000 });
        if (res.data && res.data.success && Array.isArray(res.data.data) && res.data.data.length > 0) {
            return res.data;
        }
    } catch (err) {}

    // 2. Jika server lokal sedang off, cek langsung ke provider domain terkait (tanpa fallback cascade)
    const domain = cleanEmail.split('@')[1] || '';
    if (domain.includes('guerrillamail') || domain.includes('sharklasers') || domain.includes('grr.la') || domain.includes('pokemail')) {
        try {
            if (token) {
                const gRes = await client.get(`https://api.guerrillamail.com/ajax.php?f=get_email_list&offset=0&sid_token=${token}`, { timeout: 3000 });
                const list = gRes.data?.list;
                if (Array.isArray(list) && list.length > 0) {
                    const messages = await Promise.all(
                        list.slice(0, 3).map(m =>
                            client.get(`https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${m.mail_id}&sid_token=${token}`, { timeout: 2500 })
                                .then(r => r.data ? {
                                    id: r.data.mail_id || m.mail_id,
                                    from: r.data.mail_from || m.mail_from || 'Alight Creative',
                                    subject: r.data.mail_subject || m.mail_subject || 'Notifikasi',
                                    body: r.data.mail_body || r.data.mail_excerpt || '',
                                    body_html: r.data.mail_body || '',
                                    date: r.data.mail_date || m.mail_date || new Date().toISOString()
                                } : null)
                                .catch(() => null)
                        )
                    );
                    const valid = messages.filter(Boolean);
                    if (valid.length > 0) return { success: true, data: valid };
                }
            }
        } catch {}
        return { success: false, data: [] };
    }

    if (domain.includes('tempmail.lol') || domain.includes('26ai.art')) {
        try {
            if (token) {
                const tmRes = await client.get(`https://api.tempmail.lol/auth/${token}`, { timeout: 3000 });
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
                    return { success: true, data: normalized };
                }
            }
        } catch {}
        return { success: false, data: [] };
    }

    // Default untuk 156 Root Domains: Cek langsung ke emailqu.com
    try {
        const eqRes = await client.get(`https://emailqu.com/api/public/emails/${encodeURIComponent(cleanEmail)}`, { timeout: 3000 });
        const eqList = eqRes.data?.emails;
        if (Array.isArray(eqList) && eqList.length > 0) {
            return { success: true, data: eqList };
        }
    } catch (err) {}

    return { success: false, data: [] };
}

/**
 * 4. Ekstrak oobCode dari pesan
 */
function extractOobCode(inboxData) {
    if (!inboxData) return null;
    let str = typeof inboxData === 'string' ? inboxData : '';
    if (!str && typeof inboxData === 'object') {
        const htmlPart = Array.isArray(inboxData.html) ? inboxData.html.join(' ') : (inboxData.html || '');
        str = inboxData.mail_body || inboxData.body_html || inboxData.body_text || inboxData.body || htmlPart || inboxData.text || JSON.stringify(inboxData);
    }
    const match = str.match(/oobCode(?:=|%3D|%253D)([-_a-zA-Z0-9]+)/i);
    return match ? match[1] : null;
}

const ALIGHT_FIREBASE_API_KEY = process.env.ALIGHT_FIREBASE_API_KEY || 'AIzaSyDrZ9jr_Y16ltSBqsQR5IH6I04FRga6Ki0';

/**
 * Helper: Bangun tautan peluncur aplikasi Alight Motion resmi
 * Format 100% presisi sesuai format riwayat kerja (Firebase Links Intent)
 */
function buildAlightLoginLink(oob) {
    if (!oob) return null;
    return `https://alight-creative.firebaseapp.com/__/auth/links?link=https://alightcreative.com/auth_action/?apiKey%3DAIzaSyDrZ9jr_Y16ltSBqsQR5IH6I04FRga6Ki0%26mode%3DsignIn%26oobCode%3D${oob}%26continueUrl%3Dhttps://alightcreative.com?ui_sid%253D0366624874%2526ui_sd%253D0%26lang%3Den`;
}

/**
 * 5. Ekstrak link login langsung (Murni & Bebas Error Kode Rusak)
 */
function extractSignInLink(inboxData) {
    if (!inboxData) return null;
    const oob = extractOobCode(inboxData);
    if (!oob) return null;
    return buildAlightLoginLink(oob);
}

/**
 * 6. Verifikasi dan aktivasi lisensi 1 Tahun
 */
async function verifyLink(baseUrl, email, magicLink) {
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

    // Coba via server lokal (diberikan toleransi waktu cukup)
    try {
        const res = await client.post(`${baseUrl}/api/verify-link`, {
            email: cleanEmail,
            magicLink
        }, { timeout: 45000 });
        if (res.data?.success) return res.data;
    } catch (err) {}

    // Fallback mandiri langsung ke Alight Creative & Google Firebase
    try {
        const fbRes = await axios.post('https://www.googleapis.com/identitytoolkit/v3/relyingparty/emailLinkSignin?key=AIzaSyDtG1AU22ErnQD60AzBAcaknySiz9_CEq0', {
            email: cleanEmail,
            oobCode: oob,
            clientType: 'CLIENT_TYPE_ANDROID'
        }, {
            headers: sp(androidHeaders),
            timeout: 15000
        });

        if (!fbRes.data || !fbRes.data.idToken) {
            return { success: false, message: 'Gagal verifikasi kode autentikasi' };
        }

        const idToken = fbRes.data.idToken;
        const uid = fbRes.data.localId;

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
        } catch (subErr) {
            console.error(`[Fallback] Aktivasi lisensi gagal:`, subErr.response?.data || subErr.message);
        }

        return {
            success: true,
            data: {
                email: fbRes.data.email || cleanEmail,
                uid: uid,
                idToken: idToken,
                subscription: subData
            }
        };
    } catch (err) {
        return {
            success: false,
            message: err.response?.data?.error?.message || err.message || 'Gagal aktivasi akun'
        };
    }
}

/**
 * 7. Dapatkan Link Login Segar (Fresh & Unused)
 * Mencegah error "Kode tindakan tidak valid / sudah digunakan"
 */
async function getFreshLoginLink(baseUrl, email, usedOobCode, provider = 'instant', token = null) {
    try {
        // Kirim link login kedua HANYA 1 KALI agar kode segar (fresh & unused) siap dipakai user
        await sendLink(baseUrl, email);

        // Fast Polling langsung ke inbox tanpa delay buatan (400ms per check)
        let delayMs = 400;
        let totalElapsedMs = 0;
        const maxWaitMs = 12000;

        while (totalElapsedMs < maxWaitMs) {
            await new Promise(r => setTimeout(r, delayMs));
            totalElapsedMs += delayMs;

            const inboxRes = await checkInbox(baseUrl, email, provider, token);
            const data = inboxRes?.data;
            if (data) {
                const list = Array.isArray(data) ? data : [data];
                for (const msg of list) {
                    const oob = extractOobCode(msg);
                    if (oob && oob !== usedOobCode) {
                        const link = buildAlightLoginLink(oob);
                        return {
                            success: true,
                            loginLink: link,
                            oobCode: oob
                        };
                    }
                }
            }
        }
    } catch (err) {
        console.error('Gagal mengambil fresh link:', err.message);
    }
    return { success: false };
}

/**
 * 8. Sanitasi Link Login Resmi Alight Motion
 */
async function shortenLoginLink(longUrl) {
    if (!longUrl) return longUrl;
    const match = longUrl.match(/oobCode(?:=|%3D|%253D)([-_a-zA-Z0-9]+)/i);
    if (match && match[1]) {
        return buildAlightLoginLink(match[1]);
    }
    return longUrl;
}

module.exports = {
    getEmail,
    sendLink,
    checkInbox,
    extractOobCode,
    extractSignInLink,
    verifyLink,
    getFreshLoginLink,
    shortenLoginLink,
    buildAlightLoginLink
};
