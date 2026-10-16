const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}
const COUNTER_FILE = path.join(DATA_DIR, 'order_counter.json');
const ROOT_COUNTER_FILE = path.join(__dirname, '..', 'order_counter.json');
const INITIAL_COUNTER = 519018; // Panggilan berikutnya akan menghasilkan AM-ACT-519019

let currentCounter = null;
let highestIssuedCounter = 0;

function loadCounter() {
    try {
        const fileToRead = fs.existsSync(COUNTER_FILE) ? COUNTER_FILE : (fs.existsSync(ROOT_COUNTER_FILE) ? ROOT_COUNTER_FILE : null);
        if (fileToRead) {
            const data = JSON.parse(fs.readFileSync(fileToRead, 'utf-8'));
            if (typeof data.counter === 'number') {
                currentCounter = data.counter;
                if (currentCounter > highestIssuedCounter) {
                    highestIssuedCounter = currentCounter;
                }
                if (fileToRead === ROOT_COUNTER_FILE && !fs.existsSync(COUNTER_FILE)) {
                    saveCounter(currentCounter);
                }
                return currentCounter;
            }
        }
    } catch (err) {}
    if (currentCounter !== null) return currentCounter;
    currentCounter = INITIAL_COUNTER;
    highestIssuedCounter = currentCounter;
    saveCounter(currentCounter);
    return currentCounter;
}

function saveCounter(val) {
    try {
        fs.writeFileSync(COUNTER_FILE, JSON.stringify({ counter: val, lastUpdated: new Date().toISOString() }, null, 2), 'utf-8');
    } catch (err) {}
}

function getNextOrderId() {
    const fromDisk = loadCounter();
    // Gunakan nilai terbesar antara disk dan riwayat sesi agar mustahil mundur atau duplikat
    const base = Math.max(fromDisk, highestIssuedCounter);
    const nextVal = base + 1;
    highestIssuedCounter = nextVal;
    currentCounter = nextVal;
    saveCounter(nextVal);
    return `AM-ACT-${nextVal}`;
}

function peekCurrentOrderId() {
    return `AM-ACT-${loadCounter()}`;
}

function getCurrentCounter() {
    return loadCounter();
}

function setCounter(val) {
    const num = parseInt(val, 10);
    if (isNaN(num)) return false;
    currentCounter = num;
    highestIssuedCounter = num;
    saveCounter(currentCounter);
    return currentCounter;
}

module.exports = {
    getNextOrderId,
    peekCurrentOrderId,
    getCurrentCounter,
    setCounter
};
