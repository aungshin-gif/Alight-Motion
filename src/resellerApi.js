// src/resellerApi.js
const BASE_URL = (process.env.RESELLER_BASE_URL || 'https://api.duniakonter.store').replace(/\/+$/, '');
const API_KEY = process.env.RESELLER_API_KEY || '';
const SECRET_KEY = process.env.RESELLER_SECRET_KEY || '';

// Node's fetch only says "fetch failed"; the real reason (DNS, refused, TLS, timeout) is in error.cause
function describeError(error) {
    const code = error.cause?.code || error.cause?.message;
    return code
        ? `${error.message} (${code}) → ${BASE_URL}`
        : `${error.message} → ${BASE_URL}`;
}

// Reads the body as text first so a non-JSON reply (e.g. "404 page not found") shows HTTP status + body instead of a JSON parse error
async function parseResponse(res) {
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch {
        const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 120);
        return { success: false, message: `HTTP ${res.status} ${res.url} → ${snippet || '(empty)'}` };
    }
}

const getHeaders = () => ({
    'Content-Type': 'application/json',
    'X-API-Key': API_KEY,
    'X-Secret-Key': SECRET_KEY
});

async function generateStreamingAccount(platform = 'netflix', region = null) {
    try {
        const body = { platform };
        if (region && region !== 'AUTO') {
            body.region = region;
        }
        const res = await fetch(`${BASE_URL}/api/v1/generate`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(90000)
        });
        return await parseResponse(res);
    } catch (error) {
        return { success: false, message: describeError(error) };
    }
}

async function checkResellerProfile() {
    try {
        const res = await fetch(`${BASE_URL}/api/v1/profile`, {
            method: 'GET',
            headers: getHeaders()
        });
        return await parseResponse(res);
    } catch (error) {
        return { success: false, message: describeError(error) };
    }
}

async function checkStreamingStock() {
    try {
        const res = await fetch(`${BASE_URL}/api/v1/stock`, {
            method: 'GET'
        });
        return await parseResponse(res);
    } catch (error) {
        return { success: false, message: describeError(error) };
    }
}

module.exports = {
    generateStreamingAccount,
    checkResellerProfile,
    checkStreamingStock
};
