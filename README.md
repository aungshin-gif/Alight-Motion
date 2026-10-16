# 🤖 AM Auto Regist - Telegram Bot

Automated Telegram Bot for creating and activating **Alight Motion Pro** 1-Year accounts instantly.

---

## 📁 Project Structure
```text
am-auto-regist/
├── .env                  # Telegram Bot Token & API Configurations
├── .env.example          # Sample environment configuration template
├── .gitignore            # Git ignored files & node_modules
├── package.json          # Node.js project dependencies
├── index.js              # Unified launcher (API Server + Bot)
├── SETUP_GUIDE.txt       # Complete English setup guide
├── PANDUAN_PEMBELI.txt   # Indonesian setup guide
├── src/                  # Source code (bot logic, API engine, i18n)
│   ├── api.js            # Email generator & Alight Motion engine
│   ├── bot.js            # Telegraf Telegram bot handlers
│   ├── i18n.js           # Multi-language translation system (8 languages)
│   ├── orderCounter.js   # Order counter & invoice tracker
│   └── server.js         # Embedded Express local API server
└── data/                 # Database & persistent files
    ├── bot_users.json    # Registered user list
    ├── order_counter.json# Order counter state
    └── verified_156_domains.json # Active verified Emailqu root domains
```

---

## ⚙️ Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure `.env`:
   Fill in your `BOT_TOKEN` from [@BotFather](https://t.me/BotFather) and `OWNER_ID` from [@userinfobot](https://t.me/userinfobot).

3. Start the bot:
   ```bash
   npm start
   ```

4. Open Telegram, search for your bot, and send `/start`.

---

## 🎯 Key Features

1. ⚡ **Single Account Generation**:
   * Fully automated in 10–15 seconds without manual OTP or email inputs.
   * Delivers instant direct login link for the official Alight Motion mobile app.

2. 📦 **Bulk Generation**:
   * Quick buttons (5, 15, 25, 50, 100 accounts) or custom quantities (1–200).
   * Includes emergency `🛑 Stop & Collect Results` button at any time.
   * Outputs formatted, clean `.txt` document (30-character mobile-friendly format).

3. 👑 **Owner Control Dashboard (`/owner` or `/admin`)**:
   * Real-time transaction stats & active queue monitoring.
   * Invoice number changer (`/setnota <number>`).
   * Queue manager (`/startqueue` & `/stopqueue`).
   * Broadcast announcements (`/broadcast` & `/broadcastpin`).
   * Customer OTP lookup (`/cekinbox <email>`).
   * Force channel subscription gate (`/forcesub` & `/setchannel`).
   * Database backup (`/backup`).
