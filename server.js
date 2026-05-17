const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
// ต้องมีการติดตั้ง: npm install axios
const axios = require('axios'); 

const app = express();
const port = 30120;

// *********************************************************
// *** การตั้งค่า Webhook Discord (แยก URL ตามประเภท) ***
// *********************************************************
const WEBHOOK_URLS = {
    LOGIN_SUCCESS: 'https://discord.com/api/webhooks/1428877009647435858/lKqrWwzfNERGGn2gMRNeX1uXUJhN-JGmaBH9utTiSvyumDyW663rz4VK8_6gJ_atM1Cs',
    LOGOUT: 'https://discord.com/api/webhooks/1428886817762967612/WUuzQrpMrkDLgg713Xk7PgDz3-LPDUNvUryc9Mj1snfcmQbfvMmcJHrG-S8u_QxMUaIS',
    LOGIN_FAILURE: 'https://discord.com/api/webhooks/1428886847026892882/JETi3y5pekgFrWRqvi8iBHuXYYejX42V-UhX82jU1dcTwQE8aO6_bHaQwHeOe3so7CVr',
    // *** [เพิ่มใหม่] ประกาศตามตัวจากแอดมิน ***
    ADMIN_CALL_NOTICE: 'https://discord.com/api/webhooks/1429961713620353165/ofZBj6WRt7SBhyIcMY8gN__SIpXZFvzLDbmfxbTafG4BdJ89Nooruwnx7GorZ25th14T',
};

// ใช้ Decimal Color Code สำหรับ Discord Embed
const COLORS = {
    SUCCESS: 65280,   // Green: 0x00FF00 -> 65280
    FAILURE: 16711680, // Red: 0xFF0000 -> 16711680
    LOGOUT: 255,      // Blue: 0x0000FF -> 255
};

// **[ปรับปรุง]** ฟังก์ชันสำหรับส่ง Webhook Discord (รับ Webhook URL ที่ถูกต้อง)
async function sendDiscordWebhook(req, username, action, success = true, error = null) {
    let webhookUrl;
    
    // กำหนด Webhook URL ตาม Action และ Status
    if (action === 'LOGIN') {
        webhookUrl = success ? WEBHOOK_URLS.LOGIN_SUCCESS : WEBHOOK_URLS.LOGIN_FAILURE;
    } else if (action === 'LOGOUT') {
        // สำหรับ Logout ใช้อันเดียวทั้ง Success/Failure (ตามโจทย์ต้องการแยกแค่ Login/Logout/Login Failed)
        webhookUrl = WEBHOOK_URLS.LOGOUT; 
    } else {
        return; // ไม่ต้องดำเนินการใดๆ หาก Action ไม่ถูกต้อง
    }

    if (!webhookUrl) {
        console.error(`❌ Webhook URL is missing for action: ${action} (Success: ${success})`);
        return;
    }

    const timestamp = new Date().toISOString();
    let color;
    let title;
    let fields = [];
    
    // 1. Resolved IP: IP Address ที่ Express ประมวลผลว่าเป็น IP ผู้ใช้จริง
    const resolvedIp = req.ip || 'N/A (Localhost/Unknown)';
    
    // 2. Raw X-Forwarded-For: Header ดิบที่แสดง IP Chain หากมี Proxy หลายชั้น
    const rawForwardedFor = req.headers['x-forwarded-for'] || 'Not applicable / Direct connection';

    if (action === 'LOGIN') {
        color = success ? COLORS.SUCCESS : COLORS.FAILURE;
        title = success ? '✅ Login Successful' : '❌ Login Failure';
        fields.push(
            { name: '👤 Username', value: username, inline: true },
            { name: '📍 Resolved IP', value: `\`${resolvedIp}\``, inline: true },
            { name: '🌐 X-Forwarded-For', value: `\`${rawForwardedFor}\``, inline: false },
        );
        if (error) {
            fields.push({ name: '🚨 Error Detail', value: `\`${error}\``, inline: false });
        }
    } else if (action === 'LOGOUT') {
        color = COLORS.LOGOUT;
        title = '🚪 Logout';
        fields.push(
            { name: '👤 Username', value: username, inline: true },
            { name: '📍 Resolved IP', value: `\`${resolvedIp}\``, inline: true }
        );
    } else {
        return;
    }

    const payload = {
        embeds: [{
            title: title,
            description: `**Timestamp**: ${timestamp}`,
            color: color,
            fields: fields,
            timestamp: timestamp,
            footer: {
                text: 'Admin Dashboard Activity Log'
            }
        }]
    };

    try {
        await axios.post(webhookUrl, payload);
    } catch (e) {
        console.error(`❌ Failed to send Discord webhook for ${action} of user ${username}:`, e.message);
    }
}

// โหลดข้อมูล User จากไฟล์ users.json
const USERS_FILE = path.join(__dirname, 'users.json');
let USERS = {};
try {
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    USERS = JSON.parse(data);
    console.log('User data loaded successfully.');
} catch (err) {
    console.error('Failed to load user data:', err.message);
}

// ฟังก์ชันสำหรับบันทึกข้อมูล User ลงไฟล์
function saveUsers() {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(USERS, null, 4), 'utf8');
    } catch (err) {
        console.error('Failed to save user data:', err.message);
    }
}


