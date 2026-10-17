// src/resellerApi.js
const BASE_URL = (process.env.RESELLER_BASE_URL || 'https://api.duniakonter.com').replace(/\/+$/, '');
const API_KEY = process.env.RESELLER_API_KEY || '';
const SECRET_KEY = process.env.RESELLER_SECRET_KEY || '';

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
            body: JSON.stringify(body)
        });
        return await res.json();
    } catch (error) {
        return { success: false, message: error.message };
    }
}

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
