// Entry point gabungan: Menjalankan Server API Mandiri & Bot Telegram sekaligus
console.log('===========================================================');
console.log('🚀 MEMULAI SISTEM AM AUTO REGIST MANDIRI...');
console.log('===========================================================');

// Tangani error global agar server dan bot tidak pernah crash jika ditinggal
process.on('uncaughtException', (err) => {
    console.error('🛡️ [Safety Guard] Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('🛡️ [Safety Guard] Unhandled Rejection:', reason?.message || reason);
});

// 1. Jalankan Server API lokal
require('./src/server');

// 2. Jalankan Bot Telegram
require('./src/bot');