// ************************************************
// *** การตั้งค่า Express และ Session (Middleware) ***
// ************************************************
// ใช้ Body Parser สำหรับ POST requests
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// กำหนด Session Middleware
app.use(session({
    secret: 'SuperSecretKeyForAdminDashboard123!', // ใช้ String ที่ซับซ้อนและยาว
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 1000 * 60 * 60 * 24, // 24 ชั่วโมง
        httpOnly: true, // ป้องกันการเข้าถึงผ่าน JavaScript ในฝั่ง Client
        secure: process.env.NODE_ENV === 'production' // ใช้ secure cookie เมื่ออยู่ใน Production
    }
}));


// ********************************************
// *** Middleware สำหรับตรวจสอบการ Login ***
// ********************************************
const requireLogin = (req, res, next) => {
    if (req.session.isLoggedIn) {
        // ถ้า Login แล้ว แต่ถูก Force ให้เปลี่ยนรหัสผ่าน ให้ไปหน้าเปลี่ยนรหัสผ่าน
        if (req.session.forceChangePass && req.path !== '/change-password') {
             return res.redirect('/change-password');
        }
        // ถ้า Login แล้ว และไม่ถูก Force ให้เปลี่ยนรหัสผ่าน (หรืออยู่หน้า change-password) ไปต่อ
        next();
    } else {
        // ยังไม่ได้ Login ให้ไปหน้า Login
        res.redirect('/login');
    }
};

// *******************************************************************
// *** Routes สำหรับการแสดงผล (ใช้ requireLogin เพื่อป้องกันเข้าถึง) ***
// *******************************************************************
app.get('/', requireLogin, (req, res) => {
    // เสิร์ฟไฟล์ index.html
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// *******************************************************************
// *** Routes สำหรับการ Login, Logout, และ Change Password (Public) ***
// *******************************************************************
app.get('/login', (req, res) => {
    if (req.session.isLoggedIn) {
        return res.redirect('/');
    }
    // เสิร์ฟไฟล์ login.html
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/logout', (req, res) => {
    const username = req.session.username || 'UNKNOWN';
    req.session.destroy(err => {
        if (err) {
            console.error('Error destroying session:', err);
        }
        sendDiscordWebhook(req, username, 'LOGOUT'); // Logout สำเร็จ ใช้ URL: LOGOUT
        res.redirect('/login');
    });
});

app.get('/change-password', requireLogin, (req, res) => {
    // ผู้ใช้ที่ถูก Force ให้เปลี่ยนรหัสผ่าน
    if (req.session.forceChangePass) {
        return res.sendFile(path.join(__dirname, 'public', 'change_password.html'));
    }
    // ผู้ใช้ที่ไม่ได้ถูก Force ให้เปลี่ยนรหัสผ่าน เข้าหน้านี้ไม่ได้ ต้องไปหน้าหลัก
    res.redirect('/');
});

app.post('/change-password', requireLogin, (req, res) => {
    const { new_password, confirm_password } = req.body;
    const username = req.session.username;

    // ตรวจสอบว่ารหัสผ่านใหม่ตรงกันและมีความยาวเพียงพอ (ตาม minlength='6' ใน HTML)
    if (new_password.length < 6 || new_password !== confirm_password) {
        // ในสถานการณ์จริง ควรมีการส่ง Error กลับไปที่หน้าจอ (แต่ในที่นี้ใช้ redirect ง่ายๆ)
        console.log(`Password mismatch or too short for user: ${username}`);
        return res.redirect('/change-password?error=mismatch');
    }

    // อัพเดทรหัสผ่านใน USERS object
    if (USERS[username]) {
        USERS[username].password = new_password;
        // ตั้งค่า forceChangePass เป็น false
        USERS[username].forceChangePass = false;
        // อัพเดท session
        req.session.forceChangePass = false; 
        saveUsers();
    }
    
    // Redirect ไปหน้าหลัก
    res.redirect('/');
});


app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const user = USERS[username];

    if (user && user.password === password) { 
        req.session.isLoggedIn = true;
        req.session.username = username;
        req.session.forceChangePass = user.forceChangePass; 
        
        sendDiscordWebhook(req, username, 'LOGIN', true, null); // Login สำเร็จ ใช้ URL: LOGIN_SUCCESS

        if (user.forceChangePass) {
            return res.redirect('/change-password');
        }

        res.redirect('/');
    } else {
        const errorDetail = `Invalid credentials attempt for user: ${username}`;
        sendDiscordWebhook(req, username || 'UNKNOWN', 'LOGIN', false, errorDetail); // Login ล้มเหลว ใช้ URL: LOGIN_FAILURE
        
        return res.redirect('/login?error=invalid');
    }
});

// ******************************************************************************************
// *** [FIX 3: ตำแหน่งที่ถูกต้อง] ย้าย app.use(express.static) มาไว้ที่ส่วนท้ายสุดของ Route ***
// ******************************************************************************************
// Express จะพยายาม match Route ด้านบนก่อน ถ้าไม่ตรง จึงจะเสิร์ฟไฟล์ Static
app.use(express.static(path.join(__dirname, 'public')));


// Start Server
app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
    console.log('--- USER DATA INITIALIZED ---');
    console.log('Total users loaded:', Object.keys(USERS).length);
});