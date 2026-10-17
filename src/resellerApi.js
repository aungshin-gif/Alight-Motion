// src/resellerApi.js
const BASE_URL = process.env.RESELLER_BASE_URL || 'https://YOUR_API_DOMAIN';
const API_KEY = process.env.RESELLER_API_KEY || '';
const SECRET_KEY = process.env.RESELLER_SECRET_KEY || '';

const getHeaders = () => ({
    'Content-Type': 'application/json',
    'X-API-Key': API_KEY,
    'X-Secret-Key': SECRET_KEY
});

/**
 * ၁။ Streaming အကောင့်အသစ် ထုတ်ယူခြင်း (POST /api/v1/generate)
 */
async function generateStreamingAccount(platform = 'netflix', region = null) {
    try {
        const body = { platform };
        if (region && region !== 'AUTO') {
            body.region = region;
        }

        const res = await fetch(`${BASE_URL}/api/v1/generate`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(body)
        });
        return await res.json();
    } catch (error) {
        return { success: false, message: error.message };
    }
}

/**
 * ၂။ မိမိ၏ Reseller Profile နှင့် လက်ကျန် Quota စစ်ဆေးခြင်း (GET /api/v1/profile)
 */
async function checkResellerProfile() {
    try {
        const res = await fetch(`${BASE_URL}/api/v1/profile`, {
            method: 'GET',
            headers: getHeaders()
        });
        return await res.json();
    } catch (error) {
        return { success: false, message: error.message };
    }
}

/**
 * ၃။ လက်ကျန် Stock စာရင်း စစ်ဆေးခြင်း (GET /api/v1/stock)
 */
async function checkStreamingStock() {
    try {
        const res = await fetch(`${BASE_URL}/api/v1/stock`, {
            method: 'GET'
        });
        return await res.json();
    } catch (error) {
        return { success: false, message: error.message };
    }
}

module.exports = {
    generateStreamingAccount,
    checkResellerProfile,
    checkStreamingStock
};
