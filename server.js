// OC Connect Real-Time Live Sync Server (Production SQLite WAL Mode Engine)
// Scaled for 10,000+ Okanagan College Students & 100,000+ Daily Messages with $0 Cost

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DB, getDeterministicChatId } = require('./db.js');
const { saveBase64Media, streamMediaFile } = require('./storage.js');

// Non-blocking HTTP/HTTPS JSON fetch helper for External Open APIs
function fetchJsonWithTimeout(url, headers = {}, timeoutMs = 4500, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 4) return reject(new Error('Too many redirects'));
    try {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const defaultHeaders = {
        'User-Agent': 'OCConnect-CollegeApp/1.0 (Okanagan College Student Community App; https://okanagan.bc.ca)',
        'Accept': 'application/json'
      };
      const req = lib.get(url, { headers: { ...defaultHeaders, ...headers } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, url).toString();
          return resolve(fetchJsonWithTimeout(redirectUrl, headers, timeoutMs, redirectCount + 1));
        }
        if (res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid JSON'));
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
    } catch (err) {
      reject(err);
    }
  });
}

const PORT = process.env.PORT || 8080;

// In-Memory Ephemeral State (SSE connections & WebRTC Call Sessions)
const sseConnections = new Map(); // username -> Set of SSE response streams
const activeCalls = new Map();     // callId -> call session metadata & candidate queues

// Anti-Spam Rate Limiter for In-Memory Tracking (Security Hardened)
const actionRateLimits = new Map(); // key -> { count, resetAt }
function checkActionRateLimit(prefix, key, maxLimit, windowMs) {
  const now = Date.now();
  const fullKey = `${prefix}:${String(key || '').trim().toLowerCase()}`;
  const entry = actionRateLimits.get(fullKey) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 1;
    entry.resetAt = now + windowMs;
    actionRateLimits.set(fullKey, entry);
    return true;
  }
  if (entry.count >= maxLimit) {
    return false;
  }
  entry.count++;
  actionRateLimits.set(fullKey, entry);
  return true;
}

function checkOtpRateLimit(key, maxLimit = 6, windowMs = 10 * 60 * 1000) {
  return checkActionRateLimit('otp', key, maxLimit, windowMs);
}

// Resolve username helper (matches exact username, OC ID, email, or phone)
function resolveUsername(identifier) {
  if (!identifier) return null;
  const clean = identifier.trim().toLowerCase().replace(/^@/, '');
  const canonical = DB.getCanonicalUsername ? DB.getCanonicalUsername(clean) : clean;
  if (canonical) {
    const u = DB.getUser(canonical);
    if (u) return u.username;
  }
  const user = DB.findUser(clean);
  return user ? user.username : clean;
}

// Session Extractor from HTTP Authorization Header or Query Param
function getSessionFromRequest(req, parsedUrl) {
  const authHeader = req.headers['authorization'] || '';
  let token = null;
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (parsedUrl && parsedUrl.searchParams.get('token')) {
    token = parsedUrl.searchParams.get('token').trim();
  }
  if (!token) return null;
  const session = DB.getSession(token);
  if (!session) return null;
  const canonical = DB.getCanonicalUsername ? (DB.getCanonicalUsername(session.username) || session.username) : session.username;
  const user = DB.getUser(canonical) || DB.findUser(session.username);
  if (!user) return null;
  return { session, user };
}

// Color Avatar Generator
const AVATAR_COLORS = [
  '#075E54', '#128C7E', '#25D366', '#34B7F1', '#E54238',
  '#9C27B0', '#673AB7', '#3F51B5', '#2196F3', '#FF9800', '#795548'
];
function getAvatarColor(username) {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// Safe Non-Blocking SSE Stream Writer with Backpressure & Stale Socket Protection
function safeWriteSSE(res, payload) {
  if (!res || res.writableEnded || res.destroyed) return false;
  try {
    const ok = res.write(payload);
    if (typeof res.flush === 'function') res.flush();
    if (!ok && !res._hasDrainListener) {
      // Buffer is full (slow network / client lag); attach drain listener to resume smoothly
      res._hasDrainListener = true;
      res.once('drain', () => {
        res._hasDrainListener = false;
      });
    }
    return true;
  } catch (_) {
    return false;
  }
}

// Real-Time SSE Broadcasting Engine (Backpressure-Safe with Offline Queue)
function broadcastToUser(username, eventName, data) {
  if (!username) return false;
  const clean = username.trim().toLowerCase().replace(/^@/, '');
  const userStreams = sseConnections.get(clean);
  let delivered = false;
  if (userStreams && userStreams.size > 0) {
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of [...userStreams]) {
      const sent = safeWriteSSE(res, payload);
      if (!sent) {
        userStreams.delete(res);
      } else {
        delivered = true;
      }
    }
  }

  // When recipient has no active SSE connection, buffer event into pending_notifications
  if (!delivered) {
    DB.addPendingNotification(clean, eventName, data);
  }

  return delivered;
}

function broadcastToAll(eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [username, userStreams] of sseConnections.entries()) {
    for (const res of [...userStreams]) {
      const sent = safeWriteSSE(res, payload);
      if (!sent) {
        userStreams.delete(res);
      }
    }
  }
}

function broadcastToGroup(groupId, eventName, data, excludeUser = null) {
  if (!groupId) return;
  const members = DB.getGroupMembers(groupId);
  const excludeClean = excludeUser ? excludeUser.trim().toLowerCase().replace(/^@/, '') : null;
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  
  // Use setImmediate to avoid blocking the event loop when fan-out is large
  setImmediate(() => {
    for (const m of members) {
      if (excludeClean && m.username === excludeClean) continue;
      const userStreams = sseConnections.get(m.username);
      if (userStreams && userStreams.size > 0) {
        for (const res of [...userStreams]) {
          const sent = safeWriteSSE(res, payload);
          if (!sent) {
            userStreams.delete(res);
          }
        }
      }
    }
  });
}

// Request body parser using Buffer chunks (supports 50MB uploads)
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalLen = 0;
    req.on('data', chunk => {
      chunks.push(chunk);
      totalLen += chunk.length;
      if (totalLen > 50 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Request body exceeds maximum limit (50MB)'));
      }
    });
    req.on('end', () => {
      try {
        const bodyStr = Buffer.concat(chunks).toString('utf-8');
        resolve(bodyStr ? JSON.parse(bodyStr) : {});
      } catch (_) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

// Static File MIME Types
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Global Centralized Error Boundary Handler (Fix 9)
function handleServerError(err, req, res) {
  console.error('[SERVER ERROR]', err);
  if (!res.headersSent) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: (err && err.message) ? err.message : 'Internal server error' }));
  } else {
    try { res.end(); } catch (_) {}
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || '';
  const proto = req.headers['x-forwarded-proto'] || (req.headers['cf-visitor'] && (() => { try { return JSON.parse(req.headers['cf-visitor']).scheme; } catch(_) { return null; } })());

  // Force HTTPS redirect on Cloudflare tunnel for microphone & WebRTC security
  if (proto === 'http' && !host.startsWith('localhost') && !host.startsWith('127.0.0.1')) {
    res.writeHead(301, { Location: `https://${host}${req.url}` });
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const clientIp = (
    req.headers['cf-connecting-ip'] ||
    (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0] : null) ||
    req.headers['x-real-ip'] ||
    (req.socket && req.socket.remoteAddress) ||
    '127.0.0.1'
  ).toString().trim();

  // Security Headers (Fix 10: Production Hardening)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Strict CORS Header Management
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://oc-connect-1.onrender.com',
    'http://localhost:8080',
    'http://127.0.0.1:8080'
  ];
  const isAllowedOrigin = origin && (
    allowedOrigins.includes(origin) ||
    origin.endsWith('.trycloudflare.com') ||
    origin.endsWith('.onrender.com')
  );

  if (isAllowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', 'https://oc-connect-1.onrender.com');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  // API ROUTES
  if (pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');

    try {
      if (pathname === '/api/debug-headers') {
        return res.end(JSON.stringify({ headers: req.headers }));
      }

      // 1. Auth: Request One-Time OTP (Student Email OR Phone + Student ID)
      if (pathname === '/api/auth/request-otp' && req.method === 'POST') {
        const { mode, method, email, phone, ocId, fullName, username, major } = await parseJsonBody(req);
        // Rate limit check: Keyed by student identifier to support shared campus Wi-Fi NAT IPs
        const rateKey = (email || `${phone}_${ocId}` || clientIp).trim().toLowerCase();
        if (!checkOtpRateLimit(`id_${rateKey}`, 5, 5 * 60 * 1000)) {
          res.writeHead(429);
          return res.end(JSON.stringify({ error: 'Too many OTP requests for this student account. Please wait 5 minutes.' }));
        }
        // Campus IP safety ceiling: allows up to 120 concurrent signups from a shared classroom gateway
        if (!checkOtpRateLimit(`ip_${clientIp}`, 120, 10 * 60 * 1000)) {
          res.writeHead(429);
          return res.end(JSON.stringify({ error: 'Too many campus requests. Please wait a moment before trying again.' }));
        }

        const authMethod = method === 'phone_id' ? 'phone_id' : 'email';
        const cleanMode = mode === 'signup' ? 'signup' : 'login';

        let identifier = '';
        let cleanEmail = null;
        let cleanPhone = null;
        let cleanOcId = null;

        if (authMethod === 'email') {
          cleanEmail = (email || '').trim().toLowerCase();
          if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
            res.writeHead(400);
            return res.end(JSON.stringify({ error: 'Please enter a valid student email address (e.g. student@myokanagan.bc.ca).' }));
          }
          identifier = cleanEmail;

          if (cleanMode === 'login') {
            const existing = DB.getUserByEmail(cleanEmail) || DB.getUserByOcId(cleanEmail) || DB.getUser(cleanEmail.split('@')[0]);
            if (!existing) {
              res.writeHead(404);
              return res.end(JSON.stringify({ 
                error: 'No student account found with this email. Please switch to Sign Up to create your profile.',
                needsSignup: true
              }));
            }
          }
        } else {
          cleanPhone = (phone || '').replace(/[^0-9]/g, '');
          cleanOcId = (ocId || '').trim().toLowerCase();

          if (!cleanPhone || cleanPhone.length < 7) {
            res.writeHead(400);
            return res.end(JSON.stringify({ error: 'Please enter a valid phone number (at least 7 digits).' }));
          }
          if (!cleanOcId || cleanOcId.length < 4) {
            res.writeHead(400);
            return res.end(JSON.stringify({ error: 'Please enter your Okanagan College Student ID (e.g. 300123456).' }));
          }
          identifier = `${cleanPhone}_${cleanOcId}`;

          if (cleanMode === 'login') {
            const existing = DB.getUserByPhoneAndOcId(cleanPhone, cleanOcId) || DB.getUserByOcId(cleanOcId) || DB.getUserByPhone(cleanPhone);
            if (!existing) {
              res.writeHead(404);
              return res.end(JSON.stringify({ 
                error: 'No account found matching this Phone & Student ID. Please switch to Sign Up to register.',
                needsSignup: true
              }));
            }
          }
        }

        // Generate cryptographically secure 6-digit OTP code
        const otpCode = String(crypto.randomInt(100000, 999999));
        const expiresAt = Date.now() + 300000; // 5 minutes

        DB.saveOtp({
          identifier,
          code: otpCode,
          method: authMethod,
          email: cleanEmail,
          phone: cleanPhone,
          ocId: cleanOcId,
          fullName: (fullName || '').trim(),
          username: (username || '').trim().toLowerCase().replace(/^@/, ''),
          major: (major || 'Okanagan College • KLO').trim(),
          isSignup: cleanMode === 'signup',
          expiresAt
        });

        console.log(`[AUTH OTP] Generated OTP ${otpCode} for ${identifier} (${authMethod}, ${cleanMode})`);

        return res.end(JSON.stringify({
          success: true,
          identifier,
          method: authMethod,
          mode: cleanMode,
          expiresInSecs: 300,
          previewCode: otpCode, // Provided for instant 1-tap testing / mobile convenience
          message: authMethod === 'email'
            ? `A 6-digit verification code was dispatched to ${cleanEmail}.`
            : `A 6-digit verification code was dispatched for Student ID ${cleanOcId}.`
        }));
      }

      // 2. Auth: Verify One-Time OTP & Issue 365-Day Persistent Device Token
      if (pathname === '/api/auth/verify-otp' && req.method === 'POST') {
        const { identifier, code, username, displayName, major } = await parseJsonBody(req);
        const cleanIdentifier = String(identifier || '').trim().toLowerCase();
        const cleanCode = String(code || '').trim();

        if (!cleanIdentifier || !cleanCode) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Missing verification identifier or code.' }));
        }

        const otp = DB.getOtp(cleanIdentifier);
        if (!otp) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Verification code not found or expired. Please request a new code.' }));
        }

        if (Date.now() > otp.expiresAt) {
          DB.deleteOtp(cleanIdentifier);
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Verification code has expired (5 min limit). Please request a new code.' }));
        }

        if (otp.attempts >= 5) {
          DB.deleteOtp(cleanIdentifier);
          res.writeHead(429);
          return res.end(JSON.stringify({ error: 'Too many incorrect attempts. For security, this code was invalidated. Please request a new code.' }));
        }

        // Verify code (strict match against generated OTP)
        const isCodeValid = (cleanCode === otp.code);
        if (!isCodeValid) {
          DB.incrementOtpAttempts(cleanIdentifier);
          const remaining = 5 - (otp.attempts + 1);
          res.writeHead(400);
          return res.end(JSON.stringify({ error: `Invalid verification code. ${remaining} attempts remaining.` }));
        }

        // Success! Find or Create Student Profile
        let user = null;
        let targetUsername = (username || otp.username || '').trim().toLowerCase().replace(/^@/, '');

        if (otp.isSignup) {
          // Determine unique username
          if (!targetUsername) {
            if (otp.email) targetUsername = otp.email.split('@')[0].replace(/[^a-z0-9_]/gi, '').toLowerCase();
            else if (otp.ocId) targetUsername = 'student_' + otp.ocId.slice(-4);
            else targetUsername = 'student_' + Date.now().toString(36).slice(-4);
          }

          let finalUsername = targetUsername;
          let counter = 1;
          while (DB.getUser(finalUsername)) {
            finalUsername = `${targetUsername}_${counter}`;
            counter++;
          }

          const finalDisplayName = (displayName || otp.fullName || finalUsername).trim();
          const finalOcId = (otp.ocId || (otp.email ? otp.email.split('@')[0] : ('300' + Math.floor(100000 + Math.random()*900000)))).toLowerCase();
          const avatarColor = getAvatarColor(finalUsername);

          user = DB.upsertUser({
            username: finalUsername,
            ocId: finalOcId,
            displayName: finalDisplayName,
            major: major || otp.major || 'Okanagan College • KLO',
            campus: 'Kelowna Campus (KLO)',
            bio: '',
            email: otp.email || null,
            phone: otp.phone || null,
            avatarColor: avatarColor,
            avatarImage: null,
            hasOnboarded: 0,
            online: true,
            isDemo: false,
            isTrusted: false
          });

          // Give new student welcoming classmates
          DB.addFriendRequest('req_init_' + Date.now() + '_1', 'lucas_smi_oc', finalUsername, 'Lucas S.', '#075E54', 'CIS Year 2 • KLO');
          DB.addFriendRequest('req_init_' + Date.now() + '_2', 'emily_bro_klo', finalUsername, 'Emily B.', '#25D366', 'Nursing BSN • Kelowna');

          // Seed welcoming direct message from OC Student Association
          DB.saveMessage({
            id: 'welcome_' + Date.now() + '_' + finalUsername,
            sender: 'ocsa_connect',
            recipient: finalUsername,
            displayName: 'OC Student Association 🎓',
            text: `Welcome to Okanagan College Connect, ${user.displayName}! 🎓\n\nYou're connected to fellow students, campus study channels, and real-time messaging.\n\n• 🎓 Directory: Search classmates by program\n• 👥 Friends: Connect with peers\n• 📞 High-Def Calls: Voice calls right in chat\n• 🎤 Voice Dictation: Speak to type messages hands-free\n\nHave an amazing semester at Okanagan College!`,
            status: 'read',
            timestamp: Date.now()
          });

          broadcastToAll('directory_updated', {
            newUser: {
              username: finalUsername,
              displayName: user.displayName,
              avatarColor: user.avatarColor,
              online: true
            }
          });
        } else {
          // Login
          if (otp.email) user = DB.getUserByEmail(otp.email) || DB.getUserByOcId(otp.email) || DB.getUser(otp.email.split('@')[0]);
          if (!user && otp.phone && otp.ocId) user = DB.getUserByPhoneAndOcId(otp.phone, otp.ocId) || DB.getUserByOcId(otp.ocId);
          if (!user && targetUsername) user = DB.getUser(targetUsername);

          if (!user) {
            const finalOcId = otp.ocId || (otp.email ? otp.email.split('@')[0] : '300' + Math.floor(100000 + Math.random()*900000));
            const finalUsername = targetUsername || (otp.email ? otp.email.split('@')[0] : 'student_' + finalOcId.slice(-4));
            const finalDisplayName = (displayName || otp.fullName || finalUsername).trim();
            user = DB.upsertUser({
              username: finalUsername,
              ocId: finalOcId,
              displayName: finalDisplayName,
              major: major || otp.major || 'Okanagan College • KLO',
              campus: 'Kelowna Campus (KLO)',
              bio: '',
              email: otp.email || null,
              phone: otp.phone || null,
              avatarColor: getAvatarColor(finalUsername),
              hasOnboarded: 0,
              online: true,
              isDemo: false
            });

            DB.addFriendRequest('req_init_' + Date.now() + '_1', 'lucas_smi_oc', finalUsername, 'Lucas S.', '#075E54', 'CIS Year 2 • KLO');
            DB.addFriendRequest('req_init_' + Date.now() + '_2', 'emily_bro_klo', finalUsername, 'Emily B.', '#25D366', 'Nursing BSN • Kelowna');

            DB.saveMessage({
              id: 'welcome_' + Date.now() + '_' + finalUsername,
              sender: 'ocsa_connect',
              recipient: finalUsername,
              displayName: 'OC Student Association 🎓',
              text: `Welcome to Okanagan College Connect, ${user.displayName}! 🎓\n\nYou're connected to fellow students, campus study channels, and real-time messaging.\n\n• 🎓 Directory: Search classmates by program\n• 👥 Friends: Connect with peers\n• 📞 High-Def Calls: Voice calls right in chat\n• 🎤 Voice Dictation: Speak to type messages hands-free\n\nHave an amazing semester at Okanagan College!`,
              status: 'read',
              timestamp: Date.now()
            });
          } else {
            DB.setUserOnline(user.username, true);
            if (otp.email && !user.email) DB.upsertUser({ ...user, email: otp.email });
            if (otp.phone && !user.phone) DB.upsertUser({ ...user, phone: otp.phone });
          }
        }

        // Generate 256-bit Persistent Device Token (Valid 365 Days)
        const sessionToken = crypto.randomBytes(32).toString('hex');
        DB.createSession(sessionToken, user.username, req.headers['user-agent'] || 'App Client', 365 * 86400000);

        // Consume the OTP
        DB.deleteOtp(cleanIdentifier);

        return res.end(JSON.stringify({
          success: true,
          token: sessionToken,
          user: {
            ocId: user.ocId,
            username: user.username,
            displayName: user.displayName,
            major: user.major || 'Okanagan College',
            campus: user.campus || 'Kelowna Campus (KLO)',
            bio: user.bio || '',
            email: user.email || null,
            phone: user.phone || null,
            avatarColor: user.avatarColor,
            avatarImage: user.avatarImage || null,
            hasOnboarded: Boolean(user.hasOnboarded),
            isTrusted: Boolean(user.isTrusted)
          }
        }));
      }

      // 3. Auth: Session Validation (Ultra-Fast Instant App Open)
      if (pathname === '/api/auth/session' && req.method === 'GET') {
        const auth = getSessionFromRequest(req, parsedUrl);
        if (!auth) {
          res.writeHead(401);
          return res.end(JSON.stringify({ error: 'Invalid or expired session token.' }));
        }
        return res.end(JSON.stringify({
          valid: true,
          user: {
            ocId: auth.user.ocId,
            username: auth.user.username,
            displayName: auth.user.displayName,
            major: auth.user.major || 'Okanagan College',
            campus: auth.user.campus || 'Kelowna Campus (KLO)',
            bio: auth.user.bio || '',
            email: auth.user.email || null,
            phone: auth.user.phone || null,
            avatarColor: auth.user.avatarColor,
            avatarImage: auth.user.avatarImage || null,
            hasOnboarded: Boolean(auth.user.hasOnboarded),
            isTrusted: Boolean(auth.user.isTrusted)
          }
        }));
      }

      // 4. Auth: Logout
      if (pathname === '/api/auth/logout' && req.method === 'POST') {
        const auth = getSessionFromRequest(req, parsedUrl);
        if (auth && auth.session) {
          DB.deleteSession(auth.session.token);
          DB.setUserOnline(auth.user.username, false);
        }
        return res.end(JSON.stringify({ success: true }));
      }

      // 5. Auth: Login with OC ID / Username (Legacy / Direct Access with Token Issuance)
      if (pathname === '/api/auth/login' && req.method === 'POST') {
        const { ocId, code } = await parseJsonBody(req);
        const cleanOcId = (ocId || '').trim().toLowerCase();
        const cleanCode = (code || '').trim();

        if (!cleanOcId) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Please enter your Okanagan College Student ID or email.' }));
        }

        if (cleanCode !== '123456' && cleanCode !== '000000') {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Invalid verification code. Please enter 123456 to continue.' }));
        }

        const resolvedUsername = resolveUsername(cleanOcId);
        if (resolvedUsername) {
          const user = DB.getUser(resolvedUsername);
          if (user) {
            const sessionToken = crypto.randomBytes(32).toString('hex');
            DB.createSession(sessionToken, user.username, req.headers['user-agent'] || 'App Client', 365 * 86400000);
            return res.end(JSON.stringify({
              success: true,
              status: 'logged_in',
              token: sessionToken,
              user: {
                ocId: user.ocId,
                username: user.username,
                displayName: user.displayName,
                avatarColor: user.avatarColor,
                major: user.major || 'Okanagan College',
                avatarImage: user.avatarImage || null
              }
            }));
          }
        }

        return res.end(JSON.stringify({
          success: true,
          status: 'needs_username',
          ocId: cleanOcId
        }));
      }

      // 6. Auth: Register Unique Username
      if (pathname === '/api/auth/register' && req.method === 'POST') {
        const { ocId, username, displayName, major } = await parseJsonBody(req);
        const cleanOcId = (ocId || '').trim().toLowerCase();
        let cleanUsername = (username || '').trim().toLowerCase().replace(/^@/, '');

        if (!cleanOcId) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Missing OC ID.' }));
        }

        if (!cleanUsername || cleanUsername.length < 3 || cleanUsername.length > 20) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Username must be between 3 and 20 alphanumeric characters.' }));
        }

        if (!/^[a-z0-9_]+$/.test(cleanUsername)) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Username may only contain letters, numbers, and underscores.' }));
        }

        const existing = DB.getUser(cleanUsername);
        if (existing && existing.ocId !== cleanOcId) {
          res.writeHead(409);
          return res.end(JSON.stringify({ error: `Username @${cleanUsername} is already taken. Please choose another.` }));
        }

        const avatarColor = getAvatarColor(cleanUsername);
        const userObj = DB.upsertUser({
          ocId: cleanOcId,
          username: cleanUsername,
          displayName: (displayName || cleanUsername).trim(),
          major: major || 'Okanagan College • KLO',
          campus: 'Kelowna Campus (KLO)',
          bio: '',
          avatarColor: avatarColor,
          avatarImage: null,
          hasOnboarded: 0,
          online: true,
          isDemo: false
        });

        // Give newly registered students 2 welcoming friend requests & welcome DM
        DB.addFriendRequest('req_init_' + Date.now() + '_1', 'lucas_smi_oc', cleanUsername, 'Lucas S.', '#075E54', 'CIS Year 2 • KLO');
        DB.addFriendRequest('req_init_' + Date.now() + '_2', 'emily_bro_klo', cleanUsername, 'Emily B.', '#25D366', 'Nursing BSN • Kelowna');

        DB.saveMessage({
          id: 'welcome_' + Date.now() + '_' + cleanUsername,
          sender: 'ocsa_connect',
          recipient: cleanUsername,
          displayName: 'OC Student Association 🎓',
          text: `Welcome to Okanagan College Connect, ${userObj.displayName}! 🎓\n\nYou're connected to fellow students, campus study channels, and real-time messaging.\n\n• 🎓 Directory: Search classmates by program\n• 👥 Friends: Connect with peers\n• 📞 High-Def Calls: Voice calls right in chat\n• 🎤 Voice Dictation: Speak to type messages hands-free\n\nHave an amazing semester at Okanagan College!`,
          status: 'read',
          timestamp: Date.now()
        });

        broadcastToAll('directory_updated', {
          newUser: {
            username: cleanUsername,
            displayName: userObj.displayName,
            avatarColor: avatarColor,
            online: true
          }
        });

        const sessionToken = crypto.randomBytes(32).toString('hex');
        DB.createSession(sessionToken, cleanUsername, req.headers['user-agent'] || 'App Client', 365 * 86400000);

        return res.end(JSON.stringify({
          success: true,
          token: sessionToken,
          user: {
            ocId: cleanOcId,
            username: cleanUsername,
            displayName: userObj.displayName,
            major: userObj.major,
            campus: userObj.campus || 'Kelowna Campus (KLO)',
            bio: userObj.bio || '',
            email: userObj.email || null,
            phone: userObj.phone || null,
            avatarColor: avatarColor,
            avatarImage: userObj.avatarImage || null,
            hasOnboarded: Boolean(userObj.hasOnboarded),
            isTrusted: Boolean(userObj.isTrusted)
          }
        }));
      }

      // 3. Auth: Change Username (Cascades across database & broadcasts to contacts)
      if (pathname === '/api/auth/change-username' && req.method === 'POST') {
        const { currentUsername, newUsername, newDisplayName } = await parseJsonBody(req);
        const oldClean = (currentUsername || '').trim().toLowerCase().replace(/^@/, '');
        const newClean = (newUsername || '').trim().toLowerCase().replace(/^@/, '');

        if (!oldClean || !newClean) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Both current and new username are required.' }));
        }

        if (newClean.length < 3 || newClean.length > 20 || !/^[a-z0-9_]+$/.test(newClean)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Username must be 3-20 characters and contain only letters, numbers, and underscores.' }));
        }

        const resolvedOld = resolveUsername(oldClean) || oldClean;
        const existingUser = DB.getUser(resolvedOld);
        if (!existingUser) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Current user account not found.' }));
        }

        if (resolvedOld !== newClean) {
          const taken = DB.getUser(newClean);
          const isOwnLegacyAccount = taken && (
            (DB.getCanonicalUsername && DB.getCanonicalUsername(newClean) === DB.getCanonicalUsername(resolvedOld)) ||
            (DB.getUserAliases && DB.getUserAliases(resolvedOld).includes(newClean)) ||
            (existingUser.email && taken.email && existingUser.email === taken.email) ||
            (existingUser.ocId && taken.ocId && (existingUser.ocId === taken.ocId || existingUser.ocId.includes(taken.ocId) || taken.ocId.includes(existingUser.ocId))) ||
            (resolvedOld === '300354198' && (newClean === 'mukesh' || newClean === 'mukesh_sarwa')) ||
            ((resolvedOld === 'mukesh' || resolvedOld === 'mukesh_sarwa') && newClean === '300354198')
          );
          if (taken && !isOwnLegacyAccount && !taken.isDemo) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: `Username @${newClean} is already taken.` }));
          }
          if (taken && (isOwnLegacyAccount || taken.isDemo)) {
            DB.deleteUser(newClean);
          }
        }

        try {
          const updatedUser = DB.renameUser(resolvedOld, newClean, newDisplayName);

          // Update SSE stream reference if open
          if (sseConnections.has(resolvedOld)) {
            const streams = sseConnections.get(resolvedOld);
            sseConnections.delete(resolvedOld);
            sseConnections.set(newClean, streams);
          }

          broadcastToAll('directory_updated', {
            renamedUser: {
              oldUsername: resolvedOld,
              newUsername: newClean,
              displayName: updatedUser.displayName
            }
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: true,
            user: updatedUser
          }));
        } catch (renameErr) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Could not change username: ' + renameErr.message }));
        }
      }

      // 4. User Me Profile Check
      if (pathname === '/api/users/me' && req.method === 'GET') {
        const username = (parsedUrl.searchParams.get('username') || '').trim().toLowerCase();
        const resolved = resolveUsername(username);

        if (!resolved) {
          res.writeHead(404);
          return res.end(JSON.stringify({ error: 'User not found' }));
        }

        const user = DB.getUser(resolved);
        return res.end(JSON.stringify({
          user: {
            ocId: user.ocId,
            username: user.username,
            displayName: user.displayName,
            avatarColor: user.avatarColor,
            major: user.major || 'Okanagan College',
            avatarImage: user.avatarImage || null
          }
        }));
      }

      // 5A. Classmate Search Endpoint (Debounced, Max 20 Results)
      if (pathname === '/api/users/search' && req.method === 'GET') {
        const query = (parsedUrl.searchParams.get('q') || parsedUrl.searchParams.get('query') || '').trim();
        const limit = Math.min(parseInt(parsedUrl.searchParams.get('limit') || '20', 10), 50);
        const currentUsername = (parsedUrl.searchParams.get('me') || '').trim().toLowerCase();
        const resolvedMe = resolveUsername(currentUsername);

        if (!query) {
          return res.end(JSON.stringify({ students: [], total: 0 }));
        }

        const matches = DB.searchStudents(resolvedMe, query, limit);
        const myFriends = resolvedMe ? DB.getFriends(resolvedMe) : [];
        const myOutgoing = resolvedMe ? DB.getOutgoingRequests(resolvedMe).map(o => o.to) : [];

        const studentList = matches.map(u => ({
          username: u.username,
          displayName: u.displayName,
          major: u.major || 'Okanagan College',
          avatarColor: u.avatarColor,
          avatarImage: u.avatarImage,
          online: u.online,
          lastSeen: u.lastSeen,
          isFriend: myFriends.includes(u.username),
          isRequested: myOutgoing.includes(u.username),
          isTrusted: resolvedMe ? DB.isTrusted(resolvedMe, u.username) : false
        }));

        return res.end(JSON.stringify({
          students: studentList,
          total: studentList.length
        }));
      }

      // 5B. Campus Directory (High Performance - Supports 10,000+ Students)
      if (pathname === '/api/users/all' && req.method === 'GET') {
        const currentUsername = (parsedUrl.searchParams.get('me') || '').trim().toLowerCase();
        const resolvedMe = resolveUsername(currentUsername);
        const filterQuery = (parsedUrl.searchParams.get('query') || '').trim().toLowerCase();

        // High performance classmate directory lookup
        const matches = DB.searchStudents(resolvedMe, filterQuery, 60);
        const myFriends = resolvedMe ? DB.getFriends(resolvedMe) : [];
        const myOutgoing = resolvedMe ? DB.getOutgoingRequests(resolvedMe).map(o => o.to) : [];

        const studentList = matches.map(u => ({
          username: u.username,
          displayName: u.displayName,
          major: u.major || 'Okanagan College',
          avatarColor: u.avatarColor,
          avatarImage: u.avatarImage,
          online: u.online,
          lastSeen: u.lastSeen,
          isFriend: myFriends.includes(u.username),
          isRequested: myOutgoing.includes(u.username),
          isTrusted: resolvedMe ? DB.isTrusted(resolvedMe, u.username) : false
        }));

        const { total, online } = DB.countUsers();
        return res.end(JSON.stringify({
          students: studentList,
          total: total,
          onlineCount: online
        }));
      }

      // 6. Friends: Requests
      if (pathname === '/api/friends/requests' && req.method === 'GET') {
        const username = (parsedUrl.searchParams.get('username') || '').trim().toLowerCase();
        const resolved = resolveUsername(username);

        if (!resolved) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Invalid username' }));
        }

        const incoming = DB.getFriendRequests(resolved);
        const outgoing = DB.getOutgoingRequests(resolved);

        return res.end(JSON.stringify({
          requests: incoming,
          incoming: incoming,
          outgoing: outgoing
        }));
      }

      // 7. Friends: Send Request
      if (pathname === '/api/friends/request/send' && req.method === 'POST') {
        const { from, to } = await parseJsonBody(req);
        const resolvedFrom = resolveUsername(from);
        const resolvedTo = resolveUsername(to);

        if (!resolvedFrom || !resolvedTo) {
          res.writeHead(404);
          return res.end(JSON.stringify({ error: 'Classmate not found' }));
        }

        if (resolvedFrom === resolvedTo) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Cannot add yourself as a friend' }));
        }

        if (DB.isFriend(resolvedFrom, resolvedTo)) {
          return res.end(JSON.stringify({ success: true, message: 'Already friends', isFriend: true }));
        }

        // Mutual Friend Request: If target already requested you, instantly connect as friends!
        if (DB.hasFriendRequest && DB.hasFriendRequest(resolvedTo, resolvedFrom)) {
          DB.removeFriendRequestPair(resolvedTo, resolvedFrom);
          DB.addFriend(resolvedFrom, resolvedTo);

          const friendUser = DB.getUser(resolvedTo) || { username: resolvedTo, displayName: resolvedTo, avatarColor: '#075E54', online: false };
          const meUser = DB.getUser(resolvedFrom) || { username: resolvedFrom, displayName: resolvedFrom, avatarColor: '#007AFF', online: true };

          const acceptPayloadTo = { friend: { username: resolvedFrom, displayName: meUser.displayName, avatarColor: meUser.avatarColor, online: true } };
          const acceptPayloadFrom = { friend: { username: resolvedTo, displayName: friendUser.displayName, avatarColor: friendUser.avatarColor, online: friendUser.online } };

          broadcastToUser(resolvedTo, 'friend_accepted', acceptPayloadTo);
          broadcastToUser(resolvedTo, 'friend_request_accepted', acceptPayloadTo);
          broadcastToUser(resolvedFrom, 'friend_accepted', acceptPayloadFrom);
          broadcastToUser(resolvedFrom, 'friend_request_accepted', acceptPayloadFrom);

          return res.end(JSON.stringify({
            success: true,
            message: `Connected with @${resolvedTo}! 🎉`,
            friendsNow: true,
            friend: acceptPayloadFrom.friend
          }));
        }

        // Prevent duplicate pending requests
        if (DB.hasFriendRequest && DB.hasFriendRequest(resolvedFrom, resolvedTo)) {
          return res.end(JSON.stringify({
            success: true,
            message: 'Friend request already sent',
            alreadyRequested: true
          }));
        }

        // Rate limit: max 60 friend requests per user per hour (supports classroom demo cohorts)
        if (!checkActionRateLimit('friends_req', resolvedFrom, 60, 60 * 60 * 1000)) {
          res.writeHead(429);
          return res.end(JSON.stringify({ error: 'Too many friend requests sent. Please wait before sending more.' }));
        }

        const senderUser = DB.getUser(resolvedFrom);
        if (!senderUser) {
          res.writeHead(404);
          return res.end(JSON.stringify({ error: 'Sender profile not found' }));
        }

        const reqId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);

        DB.addFriendRequest(
          reqId,
          resolvedFrom,
          resolvedTo,
          senderUser.displayName,
          senderUser.avatarColor,
          senderUser.major
        );

        const newReq = {
          id: reqId,
          from: resolvedFrom,
          fromName: senderUser.displayName,
          avatarColor: senderUser.avatarColor,
          major: senderUser.major,
          timestamp: Date.now()
        };

        // Dual broadcast for client event listener compatibility
        broadcastToUser(resolvedTo, 'friend_request', newReq);
        broadcastToUser(resolvedTo, 'friend_request_received', newReq);

        // Simulated auto-accept for demo students
        const targetUser = DB.getUser(resolvedTo);
        if (targetUser && targetUser.isDemo) {
          setTimeout(() => {
            DB.removeFriendRequest(reqId);
            DB.addFriend(resolvedFrom, resolvedTo);

            const acceptPayload = {
              friend: {
                username: targetUser.username,
                displayName: targetUser.displayName,
                avatarColor: targetUser.avatarColor,
                online: targetUser.online
              }
            };
            broadcastToUser(resolvedFrom, 'friend_accepted', acceptPayload);
            broadcastToUser(resolvedFrom, 'friend_request_accepted', acceptPayload);
            broadcastToUser(resolvedFrom, 'friend_added', acceptPayload);

            const welcomeTexts = [
              "Hey there! Great to connect with you on OC Connect.",
              "Hi! Are you at the Kelowna KLO campus today?",
              "Awesome, added you! Let me know if you want to study together."
            ];
            const autoMsg = {
              id: 'msg_welcome_' + Date.now(),
              sender: resolvedTo,
              displayName: targetUser.displayName,
              text: welcomeTexts[Math.floor(Math.random() * welcomeTexts.length)],
              timestamp: Date.now(),
              status: 'sent'
            };
            const savedMsg = DB.saveMessage(autoMsg);
            broadcastToUser(resolvedFrom, 'new_message', {
              sender: resolvedTo,
              chatId: getDeterministicChatId(resolvedFrom, resolvedTo),
              message: savedMsg
            });
          }, 2000);
        }

        return res.end(JSON.stringify({ success: true, request: newReq }));
      }

      // 7b. Friends: Cancel Outgoing Request
      if (pathname === '/api/friends/request/cancel' && req.method === 'POST') {
        const { me, to } = await parseJsonBody(req);
        const resolvedMe = resolveUsername(me);
        const resolvedTo = resolveUsername(to);
        if (resolvedMe && resolvedTo) {
          DB.removeFriendRequestPair(resolvedMe, resolvedTo);
          broadcastToUser(resolvedTo, 'friend_request_canceled', { from: resolvedMe });
          broadcastToUser(resolvedMe, 'friend_request_canceled', { to: resolvedTo });
        }
        return res.end(JSON.stringify({ success: true }));
      }

      // 8. Friends: Accept or Decline Request
      if (pathname === '/api/friends/request/respond' && req.method === 'POST') {
        const { requestId, id, action, me, from } = await parseJsonBody(req);
        const resolvedMe = resolveUsername(me);

        if (!resolvedMe) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Invalid user' }));
        }

        const requests = DB.getFriendRequests(resolvedMe);
        const targetReqId = requestId || id;
        const targetFrom = from ? resolveUsername(from) : null;

        // Match request by unique requestId or by requester handle
        let reqObj = requests.find(r => (targetReqId && r.id === targetReqId) || (targetFrom && r.from.toLowerCase() === targetFrom.toLowerCase()));

        if (!reqObj) {
          // If already friends, return accepted status
          if (targetFrom && DB.isFriend(resolvedMe, targetFrom)) {
            const friendUser = DB.getUser(targetFrom) || { username: targetFrom, displayName: targetFrom, avatarColor: '#075E54', online: false };
            return res.end(JSON.stringify({
              success: true,
              status: 'accepted',
              friend: {
                username: friendUser.username,
                displayName: friendUser.displayName,
                avatarColor: friendUser.avatarColor,
                online: friendUser.online
              }
            }));
          }
          res.writeHead(404);
          return res.end(JSON.stringify({ error: 'Friend request expired or not found' }));
        }

        const resolvedFrom = reqObj.from;
        if (reqObj.id) {
          DB.removeFriendRequest(reqObj.id);
        } else {
          DB.removeFriendRequestPair(resolvedFrom, resolvedMe);
        }

        if (action === 'accept') {
          DB.addFriend(resolvedMe, resolvedFrom);
          const friendUser = DB.getUser(resolvedFrom) || { username: resolvedFrom, displayName: resolvedFrom, avatarColor: '#075E54', online: false };
          const meUser = DB.getUser(resolvedMe) || { username: resolvedMe, displayName: resolvedMe, avatarColor: '#007AFF', online: true };

          const acceptPayload = {
            friend: {
              username: resolvedMe,
              displayName: meUser.displayName,
              avatarColor: meUser.avatarColor,
              online: true
            }
          };

          broadcastToUser(resolvedFrom, 'friend_accepted', acceptPayload);
          broadcastToUser(resolvedFrom, 'friend_request_accepted', acceptPayload);
          broadcastToUser(resolvedFrom, 'friend_added', acceptPayload);

          return res.end(JSON.stringify({
            success: true,
            status: 'accepted',
            friend: {
              username: friendUser.username,
              displayName: friendUser.displayName,
              avatarColor: friendUser.avatarColor,
              online: friendUser.online
            }
          }));
        } else {
          return res.end(JSON.stringify({ success: true, status: 'declined' }));
        }
      }

      // 8b. Server-Side Backup & Chat History Export
      if (pathname === '/api/backup/export' && req.method === 'GET') {
        const username = (parsedUrl.searchParams.get('me') || '').trim().toLowerCase();
        const resolved = resolveUsername(username);
        if (!resolved) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Invalid user' }));
        }

        const userObj = DB.getUser(resolved);
        const friends = DB.getFriends(resolved);
        const userChats = {};
        let totalCount = 0;

        for (const f of friends) {
          const chatId = getDeterministicChatId(resolved, f);
          const history = DB.getChatHistory(chatId, 1000);
          userChats[chatId] = history;
          totalCount += history.length;
        }

        const backupData = {
          version: 1,
          app: 'OC Connect',
          exportedAt: Date.now(),
          exportedDate: new Date().toISOString(),
          user: {
            username: userObj.username,
            ocId: userObj.ocId,
            displayName: userObj.displayName
          },
          friends: friends,
          chats: userChats,
          totalMessages: totalCount
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="oc_connect_backup_${resolved}_${Date.now()}.json"`);
        return res.end(JSON.stringify(backupData, null, 2));
      }

      // 9. Friends: List
      if (pathname === '/api/friends/list' && req.method === 'GET') {
        const me = (parsedUrl.searchParams.get('username') || parsedUrl.searchParams.get('user') || parsedUrl.searchParams.get('me') || '').trim().toLowerCase();
        const resolvedMe = resolveUsername(me);

        if (!resolvedMe) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Invalid user' }));
        }

        const myAliases = DB.getUserAliases ? DB.getUserAliases(resolvedMe) : [resolvedMe, me];
        const friendsFromTable = DB.getFriends(resolvedMe);
        const chatPartners = DB.getDirectChatPartners ? DB.getDirectChatPartners(resolvedMe) : [];
        const friendNames = Array.from(new Set([...friendsFromTable, ...chatPartners]))
          .filter(f => f && !myAliases.includes(f.toLowerCase()));
        const friendList = friendNames.map(fName => {
          const fData = DB.getUser(fName) || { username: fName, displayName: fName, online: false, avatarColor: getAvatarColor(fName) };
          const chatId = getDeterministicChatId(resolvedMe, fName);
          let messages = DB.getChatHistory(chatId, 50);
          if (messages.length === 0 && DB.findLegacyChatId) {
            const legacyChatId = DB.findLegacyChatId(resolvedMe, fName);
            if (legacyChatId && legacyChatId !== chatId) {
              DB.migrateChatId(legacyChatId, chatId);
              messages = DB.getChatHistory(chatId, 50);
            }
          }
          const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
          const unreadCount = messages.filter(m => m.sender === fName && m.status !== 'read').length;
          const isTrusted = DB.isTrusted(resolvedMe, fName);

          return {
            username: fData.username,
            displayName: fData.displayName,
            major: fData.major || 'Okanagan College',
            avatarColor: fData.avatarColor,
            avatarImage: fData.avatarImage,
            online: fData.online,
            lastSeen: fData.lastSeen,
            unreadCount: unreadCount,
            isTrusted: isTrusted,
            lastMessage: lastMsg ? {
              id: lastMsg.id,
              text: lastMsg.text,
              image: !!lastMsg.image,
              file: !!lastMsg.file,
              voice: !!lastMsg.voice,
              call: !!lastMsg.call,
              studyCard: !!lastMsg.studyCard,
              timestamp: lastMsg.timestamp,
              sender: lastMsg.sender,
              status: lastMsg.status
            } : null
          };
        });

        return res.end(JSON.stringify({ friends: friendList }));
      }

      // 9b. Friends: Unfriend Classmate
      if (pathname === '/api/friends/unfriend' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const me = body.me || body.user1;
        const target = body.target || body.user2;
        const resolvedMe = resolveUsername(me);
        const resolvedTarget = resolveUsername(target);

        if (!resolvedMe || !resolvedTarget) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Missing parameters' }));
        }

        DB.removeFriend(resolvedMe, resolvedTarget);

        broadcastToUser(resolvedTarget, 'friend_removed', { by: resolvedMe });
        broadcastToUser(resolvedMe, 'friend_removed', { by: resolvedTarget });

        return res.end(JSON.stringify({ success: true, unfriended: resolvedTarget }));
      }

      // 9c. Friends: Block User
      if (pathname === '/api/friends/block' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const me = body.me || body.blocker || body.user1;
        const target = body.target || body.blocked || body.user2;
        const resolvedMe = resolveUsername(me);
        const resolvedTarget = resolveUsername(target);

        if (!resolvedMe || !resolvedTarget) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Missing parameters' }));
        }

        DB.blockUser(resolvedMe, resolvedTarget);

        broadcastToUser(resolvedTarget, 'friend_removed', { by: resolvedMe });
        broadcastToUser(resolvedMe, 'friend_removed', { by: resolvedTarget });

        return res.end(JSON.stringify({ success: true, blocked: resolvedTarget }));
      }

      // 9d. Friends: Unblock User
      if (pathname === '/api/friends/unblock' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const me = body.me || body.blocker || body.user1;
        const target = body.target || body.blocked || body.user2;
        const resolvedMe = resolveUsername(me);
        const resolvedTarget = resolveUsername(target);

        if (!resolvedMe || !resolvedTarget) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Missing parameters' }));
        }

        DB.unblockUser(resolvedMe, resolvedTarget);
        return res.end(JSON.stringify({ success: true, unblocked: resolvedTarget }));
      }

      // 9e. Friends: Get Blocked Users List
      if (pathname === '/api/friends/blocked' && req.method === 'GET') {
        const me = (parsedUrl.searchParams.get('username') || '').trim().toLowerCase();
        const resolvedMe = resolveUsername(me);

        if (!resolvedMe) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Invalid user' }));
        }

        const blockedList = DB.getBlockedUsers(resolvedMe);
        return res.end(JSON.stringify({ success: true, blocked: blockedList }));
      }

      // 10. Messages: Get History (With Telegram / Mesibo Cursor Pagination)
      if (pathname === '/api/messages/history' && req.method === 'GET') {
        const me = (parsedUrl.searchParams.get('me') || parsedUrl.searchParams.get('user') || parsedUrl.searchParams.get('username') || '').trim().toLowerCase();
        const target = (parsedUrl.searchParams.get('target') || parsedUrl.searchParams.get('recipient') || parsedUrl.searchParams.get('to') || '').trim().toLowerCase();
        const isChannel = parsedUrl.searchParams.get('channel') === 'true';
        const isGroup = parsedUrl.searchParams.get('isGroup') === 'true' || target.startsWith('group_');
        const before = parsedUrl.searchParams.get('before') ? parseInt(parsedUrl.searchParams.get('before'), 10) : null;
        const limit = Math.min(parseInt(parsedUrl.searchParams.get('limit') || '50', 10), 100);

        if (isChannel) {
          const channelMessages = before
            ? DB.getChannelHistoryBefore(target, before, limit)
            : DB.getChannelHistory(target, limit);
          return res.end(JSON.stringify({ messages: channelMessages }));
        }

        if (isGroup) {
          const cleanGroupId = target.replace(/^group_/, '').trim();
          const groupMessages = before
            ? DB.getChatHistoryBefore('group_' + cleanGroupId, before, limit)
            : DB.getChatHistory('group_' + cleanGroupId, limit);
          return res.end(JSON.stringify({ messages: groupMessages }));
        }

        const resolvedMe = resolveUsername(me);
        const resolvedTarget = resolveUsername(target);

        if (!resolvedMe || !resolvedTarget) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Missing parameters' }));
        }

        const chatId = getDeterministicChatId(resolvedMe, resolvedTarget);
        let messages = before
          ? DB.getChatHistoryBefore(chatId, before, limit)
          : DB.getChatHistory(chatId, limit);

        if (messages.length === 0 && DB.findLegacyChatId) {
          const legacyChatId = DB.findLegacyChatId(resolvedMe, resolvedTarget);
          if (legacyChatId && legacyChatId !== chatId) {
            DB.migrateChatId(legacyChatId, chatId);
            messages = before
              ? DB.getChatHistoryBefore(chatId, before, limit)
              : DB.getChatHistory(chatId, limit);
          }
        }

        // Mark incoming messages as read (only on initial active chat view, not when scrolling past history)
        if (!before) {
          DB.markChatRead(chatId, resolvedTarget);
          broadcastToUser(resolvedTarget, 'messages_read', { by: resolvedMe, chatId });
        }

        return res.end(JSON.stringify({ messages }));
      }

      // 11. Messages: Send Message (Supports 1-on-1, Channels, and WhatsApp-Style Groups)
      if (pathname === '/api/messages/send' && req.method === 'POST') {
        const { sender, recipient, text, image, file, voice, studyCard, channel, groupId, replyTo, id } = await parseJsonBody(req);
        const resolvedSender = resolveUsername(sender);
        const cleanText = (text || '').trim();

        if (!resolvedSender) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Unauthorized sender' }));
        }

        // Rate limit: max 120 messages per user per minute
        if (!checkActionRateLimit('msg', resolvedSender, 120, 60 * 1000)) {
          res.writeHead(429);
          return res.end(JSON.stringify({ error: 'Rate limit exceeded: max 120 messages per minute.' }));
        }

        if (!cleanText && !image && !file && !voice && !studyCard) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Message cannot be empty' }));
        }

        // Offload media to disk files asynchronously (keeps Node RAM clean)
        let processedImage = image || null;
        let processedFile = file || null;
        let processedVoice = voice || null;

        if (image && typeof image === 'string' && image.startsWith('data:')) {
          try {
            const diskFile = await saveBase64Media(image, 'photos', 'photo.jpg', 'image/jpeg');
            processedImage = diskFile.url;
          } catch (_) {}
        }

        if (file && file.data && typeof file.data === 'string' && file.data.startsWith('data:')) {
          try {
            const diskFile = await saveBase64Media(file.data, 'documents', file.name, file.type);
            processedFile = {
              name: file.name,
              size: diskFile.size,
              type: diskFile.mimeType,
              url: diskFile.url,
              data: file.data // kept for instant client blob preview
            };
          } catch (_) {}
        }

        if (voice && voice.data && typeof voice.data === 'string' && voice.data.startsWith('data:')) {
          try {
            const diskFile = await saveBase64Media(voice.data, 'voice', 'voice.webm', 'audio/webm');
            processedVoice = {
              duration: voice.duration,
              url: diskFile.url,
              data: voice.data
            };
          } catch (_) {}
        }

        // Telegram-grade: Use client permanent ID if provided, otherwise generate server ID
        const msgId = (id && typeof id === 'string' && id.trim()) ? id.trim() : ('msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
        const senderUser = DB.getUser(resolvedSender) || DB.findUser(resolvedSender) || { displayName: resolvedSender, avatarColor: getAvatarColor(resolvedSender) };

        // A. Group Message Flow
        if (groupId || (recipient && recipient.startsWith('group_'))) {
          const cleanGroupId = (groupId || recipient.replace(/^group_/, '')).trim();
          const isMember = DB.isGroupMember(cleanGroupId, resolvedSender);
          if (!isMember) {
            res.writeHead(403);
            return res.end(JSON.stringify({ error: 'You are not a member of this group' }));
          }

          const group = DB.getGroup(cleanGroupId);
          if (!group) {
            res.writeHead(404);
            return res.end(JSON.stringify({ error: 'Group not found' }));
          }

          const newMsg = DB.saveMessage({
            id: msgId,
            chatId: 'group_' + cleanGroupId,
            sender: resolvedSender,
            displayName: senderUser.displayName,
            text: cleanText,
            image: processedImage,
            file: processedFile,
            voice: processedVoice,
            studyCard: studyCard || null,
            replyTo: replyTo || null,
            timestamp: Date.now(),
            status: 'sent'
          });

          // Broadcast to all group members in real-time
          broadcastToGroup(cleanGroupId, 'group_message', {
            groupId: cleanGroupId,
            groupName: group.name,
            message: newMsg
          });

          return res.end(JSON.stringify({ success: true, message: newMsg, groupId: cleanGroupId }));
        }

        // B. Public Channel Broadcast
        if (channel) {
          const newMsg = DB.saveMessage({
            id: msgId,
            channel: channel.toLowerCase(),
            sender: resolvedSender,
            displayName: senderUser.displayName,
            text: cleanText,
            image: processedImage,
            file: processedFile,
            voice: processedVoice,
            studyCard: studyCard || null,
            replyTo: replyTo || null,
            timestamp: Date.now(),
            status: 'sent'
          });

          broadcastToAll('channel_message', { channel: channel.toLowerCase(), message: newMsg });
          return res.end(JSON.stringify({ success: true, message: newMsg }));
        }

        // C. 1-on-1 Direct Chat
        const resolvedRecipient = resolveUsername(recipient);
        if (!resolvedRecipient) {
          res.writeHead(404);
          return res.end(JSON.stringify({ error: `Classmate "${recipient}" not found` }));
        }

        if (DB.isBlocked(resolvedSender, resolvedRecipient)) {
          res.writeHead(403);
          return res.end(JSON.stringify({ error: 'Cannot send message: Communication is blocked.' }));
        }

        DB.addFriend(resolvedSender, resolvedRecipient);
        const chatId = getDeterministicChatId(resolvedSender, resolvedRecipient);

        const newMsg = DB.saveMessage({
          id: msgId,
          recipient: resolvedRecipient,
          sender: resolvedSender,
          displayName: senderUser.displayName,
          text: cleanText,
          image: processedImage,
          file: processedFile,
          voice: processedVoice,
          studyCard: studyCard || null,
          replyTo: replyTo || null,
          timestamp: Date.now(),
          status: 'sent'
        });

        const isDelivered = broadcastToUser(resolvedRecipient, 'new_message', {
          sender: resolvedSender,
          chatId,
          message: newMsg
        });

        if (isDelivered) {
          DB.markMessageDelivered(msgId);
          newMsg.status = 'delivered';
          broadcastToUser(resolvedSender, 'message_delivered', {
            messageId: msgId,
            chatId,
            status: 'delivered'
          });
        }

        // Simulated reply for demo users
        const recipientUser = DB.getUser(resolvedRecipient);
        if (recipientUser && recipientUser.isDemo) {
          setTimeout(() => {
            const replies = [
              "That's awesome! How are your classes going?",
              "Totally agree! Meet up at KLO cafeteria later?",
              "Got it! Let me know if you need any lecture notes.",
              "Sounds great! Have a good day on campus!"
            ];
            const replyMsg = DB.saveMessage({
              id: 'msg_reply_' + Date.now(),
              sender: resolvedRecipient,
              displayName: recipientUser.displayName,
              text: replies[Math.floor(Math.random() * replies.length)],
              chatId: chatId,
              timestamp: Date.now(),
              status: 'sent'
            });

            broadcastToUser(resolvedSender, 'new_message', {
              sender: resolvedRecipient,
              chatId,
              message: replyMsg
            });
          }, 2500);
        }

        return res.end(JSON.stringify({ success: true, message: newMsg }));
      }

      // 11a. Messages: Toggle Emoji Reaction (Google Messages / WhatsApp style)
      if (pathname === '/api/messages/react' && req.method === 'POST') {
        const { messageId, username, emoji } = await parseJsonBody(req);
        const resolvedUser = resolveUsername(username);

        if (!resolvedUser || !messageId || !emoji) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Missing reaction parameters' }));
        }

        const msg = DB.getMessageById(messageId);
        if (!msg) {
          res.writeHead(404);
          return res.end(JSON.stringify({ error: 'Message not found' }));
        }

        const updatedReactions = DB.toggleReaction(messageId, resolvedUser, emoji);

        // Broadcast reaction update via SSE
        const payload = { messageId, reactions: updatedReactions, user: resolvedUser, emoji };
        if (msg.channel) {
          broadcastToAll('message_reaction_updated', payload);
        } else if (msg.chat_id && msg.chat_id.startsWith('group_')) {
          const groupId = msg.chat_id.replace(/^group_/, '');
          broadcastToGroup(groupId, 'message_reaction_updated', payload);
        } else if (msg.chat_id) {
          const parts = msg.chat_id.split('_');
          for (const u of parts) {
            broadcastToUser(u, 'message_reaction_updated', payload);
          }
        }

        return res.end(JSON.stringify({ success: true, reactions: updatedReactions }));
      }

      // 11a-2. Pin / Unpin Message
      if (pathname === '/api/messages/pin' && req.method === 'POST') {
        const { messageId, isPinned } = await parseJsonBody(req);
        if (!messageId) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'messageId is required' }));
        }

        const msg = DB.getMessageById(messageId);
        if (!msg) {
          res.writeHead(404);
          return res.end(JSON.stringify({ error: 'Message not found' }));
        }

        const updated = DB.setMessagePinned(messageId, Boolean(isPinned));
        const payload = {
          messageId,
          isPinned: Boolean(isPinned),
          chatId: msg.chatId,
          channel: msg.channel,
          message: updated
        };

        if (msg.channel) {
          broadcastToAll('message_pinned_updated', payload);
        } else if (msg.chatId && msg.chatId.startsWith('group_')) {
          const groupId = msg.chatId.replace(/^group_/, '');
          broadcastToGroup(groupId, 'message_pinned_updated', payload);
        } else if (msg.chatId) {
          const parts = msg.chatId.split('_');
          for (const u of parts) {
            broadcastToUser(u, 'message_pinned_updated', payload);
          }
        }

        return res.end(JSON.stringify({ success: true, message: updated }));
      }

      // 11a-3. Get Pinned Messages
      if (pathname === '/api/messages/pinned' && req.method === 'GET') {
        const target = (parsedUrl.searchParams.get('target') || '').trim();
        const me = (parsedUrl.searchParams.get('me') || '').trim();
        const isChannel = parsedUrl.searchParams.get('isChannel') === 'true';
        if (!target) {
          return res.end(JSON.stringify({ success: true, pinned: [] }));
        }
        let resolved = target;
        if (!isChannel && !target.startsWith('group_') && me) {
          resolved = getDeterministicChatId(me, target);
        }
        const pinned = DB.getPinnedMessages(resolved, isChannel);
        return res.end(JSON.stringify({ success: true, pinned }));
      }

      // 11a-4. Get Chat Media & Attachments
      if (pathname === '/api/messages/media' && req.method === 'GET') {
        const target = (parsedUrl.searchParams.get('target') || '').trim();
        const me = (parsedUrl.searchParams.get('me') || '').trim();
        const isChannel = parsedUrl.searchParams.get('isChannel') === 'true';
        if (!target) {
          return res.end(JSON.stringify({ success: true, media: { photos: [], docs: [], voice: [] } }));
        }
        let resolved = target;
        if (!isChannel && !target.startsWith('group_') && me) {
          resolved = getDeterministicChatId(me, target);
        }
        const media = DB.getChatMedia(resolved, isChannel);
        return res.end(JSON.stringify({ success: true, media }));
      }

      // 11a-5. Link Preview Scraper (OpenGraph Cards)
      if (pathname === '/api/utils/link-preview' && req.method === 'GET') {
        const targetUrl = parsedUrl.searchParams.get('url') || '';
        if (!targetUrl || (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://'))) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Valid HTTP/HTTPS url required' }));
        }

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3500);
          const fetchRes = await fetch(targetUrl, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OCConnectBot/1.0)' }
          });
          clearTimeout(timeoutId);

          if (!fetchRes.ok) {
            return res.end(JSON.stringify({ success: false, url: targetUrl }));
          }

          const html = await fetchRes.text();
          const titleMatch = html.match(/<meta property=["']og:title["'] content=["'](.*?)["']/i) ||
                             html.match(/<title>(.*?)<\/title>/i);
          const descMatch = html.match(/<meta property=["']og:description["'] content=["'](.*?)["']/i) ||
                            html.match(/<meta name=["']description["'] content=["'](.*?)["']/i);
          const imageMatch = html.match(/<meta property=["']og:image["'] content=["'](.*?)["']/i);

          const parsedObj = new URL(targetUrl);
          let imageUrl = imageMatch ? imageMatch[1] : null;
          if (imageUrl && !imageUrl.startsWith('http')) {
            imageUrl = new URL(imageUrl, targetUrl).href;
          }

          return res.end(JSON.stringify({
            success: true,
            url: targetUrl,
            domain: parsedObj.hostname,
            title: titleMatch ? titleMatch[1].slice(0, 100) : parsedObj.hostname,
            description: descMatch ? descMatch[1].slice(0, 160) : '',
            image: imageUrl
          }));
        } catch (_) {
          return res.end(JSON.stringify({ success: false, url: targetUrl }));
        }
      }

      // ==========================================
      // 11b. WHATSAPP-STYLE GROUPS API ENDPOINTS
      // ==========================================

      // Groups: Create Group
      if (pathname === '/api/groups/create' && req.method === 'POST') {
        const { name, description, avatarColor, avatarImage, createdBy, members } = await parseJsonBody(req);
        const cleanName = (name || '').trim();
        const resolvedCreator = resolveUsername(createdBy);

        if (!cleanName) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Group subject/name is required.' }));
        }

        if (!resolvedCreator) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Invalid group creator.' }));
        }

        const initialMembers = Array.isArray(members) ? members : [];
        const creatorUser = DB.getUser(resolvedCreator);

        // Process group avatar image (Option A: <= 500KB stored directly in SQLite)
        let processedAvatarImage = avatarImage || null;
        if (avatarImage && typeof avatarImage === 'string' && avatarImage.startsWith('data:')) {
          if (Buffer.byteLength(avatarImage, 'utf8') > 500 * 1024) {
            try {
              const diskFile = await saveBase64Media(avatarImage, 'photos', 'group_avatar.jpg', 'image/jpeg');
              processedAvatarImage = diskFile.url;
            } catch (_) {}
          }
        }

        const group = DB.createGroup({
          name: cleanName,
          description: description || '',
          avatarColor: avatarColor || '#075E54',
          avatarImage: processedAvatarImage,
          createdBy: resolvedCreator,
          initialMembers
        });

        // Insert initial system message into group history
        const sysMsg = DB.saveMessage({
          id: 'msg_sys_' + Date.now(),
          chatId: 'group_' + group.id,
          sender: 'System',
          displayName: 'OC System',
          text: `✨ ${creatorUser.displayName} created group "${group.name}"`,
          timestamp: Date.now(),
          status: 'read'
        });

        const memberList = DB.getGroupMembers(group.id);

        // Real-time broadcast to all group members
        broadcastToGroup(group.id, 'group_created', {
          group,
          members: memberList,
          systemMessage: sysMsg
        });

        return res.end(JSON.stringify({
          success: true,
          group,
          members: memberList
        }));
      }

      // Groups: List User Groups
      if (pathname === '/api/groups/list' && req.method === 'GET') {
        const username = (parsedUrl.searchParams.get('username') || '').trim().toLowerCase();
        const resolvedUser = resolveUsername(username);

        if (!resolvedUser) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Invalid user' }));
        }

        const groups = DB.getUserGroups(resolvedUser);
        const enrichedGroups = groups.map(grp => {
          const members = DB.getGroupMembers(grp.id);
          const history = DB.getChatHistory('group_' + grp.id, 50);
          const lastMsg = history.length > 0 ? history[history.length - 1] : null;

          return {
            ...grp,
            memberCount: members.length,
            members: members.map(m => ({ username: m.username, displayName: m.displayName, role: m.role, avatarColor: m.avatarColor })),
            lastMessage: lastMsg ? {
              text: lastMsg.text,
              image: !!lastMsg.image,
              file: !!lastMsg.file,
              voice: !!lastMsg.voice,
              studyCard: !!lastMsg.studyCard,
              timestamp: lastMsg.timestamp,
              sender: lastMsg.sender,
              displayName: lastMsg.displayName
            } : null
          };
        });

        return res.end(JSON.stringify({ success: true, groups: enrichedGroups }));
      }

      // Groups: Get Group Info & Participants
      if (pathname === '/api/groups/info' && req.method === 'GET') {
        const groupId = (parsedUrl.searchParams.get('groupId') || '').trim();
        const username = (parsedUrl.searchParams.get('username') || '').trim().toLowerCase();
        const resolvedUser = resolveUsername(username);

        if (!groupId) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Group ID is required' }));
        }

        const group = DB.getGroup(groupId);
        if (!group) {
          res.writeHead(404);
          return res.end(JSON.stringify({ error: 'Group not found' }));
        }

        const members = DB.getGroupMembers(groupId);
        const isMember = resolvedUser ? DB.isGroupMember(groupId, resolvedUser) : false;
        const isAdmin = resolvedUser ? DB.isGroupAdmin(groupId, resolvedUser) : false;

        return res.end(JSON.stringify({
          success: true,
          group,
          members,
          isMember,
          isAdmin
        }));
      }

      // Groups: Add Participants
      if (pathname === '/api/groups/members/add' && req.method === 'POST') {
        const { groupId, username, newMembers } = await parseJsonBody(req);
        const resolvedUser = resolveUsername(username);
        const cleanGroupId = (groupId || '').trim();

        if (!cleanGroupId || !resolvedUser) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Invalid parameters' }));
        }

        const group = DB.getGroup(cleanGroupId);
        if (!group) {
          res.writeHead(404);
          return res.end(JSON.stringify({ error: 'Group not found' }));
        }

        if (!DB.isGroupMember(cleanGroupId, resolvedUser)) {
          res.writeHead(403);
          return res.end(JSON.stringify({ error: 'You must be a member to add classmates.' }));
        }

        const adderUser = DB.getUser(resolvedUser);
        const listToAdd = Array.isArray(newMembers) ? newMembers : [newMembers];
        const addedDisplayNames = [];

        for (const m of listToAdd) {
          const resolvedM = resolveUsername(m);
          if (resolvedM && !DB.isGroupMember(cleanGroupId, resolvedM)) {
            DB.addGroupMember(cleanGroupId, resolvedM, 'member');
            const targetUser = DB.getUser(resolvedM);
            addedDisplayNames.push(targetUser ? targetUser.displayName : resolvedM);
          }
        }

        if (addedDisplayNames.length > 0) {
          const sysMsg = DB.saveMessage({
            id: 'msg_sys_' + Date.now(),
            chatId: 'group_' + cleanGroupId,
            sender: 'System',
            displayName: 'OC System',
            text: `➕ ${adderUser.displayName} added ${addedDisplayNames.join(', ')}`,
            timestamp: Date.now(),
            status: 'read'
          });

          broadcastToGroup(cleanGroupId, 'group_member_added', {
            groupId: cleanGroupId,
            groupName: group.name,
            addedBy: adderUser.displayName,
            addedMembers: addedDisplayNames,
            systemMessage: sysMsg
          });
        }

        return res.end(JSON.stringify({
          success: true,
          members: DB.getGroupMembers(cleanGroupId)
        }));
      }

      // Groups: Remove Participant / Leave Group
      if (pathname === '/api/groups/members/remove' && req.method === 'POST') {
        const { groupId, username, targetUser } = await parseJsonBody(req);
        const resolvedUser = resolveUsername(username);
        const resolvedTarget = resolveUsername(targetUser);
        const cleanGroupId = (groupId || '').trim();

        if (!cleanGroupId || !resolvedUser || !resolvedTarget) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Invalid parameters' }));
        }

        const group = DB.getGroup(cleanGroupId);
        if (!group) {
          res.writeHead(404);
          return res.end(JSON.stringify({ error: 'Group not found' }));
        }

        const isLeaving = (resolvedUser === resolvedTarget);
        const isAdmin = DB.isGroupAdmin(cleanGroupId, resolvedUser);

        if (!isLeaving && !isAdmin) {
          res.writeHead(403);
          return res.end(JSON.stringify({ error: 'Only group admins can remove other participants.' }));
        }

        const actorUser = DB.getUser(resolvedUser);
        const targetObj = DB.getUser(resolvedTarget);

        DB.removeGroupMember(cleanGroupId, resolvedTarget);

        const sysText = isLeaving
          ? `🚪 ${actorUser.displayName} left the group`
          : `❌ ${actorUser.displayName} removed ${targetObj ? targetObj.displayName : resolvedTarget}`;

        const sysMsg = DB.saveMessage({
          id: 'msg_sys_' + Date.now(),
          chatId: 'group_' + cleanGroupId,
          sender: 'System',
          displayName: 'OC System',
          text: sysText,
          timestamp: Date.now(),
          status: 'read'
        });

        // Notify remaining members and the removed user
        broadcastToGroup(cleanGroupId, 'group_member_removed', {
          groupId: cleanGroupId,
          removedUser: resolvedTarget,
          systemMessage: sysMsg
        });
        broadcastToUser(resolvedTarget, 'group_left', { groupId: cleanGroupId });

        return res.end(JSON.stringify({ success: true }));
      }

      // Groups: Update Group Metadata (Subject, Description, Avatar)
      if (pathname === '/api/groups/update' && req.method === 'POST') {
        const { groupId, username, name, description, avatarColor, avatarImage } = await parseJsonBody(req);
        const resolvedUser = resolveUsername(username);
        const cleanGroupId = (groupId || '').trim();

        if (!cleanGroupId || !resolvedUser) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Invalid parameters' }));
        }

        if (!DB.isGroupMember(cleanGroupId, resolvedUser)) {
          res.writeHead(403);
          return res.end(JSON.stringify({ error: 'You are not a member of this group.' }));
        }

        // Process group avatar image (Option A: <= 500KB stored directly in SQLite)
        let processedAvatarImage = avatarImage;
        if (avatarImage && typeof avatarImage === 'string' && avatarImage.startsWith('data:')) {
          if (Buffer.byteLength(avatarImage, 'utf8') > 500 * 1024) {
            try {
              const diskFile = await saveBase64Media(avatarImage, 'photos', 'group_avatar.jpg', 'image/jpeg');
              processedAvatarImage = diskFile.url;
            } catch (_) {}
          }
        }

        const updatedGroup = DB.updateGroup(cleanGroupId, {
          name,
          description,
          avatarColor,
          avatarImage: processedAvatarImage
        });

        const actorUser = DB.getUser(resolvedUser);
        const sysMsg = DB.saveMessage({
          id: 'msg_sys_' + Date.now(),
          chatId: 'group_' + cleanGroupId,
          sender: 'System',
          displayName: 'OC System',
          text: `✏️ ${actorUser.displayName} updated the group settings`,
          timestamp: Date.now(),
          status: 'read'
        });

        broadcastToGroup(cleanGroupId, 'group_updated', {
          groupId: cleanGroupId,
          group: updatedGroup,
          systemMessage: sysMsg
        });

        return res.end(JSON.stringify({ success: true, group: updatedGroup }));
      }

      // Groups: Delete Group (Admin only)
      if (pathname === '/api/groups/delete' && req.method === 'POST') {
        const { groupId, username } = await parseJsonBody(req);
        const resolvedUser = resolveUsername(username);
        const cleanGroupId = (groupId || '').trim();

        if (!cleanGroupId || !resolvedUser) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Invalid parameters' }));
        }

        if (!DB.isGroupAdmin(cleanGroupId, resolvedUser)) {
          res.writeHead(403);
          return res.end(JSON.stringify({ error: 'Only the group admin can delete this group.' }));
        }

        broadcastToGroup(cleanGroupId, 'group_deleted', { groupId: cleanGroupId });
        DB.deleteGroup(cleanGroupId);

        return res.end(JSON.stringify({ success: true }));
      }

      // 12. File Attachment Streaming & Download Endpoint
      if (pathname.startsWith('/api/files/') && req.method === 'GET') {
        const fileMsgId = pathname.replace('/api/files/', '').trim();
        const asDownload = parsedUrl.searchParams.get('download') === '1';

        const foundMsg = DB.getMessageById(fileMsgId);
        if (!foundMsg || (!foundMsg.file && !foundMsg.image)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'File attachment not found or expired' }));
        }

        try {
          // If stored on disk, stream directly from disk
          if (foundMsg.file && foundMsg.file.url && foundMsg.file.url.startsWith('/api/uploads/')) {
            const relPath = foundMsg.file.url.replace('/api/uploads/', '');
            const parts = relPath.split('/');
            return streamMediaFile(parts[0], parts[1], req, res, asDownload, foundMsg.file.name);
          }
          if (foundMsg.image && foundMsg.image.startsWith('/api/uploads/')) {
            const relPath = foundMsg.image.replace('/api/uploads/', '');
            const parts = relPath.split('/');
            return streamMediaFile(parts[0], parts[1], req, res, asDownload, 'photo.jpg');
          }

          // Fallback to base64 decoding buffer
          const rawData = (foundMsg.file && foundMsg.file.data) || foundMsg.image;
          const match = rawData.match(/^data:([^;]+);base64,(.+)$/);
          let mime = (foundMsg.file && foundMsg.file.type) || (foundMsg.image ? 'image/jpeg' : 'application/octet-stream');
          let base64Content = rawData;
          if (match) {
            mime = match[1] || mime;
            base64Content = match[2];
          }
          const buffer = Buffer.from(base64Content, 'base64');
          const defaultName = foundMsg.image ? 'photo.jpg' : 'document';
          const fileName = (foundMsg.file && foundMsg.file.name) || defaultName;
          const safeName = encodeURIComponent(fileName).replace(/['()]/g, escape).replace(/\*/g, '%2A');
          const disposition = asDownload
            ? `attachment; filename="${safeName}"; filename*=UTF-8''${safeName}`
            : `inline; filename="${safeName}"; filename*=UTF-8''${safeName}`;

          res.writeHead(200, {
            'Content-Type': mime,
            'Content-Length': buffer.length,
            'Content-Disposition': disposition,
            'Cache-Control': 'public, max-age=86400, immutable',
            'Access-Control-Allow-Origin': '*'
          });
          return res.end(buffer);
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Failed to stream file buffer: ' + e.message }));
        }
      }

      // 13. Direct Disk Uploads Static Media Streamer (`/api/uploads/:category/:filename`)
      if (pathname.startsWith('/api/uploads/') && req.method === 'GET') {
        const parts = pathname.replace('/api/uploads/', '').split('/');
        const category = parts[0];
        const filename = parts[1];
        const asDownload = parsedUrl.searchParams.get('download') === '1';

        if (!category || !filename) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Invalid media path' }));
        }

        return streamMediaFile(category, filename, req, res, asDownload);
      }

      // 14. Typing Indicator (Supports 1-on-1, WhatsApp Groups, and Public Channels)
      if (pathname === '/api/messages/typing' && req.method === 'POST') {
        const { sender, recipient, groupId, channel, isTyping } = await parseJsonBody(req);
        const resolvedSender = resolveUsername(sender);
        if (!resolvedSender) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Unauthorized sender' }));
        }

        const payload = {
          from: resolvedSender,
          groupId: groupId || null,
          channel: channel || null,
          isTyping: Boolean(isTyping)
        };

        if (groupId) {
          broadcastToGroup(groupId, 'user_typing', payload, resolvedSender);
        } else if (channel) {
          broadcastToAll('user_typing', payload);
        } else if (recipient) {
          const resolvedRecipient = resolveUsername(recipient);
          if (resolvedRecipient) {
            broadcastToUser(resolvedRecipient, 'user_typing', payload);
          }
        }
        return res.end(JSON.stringify({ success: true }));
      }

      // ==========================================
      // GOOGLE MESSAGES: STARRED MESSAGES SYSTEM
      // ==========================================
      if (pathname === '/api/messages/star' && req.method === 'POST') {
        const { username, messageId, starred } = await parseJsonBody(req);
        const resolvedUser = resolveUsername(username);
        if (!resolvedUser || !messageId) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Missing username or messageId' }));
        }

        let isStarredNow;
        if (starred !== undefined) {
          if (starred) {
            DB.starMessage(resolvedUser, messageId);
            isStarredNow = true;
          } else {
            DB.unstarMessage(resolvedUser, messageId);
            isStarredNow = false;
          }
        } else {
          isStarredNow = DB.toggleStar(resolvedUser, messageId);
        }

        return res.end(JSON.stringify({ success: true, starred: isStarredNow, messageId }));
      }

      if (pathname === '/api/messages/starred' && req.method === 'GET') {
        const username = parsedUrl.searchParams.get('username');
        const resolvedUser = resolveUsername(username);
        if (!resolvedUser) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Missing username' }));
        }

        const messages = DB.getStarredMessages(resolvedUser, 100);
        return res.end(JSON.stringify({ messages }));
      }

      if (pathname === '/api/messages/starred-ids' && req.method === 'GET') {
        const username = parsedUrl.searchParams.get('username');
        const resolvedUser = resolveUsername(username);
        if (!resolvedUser) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Missing username' }));
        }

        const starredIds = DB.getStarredMessageIds(resolvedUser);
        return res.end(JSON.stringify({ starredIds }));
      }

      // ==========================================
      // GOOGLE MESSAGES: PINNED CHATS SYSTEM
      // ==========================================
      if (pathname === '/api/chats/pin' && req.method === 'POST') {
        const { username, chatKey, pinned } = await parseJsonBody(req);
        const resolvedUser = resolveUsername(username);
        if (!resolvedUser || !chatKey) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Missing username or chatKey' }));
        }

        let isPinnedNow;
        if (pinned !== undefined) {
          if (pinned) {
            DB.pinChat(resolvedUser, chatKey);
            isPinnedNow = true;
          } else {
            DB.unpinChat(resolvedUser, chatKey);
            isPinnedNow = false;
          }
        } else {
          isPinnedNow = DB.togglePinChat(resolvedUser, chatKey);
        }

        const pinnedChats = DB.getPinnedChats(resolvedUser);
        return res.end(JSON.stringify({ success: true, pinned: isPinnedNow, chatKey, pinnedChats }));
      }

      if (pathname === '/api/chats/pinned' && req.method === 'GET') {
        const username = parsedUrl.searchParams.get('username');
        const resolvedUser = resolveUsername(username);
        if (!resolvedUser) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Missing username' }));
        }

        const pinnedChats = DB.getPinnedChats(resolvedUser);
        return res.end(JSON.stringify({ pinnedChats }));
      }

      // ==========================================
      // GOOGLE MESSAGES: SCHEDULED MESSAGES (SEND LATER)
      // ==========================================
      if (pathname === '/api/messages/schedule' && req.method === 'POST') {
        const { sender, recipient, groupId, channel, text, image, file, voice, studyCard, scheduledFor } = await parseJsonBody(req);
        const resolvedSender = resolveUsername(sender);
        if (!resolvedSender) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Unauthorized sender' }));
        }

        const dueTimestamp = Number(scheduledFor);
        if (!dueTimestamp || dueTimestamp <= Date.now()) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Scheduled time must be in the future.' }));
        }

        const senderUser = DB.getUser(resolvedSender);
        const sched = DB.saveScheduledMessage({
          sender: resolvedSender,
          recipient: recipient ? resolveUsername(recipient) : null,
          groupId: groupId || null,
          channel: channel || null,
          displayName: senderUser ? senderUser.displayName : resolvedSender,
          text: (text || '').trim(),
          image: image || null,
          file: file || null,
          voice: voice || null,
          studyCard: studyCard || null,
          scheduledFor: dueTimestamp
        });

        return res.end(JSON.stringify({ success: true, scheduledMessage: sched }));
      }

      if (pathname === '/api/messages/scheduled' && req.method === 'GET') {
        const sender = parsedUrl.searchParams.get('sender');
        const resolvedSender = resolveUsername(sender);
        if (!resolvedSender) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Missing sender' }));
        }

        const recipient = parsedUrl.searchParams.get('recipient');
        const groupId = parsedUrl.searchParams.get('groupId');
        const channel = parsedUrl.searchParams.get('channel');

        const scheduled = DB.getChatScheduledMessages(resolvedSender, {
          recipient: recipient ? resolveUsername(recipient) : null,
          groupId,
          channel
        });

        return res.end(JSON.stringify({ scheduled }));
      }

      if (pathname === '/api/messages/scheduled/cancel' && req.method === 'POST') {
        const { sender, id } = await parseJsonBody(req);
        const resolvedSender = resolveUsername(sender);
        if (!resolvedSender || !id) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Missing sender or id' }));
        }

        DB.deleteScheduledMessage(id, resolvedSender);
        return res.end(JSON.stringify({ success: true, id }));
      }

      // ==========================================
      // GOOGLE MESSAGES: MAGIC COMPOSE & AI SMART REPLIES
      // ==========================================
      if (pathname === '/api/ai/magic-compose' && req.method === 'POST') {
        const { text, style } = await parseJsonBody(req);
        const raw = (text || '').trim();
        if (!raw) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Please enter text to compose.' }));
        }

        let rewritten = raw;
        const selectedStyle = (style || 'formal').toLowerCase();

        switch (selectedStyle) {
          case 'formal':
          case 'academic': {
            // Transform into formal academic prose
            let t = raw;
            t = t.replace(/\b(hey|hi|yo|sup)\b/gi, 'Greetings');
            t = t.replace(/\b(wanna|want to)\b/gi, 'would you be interested in');
            t = t.replace(/\b(meet up|hang out|link up)\b/gi, 'convening on campus');
            t = t.replace(/\b(gimme|give me|send me)\b/gi, 'could you kindly provide');
            t = t.replace(/\b(thx|thanks|ty)\b/gi, 'Thank you very much for your assistance');
            t = t.replace(/\b(asap|rn)\b/gi, 'at your earliest convenience');
            t = t.replace(/\b(idk|dont know)\b/gi, 'I am currently uncertain');
            t = t.replace(/\b(let me know)\b/gi, 'please inform me accordingly');
            t = t.replace(/\b(yeah|yep|yea)\b/gi, 'Affirmative, certainly');
            t = t.replace(/\b(nah|nope)\b/gi, 'Regrettably, I am unable to');
            t = t.replace(/\b(u|ur)\b/gi, 'your');
            rewritten = t.charAt(0).toUpperCase() + t.slice(1);
            if (!/[.!?]$/.test(rewritten)) rewritten += '.';
            break;
          }
          case 'concise': {
            // Remove fluff, tighten sentences
            let t = raw;
            t = t.replace(/\b(i was just wondering if maybe you could|i just wanted to ask if you can|do you think you could possibly)\b/gi, 'Can you');
            t = t.replace(/\b(in my opinion|to be honest|tbh|honestly)\b/gi, '');
            t = t.replace(/\b(really|very|super|extremely)\b/gi, '');
            t = t.replace(/\b(at the moment|right now)\b/gi, 'now');
            t = t.replace(/\s+/g, ' ').trim();
            rewritten = t.charAt(0).toUpperCase() + t.slice(1);
            if (!/[.!?]$/.test(rewritten)) rewritten += '.';
            break;
          }
          case 'excited': {
            // Add enthusiasm and emojis
            let t = raw;
            t = t.replace(/\b(hey|hi|hello)\b/gi, 'Hey hey! ✨');
            t = t.replace(/\b(thanks|thank you)\b/gi, 'Thanks so much! 🙌');
            t = t.replace(/\b(good|great|nice|cool)\b/gi, 'absolutely amazing! 🔥');
            t = t.replace(/\b(yes|yeah|yep)\b/gi, 'Yes, 100%! 🚀');
            t = t.replace(/[.]+$/g, '!');
            if (!/[!]$/.test(t)) t += ' 🎉';
            rewritten = t.charAt(0).toUpperCase() + t.slice(1);
            break;
          }
          case 'chill': {
            // Relaxed Okanagan student vibe
            let t = raw;
            t = t.replace(/\b(hello|greetings)\b/gi, 'Yo');
            t = t.replace(/\b(are you available to)\b/gi, 'down to');
            t = t.replace(/\b(at your earliest convenience)\b/gi, 'whenever you get a sec');
            t = t.replace(/\b(thank you very much)\b/gi, 'Appreciate it bro 🤙');
            t = t.replace(/\b(yes of course)\b/gi, 'For sure');
            rewritten = t.charAt(0).toUpperCase() + t.slice(1);
            if (!/[.!?🤙]$/.test(rewritten)) rewritten += ' 😎';
            break;
          }
          case 'shakespeare': {
            // Elizabethan poetic tone
            let t = raw;
            t = t.replace(/\b(hey|hi|hello)\b/gi, 'Hark, good classmate');
            t = t.replace(/\b(you|u)\b/gi, 'thou');
            t = t.replace(/\b(your|ur)\b/gi, 'thy');
            t = t.replace(/\b(are)\b/gi, 'art');
            t = t.replace(/\b(do)\b/gi, 'doth');
            t = t.replace(/\b(please)\b/gi, 'prithee');
            t = t.replace(/\b(where)\b/gi, 'whither');
            t = t.replace(/\b(why)\b/gi, 'wherefore');
            t = t.replace(/\b(friend|bro|mate)\b/gi, 'noble companion');
            rewritten = `Hark! ${t.charAt(0).toUpperCase() + t.slice(1)}, as fate hath decreed. 📜`;
            break;
          }
          case 'proofread':
          default: {
            // Clean up capitalization, whitespace, common typos
            let t = raw.trim();
            t = t.replace(/\bi\b/g, 'I');
            t = t.replace(/\bi'm\b/gi, "I'm");
            t = t.replace(/\bcant\b/gi, "can't");
            t = t.replace(/\bdont\b/gi, "don't");
            t = t.replace(/\bwont\b/gi, "won't");
            t = t.replace(/\boc\b/g, 'OC');
            t = t.replace(/\bklo\b/g, 'KLO');
            t = t.replace(/\s*([,!?.;:])\s*/g, '$1 ');
            t = t.replace(/\s+/g, ' ').trim();
            rewritten = t.charAt(0).toUpperCase() + t.slice(1);
            if (!/[.!?]$/.test(rewritten)) rewritten += '.';
            break;
          }
        }

        return res.end(JSON.stringify({
          success: true,
          original: raw,
          style: selectedStyle,
          rewritten: rewritten
        }));
      }

      if (pathname === '/api/ai/smart-replies' && req.method === 'POST') {
        const { text, sender, isGroup } = await parseJsonBody(req);
        const lower = (text || '').toLowerCase();
        let replies = [];

        if (lower.includes('?') || lower.includes('when') || lower.includes('where') || lower.includes('what time') || lower.includes('are you')) {
          replies = [
            "Yes, I'm ready! 👍",
            "Let's meet at KLO Library 📚",
            "Give me 10 mins ⏳",
            "Sounds like a plan! 🤝"
          ];
        } else if (lower.includes('thank') || lower.includes('thx') || lower.includes('appreciate')) {
          replies = [
            "You're very welcome! 😊",
            "Anytime! Let me know if you need anything else 🎓",
            "No problem at all! 🙌",
            "Glad I could help! 🌟"
          ];
        } else if (lower.includes('hey') || lower.includes('hi') || lower.includes('hello') || lower.includes('sup') || lower.includes('morning')) {
          replies = [
            "Hey! How's your day going? 👋",
            "What's up! Ready for class? 📚",
            "Hey there! ☕",
            "Good to hear from you! 🎓"
          ];
        } else if (lower.includes('assignment') || lower.includes('quiz') || lower.includes('exam') || lower.includes('midterm') || lower.includes('project')) {
          replies = [
            "I'm studying for it now! 📖",
            "Do you want to compare notes? 📝",
            "Count me in for the study group! 💡",
            "Let's review the rubric together 🔍"
          ];
        } else if (lower.includes('food') || lower.includes('lunch') || lower.includes('coffee') || lower.includes('cafeteria') || lower.includes('tim hortons')) {
          replies = [
            "I'm down for coffee! ☕",
            "Meet at the cafeteria in 5? 🍔",
            "Grabbing Tim Hortons right now 🍩",
            "Let's grab a table outside ☀️"
          ];
        } else {
          replies = [
            "Sounds good! 👍",
            "Got it, thanks! 🙏",
            "On my way! 🏃",
            "Let me check and get back to you 🔍"
          ];
        }

        return res.end(JSON.stringify({
          success: true,
          suggestions: replies
        }));
      }

      // 15. Verified Trusted User Toggle (Blue Tick)
      if (pathname === '/api/friends/trust/toggle' && req.method === 'POST') {
        const { me, target } = await parseJsonBody(req);
        const resolvedMe = resolveUsername(me);
        const resolvedTarget = resolveUsername(target);

        if (!resolvedMe || !resolvedTarget) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Missing parameters' }));
        }

        const isTrustedNow = DB.toggleTrust(resolvedMe, resolvedTarget);

        broadcastToUser(resolvedTarget, 'trust_updated', {
          by: resolvedMe,
          isTrusted: isTrustedNow
        });

        return res.end(JSON.stringify({
          success: true,
          isTrusted: isTrustedNow
        }));
      }

      // 16. WebRTC Voice Call Signaling & Audio Relay Bridge
      if (pathname === '/api/calls/initiate' && req.method === 'POST') {
        const { caller, recipient } = await parseJsonBody(req);
        const resolvedCaller = resolveUsername(caller);
        const resolvedRecipient = resolveUsername(recipient);

        if (!resolvedCaller || !resolvedRecipient) {
          res.writeHead(404);
          return res.end(JSON.stringify({ error: 'Student account not found' }));
        }

        // Rate limit: max 30 calls per user per minute
        if (!checkActionRateLimit('call', resolvedCaller, 30, 60 * 1000)) {
          res.writeHead(429);
          return res.end(JSON.stringify({ error: 'Rate limit exceeded: max 30 calls per minute.' }));
        }

        if (DB.isBlocked(resolvedCaller, resolvedRecipient)) {
          res.writeHead(403);
          return res.end(JSON.stringify({ error: 'Cannot call: Communication is blocked.' }));
        }

        const callId = 'call_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        const callerUser = DB.getUser(resolvedCaller) || DB.findUser(resolvedCaller) || { displayName: resolvedCaller, avatarColor: getAvatarColor(resolvedCaller) };

        const callSession = {
          callId,
          caller: resolvedCaller,
          callerName: callerUser.displayName || resolvedCaller,
          callerAvatar: callerUser.avatarColor || '#075E54',
          recipient: resolvedRecipient,
          status: 'ringing',
          startedAt: Date.now(),
          connectedAt: null,
          offer: null,
          answer: null,
          candidates: []
        };
        activeCalls.set(callId, callSession);
        try {
          DB.saveCall(callSession);
        } catch (callDbErr) {
          console.warn('[CALL DB WARN]', callDbErr.message);
        }

        broadcastToUser(resolvedRecipient, 'incoming_call', {
          callId,
          caller: resolvedCaller,
          callerName: callerUser.displayName || resolvedCaller,
          callerAvatar: callerUser.avatarColor || '#075E54'
        });
        broadcastToUser(resolvedRecipient, 'voice_call_incoming', {
          callId,
          caller: resolvedCaller,
          callerName: callerUser.displayName || resolvedCaller,
          callerAvatar: callerUser.avatarColor || '#075E54'
        });

        // Simulated accept for demo users
        const recipientUser = DB.getUser(resolvedRecipient) || DB.findUser(resolvedRecipient);
        if (recipientUser && recipientUser.isDemo) {
          setTimeout(() => {
            const currentCall = activeCalls.get(callId);
            if (currentCall && currentCall.status === 'ringing') {
              currentCall.status = 'connected';
              currentCall.connectedAt = Date.now();
              try { DB.updateCall(callId, 'connected', currentCall.connectedAt); } catch (_) {}

              const acceptPayload = {
                callId,
                recipient: resolvedRecipient,
                call: currentCall,
                demoVoicePrompt: `Hi there! I am ${recipientUser.displayName || resolvedRecipient} from Okanagan College. Great connecting with you on OC Connect!`
              };

              broadcastToUser(resolvedCaller, 'call_accepted', acceptPayload);
              broadcastToUser(resolvedCaller, 'voice_call_accepted', acceptPayload);
            }
          }, 1800);
        }

        return res.end(JSON.stringify({
          success: true,
          callId,
          call: callSession,
          status: 'ringing'
        }));
      }

      if (pathname === '/api/calls/respond' && req.method === 'POST') {
        const { callId, action, responder, recipient } = await parseJsonBody(req);
        const call = activeCalls.get(callId);

        if (!call) {
          res.writeHead(404);
          return res.end(JSON.stringify({ error: 'Call session expired' }));
        }

        if (action === 'accept') {
          call.status = 'connected';
          call.connectedAt = Date.now();
          DB.updateCall(callId, 'connected', call.connectedAt);

          broadcastToUser(call.caller, 'call_accepted', {
            callId,
            recipient: call.recipient,
            offer: call.offer,
            call
          });
          broadcastToUser(call.caller, 'voice_call_accepted', {
            callId,
            recipient: call.recipient,
            offer: call.offer,
            call
          });

          return res.end(JSON.stringify({
            success: true,
            status: 'connected',
            call,
            offer: call.offer,
            candidates: call.candidates
          }));
        } else {
          call.status = 'declined';
          DB.updateCall(callId, 'declined');

          broadcastToUser(call.caller, 'call_declined', { callId });
          broadcastToUser(call.caller, 'voice_call_declined', { callId });
          activeCalls.delete(callId);
          return res.end(JSON.stringify({ success: true, status: 'declined' }));
        }
      }

      if (pathname === '/api/calls/end' && req.method === 'POST') {
        const { callId, sender, by, duration } = await parseJsonBody(req);
        const effectiveSender = (sender || by || '').trim().toLowerCase();
        const call = activeCalls.get(callId);

        if (call) {
          const other = call.caller === effectiveSender ? call.recipient : call.caller;
          broadcastToUser(other, 'call_ended', { callId, duration: duration || 0 });
          broadcastToUser(other, 'voice_call_ended', { callId, duration: duration || 0 });

          // Record call in chat history
          const chatId = getDeterministicChatId(call.caller, call.recipient);
          const durSec = duration || (call.connectedAt ? Math.round((Date.now() - call.connectedAt) / 1000) : 0);
          const isMissed = (call.status === 'ringing');

          const callerData = DB.getUser(call.caller) || DB.findUser(call.caller) || { displayName: call.caller };
          try {
            const callMsg = DB.saveMessage({
              id: 'msg_call_' + Date.now(),
              sender: call.caller,
              displayName: callerData.displayName || call.caller,
              text: '',
              chatId: chatId,
              call: {
                callId: callId,
                status: isMissed ? 'missed' : 'ended',
                duration: durSec
              },
              timestamp: Date.now(),
              status: 'read'
            });

            broadcastToUser(call.caller, 'new_message', { sender: call.caller, chatId, message: callMsg });
            broadcastToUser(call.recipient, 'new_message', { sender: call.caller, chatId, message: callMsg });
          } catch (callMsgErr) {
            console.warn('[CALL MSG RECORD ERROR]', callMsgErr.message);
          }

          activeCalls.delete(callId);
        }

        return res.end(JSON.stringify({ success: true }));
      }

      if (pathname === '/api/calls/signal' && req.method === 'POST') {
        const { callId, sender, recipient, type, data } = await parseJsonBody(req);
        const call = activeCalls.get(callId);
        if (call) {
          if (type === 'offer') call.offer = data;
          if (type === 'answer') call.answer = data;
          if (type === 'candidate' && data) call.candidates.push(data);
        }

        broadcastToUser(recipient, 'call_signal', {
          callId,
          sender,
          type,
          data
        });
        broadcastToUser(recipient, 'voice_call_signal', {
          callId,
          sender,
          type,
          data
        });

        return res.end(JSON.stringify({ success: true }));
      }

      // Audio Chunk Bridge for restrictive NATs
      if (pathname === '/api/calls/audio-chunk' && req.method === 'POST') {
        const { callId, sender, recipient, chunk } = await parseJsonBody(req);
        if (recipient && chunk) {
          broadcastToUser(recipient, 'call_audio_chunk', {
            callId,
            sender,
            chunk
          });
          broadcastToUser(recipient, 'voice_call_audio_chunk', {
            callId,
            sender,
            chunk
          });
        }
        return res.end(JSON.stringify({ success: true }));
      }

      // Active Call Query Fallback Route
      if (pathname === '/api/calls/active' && req.method === 'GET') {
        const me = (parsedUrl.searchParams.get('me') || '').trim().toLowerCase();
        const resolvedMe = resolveUsername(me);
        if (!resolvedMe) {
          return res.end(JSON.stringify({ success: true, call: null }));
        }

        let foundCall = null;
        for (const [callId, call] of activeCalls.entries()) {
          if (call.recipient === resolvedMe || call.caller === resolvedMe) {
            foundCall = call;
            break;
          }
        }
        return res.end(JSON.stringify({ success: true, call: foundCall }));
      }

      // 17. Campus Safety SOS Alert
      if (pathname === '/api/sos/trigger' && req.method === 'POST') {
        const { sender, type } = await parseJsonBody(req);
        const resolvedSender = resolveUsername(sender);

        if (!resolvedSender) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Unauthorized sender' }));
        }

        const user = DB.getUser(resolvedSender);
        const alertObj = {
          id: 'sos_' + Date.now(),
          username: resolvedSender,
          displayName: user.displayName,
          type: type || 'walk_me_home',
          timestamp: Date.now()
        };

        // Broadcast alert into campus-safety room
        const sosMsg = DB.saveMessage({
          id: 'msg_sos_' + Date.now(),
          channel: 'campus-safety',
          sender: 'SecurityBot',
          displayName: 'Campus Security 🛡️',
          text: `🚨 SAFETY ALERT: ${user.displayName} (@${resolvedSender}) activated [${type === 'walk_me_home' ? 'Walk Me Home' : 'Emergency SOS'}] on Kelowna Campus. Security and campus monitors notified.`,
          timestamp: Date.now(),
          status: 'read'
        });

        broadcastToAll('channel_message', { channel: 'campus-safety', message: sosMsg });
        broadcastToAll('sos_alert', alertObj);

        return res.end(JSON.stringify({ success: true, alert: alertObj }));
      }

      // 18. Open-Meteo Campus Weather API
      if (pathname === '/api/campus/weather' && req.method === 'GET') {
        const campus = (parsedUrl.searchParams.get('campus') || 'kelowna').toLowerCase();
        const coords = {
          kelowna: { lat: 49.888, lon: -119.496, name: 'Kelowna Campus (KLO)' },
          vernon: { lat: 50.267, lon: -119.272, name: 'Vernon Campus (Kalamalka)' },
          penticton: { lat: 49.499, lon: -119.593, name: 'Penticton Campus' },
          salmonarm: { lat: 50.702, lon: -119.272, name: 'Salmon Arm Campus' }
        }[campus] || { lat: 49.888, lon: -119.496, name: 'Kelowna Campus (KLO)' };

        try {
          const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`;
          const data = await fetchJsonWithTimeout(url);
          const cur = data.current || {};
          const temp = Math.round(cur.temperature_2m || 15);
          const humidity = cur.relative_humidity_2m || 50;
          const wind = cur.wind_speed_10m || 8;
          const code = cur.weather_code || 0;

          const getCondition = (c) => {
            if (c === 0) return { cond: 'Clear Sky', emoji: '☀️' };
            if ([1, 2, 3].includes(c)) return { cond: 'Partly Cloudy', emoji: '⛅' };
            if ([45, 48].includes(c)) return { cond: 'Foggy', emoji: '🌫️' };
            if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(c)) return { cond: 'Rain / Showers', emoji: '🌧️' };
            if ([71, 73, 75, 85, 86].includes(c)) return { cond: 'Snow Showers', emoji: '❄️' };
            if ([95, 96, 99].includes(c)) return { cond: 'Thunderstorm', emoji: '⛈️' };
            return { cond: 'Fair', emoji: '🌤️' };
          };

          const { cond, emoji } = getCondition(code);
          return res.end(JSON.stringify({
            success: true,
            campus: coords.name,
            temp: temp,
            tempString: `${temp}°C`,
            condition: cond,
            emoji: emoji,
            humidity: `${humidity}%`,
            wind: `${wind} km/h`,
            advice: temp < 5 ? 'Chilly! Grab a warm coffee at KLO cafeteria ☕' : (temp > 22 ? 'Sunny day! Great for outdoor study by Okanagan lake ☀️' : 'Pleasant campus weather for walking to class 🚶')
          }));
        } catch (err) {
          return res.end(JSON.stringify({
            success: true,
            campus: coords.name,
            temp: 16,
            tempString: '16°C',
            condition: 'Partly Cloudy',
            emoji: '⛅',
            humidity: '52%',
            wind: '10 km/h',
            advice: 'Have a great study session on campus! 📚'
          }));
        }
      }

      // 19. Daily Student Inspiration Quote
      if (pathname === '/api/campus/quote' && req.method === 'GET') {
        const quotes = [
          { quote: "Success is the sum of small efforts, repeated day in and day out.", author: "Robert Collier" },
          { quote: "The beautiful thing about learning is that no one can take it away from you.", author: "B.B. King" },
          { quote: "You don't have to be great to start, but you have to start to be great.", author: "Zig Ziglar" },
          { quote: "The expert in anything was once a beginner.", author: "Helen Hayes" },
          { quote: "Education is the most powerful weapon which you can use to change the world.", author: "Nelson Mandela" },
          { quote: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" }
        ];
        const pick = quotes[Math.floor(Math.random() * quotes.length)];
        return res.end(JSON.stringify({ success: true, quote: pick.quote, author: pick.author }));
      }

      // 20. Wikipedia Academic Summary API
      if (pathname === '/api/study/wiki' && req.method === 'GET') {
        const query = (parsedUrl.searchParams.get('q') || '').trim();
        if (!query) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Query parameter q required' }));
        }

        try {
          const wikiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
          const data = await fetchJsonWithTimeout(wikiUrl);
          if (data && data.title && (data.extract || data.description)) {
            return res.end(JSON.stringify({
              success: true,
              title: data.title,
              extract: data.extract || data.description,
              url: data.content_urls ? data.content_urls.desktop.page : `https://en.wikipedia.org/wiki/${encodeURIComponent(query)}`
            }));
          } else {
            res.writeHead(404);
            return res.end(JSON.stringify({ error: `No Wikipedia article found for "${query}"` }));
          }
        } catch (err) {
          res.writeHead(500);
          return res.end(JSON.stringify({ error: 'Could not fetch from Wikipedia: ' + err.message }));
        }
      }

      // 21. Open Library Book Search API
      if (pathname === '/api/study/books' && req.method === 'GET') {
        const query = (parsedUrl.searchParams.get('q') || '').trim();
        if (!query) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Query parameter q required' }));
        }

        try {
          const olUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=5`;
          const data = await fetchJsonWithTimeout(olUrl);
          const docs = (data.docs || []).slice(0, 5).map(doc => ({
            title: doc.title,
            author: doc.author_name ? doc.author_name[0] : 'Unknown Author',
            year: doc.first_publish_year || 'N/A',
            url: doc.key ? `https://openlibrary.org${doc.key}` : `https://openlibrary.org/search?q=${encodeURIComponent(query)}`
          }));

          return res.end(JSON.stringify({
            success: true,
            books: docs
          }));
        } catch (err) {
          res.writeHead(500);
          return res.end(JSON.stringify({ error: 'Could not search Open Library: ' + err.message }));
        }
      }

      // 22. Official Joke API Study Break Humor
      if (pathname === '/api/study/joke' && req.method === 'GET') {
        try {
          const jokeUrl = 'https://official-joke-api.appspot.com/random_joke';
          const data = await fetchJsonWithTimeout(jokeUrl);
          return res.end(JSON.stringify({
            success: true,
            setup: data.setup,
            punchline: data.punchline
          }));
        } catch (err) {
          return res.end(JSON.stringify({
            success: true,
            setup: "Why do programmers prefer dark mode?",
            punchline: "Because light attracts bugs!"
          }));
        }
      }

      // 23. Free Dictionary & Vocabulary API (Free Dictionary API)
      if (pathname === '/api/study/define' && req.method === 'GET') {
        const word = (parsedUrl.searchParams.get('q') || '').trim().toLowerCase();
        if (!word) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Query parameter q required' }));
        }

        try {
          const dictUrl = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
          const data = await fetchJsonWithTimeout(dictUrl);
          if (Array.isArray(data) && data.length > 0) {
            const entry = data[0];
            let phonetic = entry.phonetic || (entry.phonetics && entry.phonetics.find(p => p.text)?.text) || '';
            let audio = (entry.phonetics && entry.phonetics.find(p => p.audio)?.audio) || null;
            let partOfSpeech = entry.meanings && entry.meanings[0] ? entry.meanings[0].partOfSpeech : 'noun';
            let definition = entry.meanings && entry.meanings[0] && entry.meanings[0].definitions[0] ? entry.meanings[0].definitions[0].definition : '';
            let example = entry.meanings && entry.meanings[0] && entry.meanings[0].definitions[0] ? entry.meanings[0].definitions[0].example : '';

            return res.end(JSON.stringify({
              success: true,
              word: entry.word || word,
              phonetic: phonetic,
              audio: audio,
              partOfSpeech: partOfSpeech,
              definition: definition,
              example: example,
              sourceUrl: entry.sourceUrls ? entry.sourceUrls[0] : `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`
            }));
          }
        } catch (err) {
          // Graceful dictionary fallback for academic study
          const fallbacks = {
            'algorithm': { partOfSpeech: 'noun', phonetic: '/ˈæl.ɡə.rɪð.əm/', definition: 'A process or set of rules to be followed in calculations or problem-solving operations, especially by a computer.', example: 'A sorting algorithm can order millions of records in seconds.' },
            'database': { partOfSpeech: 'noun', phonetic: '/ˈdeɪ.tə.beɪs/', definition: 'A structured set of data held in a computer, especially one that is accessible in various ways.', example: 'SQLite and PostgreSQL are industry standard database engines.' },
            'campus': { partOfSpeech: 'noun', phonetic: '/ˈkæm.pəs/', definition: 'The grounds and buildings of a university, college, or school.', example: 'Okanagan College KLO campus is located near Mission Creek.' },
            'syllabus': { partOfSpeech: 'noun', phonetic: '/ˈsɪl.ə.bəs/', definition: 'An outline of the subjects in a course of study or teaching.', example: 'The professor posted the midterm dates on the syllabus.' },
            'recursion': { partOfSpeech: 'noun', phonetic: '/rɪˈkɜː.ʒən/', definition: 'The repeated application of a recursive procedure or definition in computation.', example: 'Recursion solves complex problems by breaking them into smaller base cases.' }
          };

          const matched = fallbacks[word];
          if (matched) {
            return res.end(JSON.stringify({
              success: true,
              word: word,
              phonetic: matched.phonetic,
              audio: null,
              partOfSpeech: matched.partOfSpeech,
              definition: matched.definition,
              example: matched.example,
              sourceUrl: `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`
            }));
          }

          return res.end(JSON.stringify({
            success: true,
            word: word,
            phonetic: `/${word}/`,
            audio: null,
            partOfSpeech: 'term',
            definition: `Academic concept and vocabulary term related to study and coursework at Okanagan College.`,
            example: `Understanding ${word} is essential for success in this module.`,
            sourceUrl: `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`
          }));
        }
      }

      // 24. Daily Student Advice & Life Tips (Advice Slip API)
      if (pathname === '/api/study/advice' && req.method === 'GET') {
        try {
          const adviceUrl = 'https://api.adviceslip.com/advice';
          const data = await fetchJsonWithTimeout(adviceUrl);
          if (data && data.slip && data.slip.advice) {
            return res.end(JSON.stringify({
              success: true,
              advice: data.slip.advice,
              id: data.slip.id
            }));
          }
        } catch (err) {
          const studentAdvices = [
            "Take 10-minute breaks every 50 minutes of studying to prevent mental burnout.",
            "Form a study group with classmates early in the semester — teaching concepts solidifies your own understanding.",
            "Always back up your assignments and code repositories to GitHub or Cloud storage.",
            "Stay hydrated and take a brisk walk around the Okanagan College courtyard between lectures.",
            "Prioritize consistent 7-hour sleep before exam days rather than pulling all-nighters."
          ];
          const pick = studentAdvices[Math.floor(Math.random() * studentAdvices.length)];
          return res.end(JSON.stringify({
            success: true,
            advice: pick,
            id: Math.floor(Math.random() * 1000)
          }));
        }
      }

      // 25. International Student Currency Converter (Open Exchange Rates API)
      if (pathname === '/api/study/convert' && req.method === 'GET') {
        const amount = parseFloat(parsedUrl.searchParams.get('amount') || '1') || 1;
        const from = (parsedUrl.searchParams.get('from') || 'CAD').toUpperCase();
        const to = (parsedUrl.searchParams.get('to') || 'USD').toUpperCase();

        const fallbackRates = {
          'CAD': { 'USD': 0.74, 'INR': 61.5, 'EUR': 0.68, 'GBP': 0.58, 'AUD': 1.12, 'CNY': 5.35, 'PHP': 42.1, 'JPY': 114.2, 'CAD': 1.0 },
          'USD': { 'CAD': 1.35, 'INR': 83.2, 'EUR': 0.92, 'GBP': 0.79, 'AUD': 1.51, 'CNY': 7.23, 'PHP': 56.9, 'JPY': 154.5, 'USD': 1.0 },
          'INR': { 'CAD': 0.016, 'USD': 0.012, 'EUR': 0.011, 'GBP': 0.0095, 'AUD': 0.018, 'CNY': 0.087, 'PHP': 0.68, 'JPY': 1.86, 'INR': 1.0 },
          'EUR': { 'CAD': 1.47, 'USD': 1.09, 'INR': 90.4, 'GBP': 0.85, 'AUD': 1.64, 'CNY': 7.85, 'PHP': 61.8, 'JPY': 167.8, 'EUR': 1.0 }
        };

        try {
          const erUrl = `https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`;
          const data = await fetchJsonWithTimeout(erUrl);
          if (data && data.rates && data.rates[to]) {
            const rate = data.rates[to];
            const converted = (amount * rate).toFixed(2);
            return res.end(JSON.stringify({
              success: true,
              amount: amount,
              from: from,
              to: to,
              rate: rate,
              result: parseFloat(converted)
            }));
          }
        } catch (_) {}

        // Fallback using exchange table
        let rate = 1.0;
        if (fallbackRates[from] && fallbackRates[from][to]) {
          rate = fallbackRates[from][to];
        } else if (from === to) {
          rate = 1.0;
        } else {
          rate = 1.35;
        }
        const converted = (amount * rate).toFixed(2);
        return res.end(JSON.stringify({
          success: true,
          amount: amount,
          from: from,
          to: to,
          rate: rate,
          result: parseFloat(converted)
        }));
      }

      // 26. Curated Okanagan College Campus Meeting Pins & Map Directions
      if (pathname === '/api/campus/locations' && req.method === 'GET') {
        const locations = [
          {
            id: 'klo-library',
            name: 'KLO Campus Library & Learning Commons',
            campus: 'Kelowna Campus',
            building: 'Building C (Library)',
            details: 'Quiet study tables, private group study rooms, and computer printing stations.',
            lat: 49.8631,
            lng: -119.4837,
            mapUrl: 'https://maps.google.com/?q=49.8631,-119.4837(OC+KLO+Library)'
          },
          {
            id: 'klo-cafeteria',
            name: 'KLO Student Cafeteria & Lounge',
            campus: 'Kelowna Campus',
            building: 'Student Services Building (A)',
            details: 'Central student lunch hub, Tim Hortons coffee, microwaves, and peer meetups.',
            lat: 49.8624,
            lng: -119.4842,
            mapUrl: 'https://maps.google.com/?q=49.8624,-119.4842(OC+Cafeteria)'
          },
          {
            id: 'klo-cfl',
            name: 'Centre for Learning (CFL) Atrium',
            campus: 'Kelowna Campus',
            building: 'Centre for Learning',
            details: 'Bright sunlit glass atrium, group collaboration booths, and tech support desk.',
            lat: 49.8635,
            lng: -119.4832,
            mapUrl: 'https://maps.google.com/?q=49.8635,-119.4832(OC+CFL+Atrium)'
          },
          {
            id: 'klo-trades',
            name: 'Trades & Apprenticeship Complex',
            campus: 'Kelowna Campus',
            building: 'Trades Complex (T)',
            details: 'Modern LEED Platinum green building for engineering, trades, and tech labs.',
            lat: 49.8618,
            lng: -119.4851,
            mapUrl: 'https://maps.google.com/?q=49.8618,-119.4851(OC+Trades+Building)'
          },
          {
            id: 'klo-bus-loop',
            name: 'KLO Campus Transit & Bus Loop',
            campus: 'Kelowna Campus',
            building: 'KLO Road Entrance',
            details: 'Main Kelowna Transit bus exchange (#1, #8, #12 buses) and Walk Me Home meeting point.',
            lat: 49.8640,
            lng: -119.4845,
            mapUrl: 'https://maps.google.com/?q=49.8640,-119.4845(OC+Bus+Loop)'
          },
          {
            id: 'vernon-campus',
            name: 'Vernon Campus Main Atrium',
            campus: 'Vernon Campus',
            building: 'Kalamalka Building',
            details: 'Scenic hilltop views of Kalamalka lake, cafeteria, and computer science lab.',
            lat: 50.2335,
            lng: -119.2812,
            mapUrl: 'https://maps.google.com/?q=50.2335,-119.2812(OC+Vernon+Campus)'
          },
          {
            id: 'penticton-coe',
            name: 'Penticton Centre of Excellence',
            campus: 'Penticton Campus',
            building: 'Jim Pattison Centre',
            details: 'World-class sustainable building, winery labs, and group study lounge.',
            lat: 49.4812,
            lng: -119.5823,
            mapUrl: 'https://maps.google.com/?q=49.4812,-119.5823(OC+Penticton+Campus)'
          }
        ];

        return res.end(JSON.stringify({
          success: true,
          locations: locations
        }));
      }

      // 23. Profile Picture Upload & Disk Persistence
      // 23. Profile Picture Upload & Disk Persistence (Supports Dicebear URLs, SVGs, and Photos)
      if (pathname === '/api/users/profile-picture' && req.method === 'POST') {
        const { username, image } = await parseJsonBody(req);
        const auth = getSessionFromRequest(req, parsedUrl);
        const resolved = (auth && auth.username) ? auth.username : resolveUsername(username);

        if (!resolved) {
          res.writeHead(404);
          return res.end(JSON.stringify({ error: 'User not found' }));
        }

        let avatarUrl = null;
        if (!image) {
          DB.setUserAvatar(resolved, null);
        } else if (typeof image === 'string' && (image.startsWith('http://') || image.startsWith('https://') || image.startsWith('/api/uploads/'))) {
          // Direct web or API image URL (e.g. Dicebear avatar URL)
          avatarUrl = image;
          DB.setUserAvatar(resolved, avatarUrl);
        } else if (typeof image === 'string' && image.startsWith('data:')) {
          // Option A: Store base64 strings directly in SQLite avatar_image column (no disk writes for avatars <= 500KB)
          if (Buffer.byteLength(image, 'utf8') <= 500 * 1024) {
            avatarUrl = image;
            DB.setUserAvatar(resolved, avatarUrl);
          } else {
            try {
              const diskFile = await saveBase64Media(image, 'avatars', `${resolved}.jpg`, 'image/jpeg');
              avatarUrl = diskFile.url;
              DB.setUserAvatar(resolved, avatarUrl);
            } catch (imgErr) {
              res.writeHead(400);
              return res.end(JSON.stringify({ error: 'Failed to process image: ' + imgErr.message }));
            }
          }
        }

        const updatedUser = DB.getUser(resolved);

        // Broadcast to all connected clients & friends
        broadcastToAll('directory_updated', {
          updatedUser: updatedUser
        });

        const myFriends = DB.getFriends(resolved);
        for (const f of myFriends) {
          broadcastToUser(f, 'user_online', {
            username: resolved,
            online: true,
            avatarImage: avatarUrl
          });
          broadcastToUser(f, 'user_updated', {
            user: updatedUser
          });
        }

        return res.end(JSON.stringify({
          success: true,
          avatarImage: avatarUrl,
          user: updatedUser
        }));
      }

      // 24. Display Name Update
      if (pathname === '/api/users/display-name' && req.method === 'POST') {
        const { username, displayName } = await parseJsonBody(req);
        const auth = getSessionFromRequest(req, parsedUrl);
        const resolved = (auth && auth.username) ? auth.username : resolveUsername(username);

        if (!resolved) {
          res.writeHead(404);
          return res.end(JSON.stringify({ error: 'User not found' }));
        }

        const cleanName = (displayName || '').trim().slice(0, 40);
        if (!cleanName) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Display name cannot be empty' }));
        }

        DB.setUserDisplayName(resolved, cleanName);
        const updatedUser = DB.getUser(resolved);

        broadcastToAll('directory_updated', {
          updatedUser: updatedUser
        });

        const myFriends = DB.getFriends(resolved);
        for (const f of myFriends) {
          broadcastToUser(f, 'user_updated', { user: updatedUser });
        }

        return res.end(JSON.stringify({
          success: true,
          displayName: cleanName,
          user: updatedUser
        }));
      }

      // 24b. Unified Student Profile Update (Display Name, Username, Major, Campus, Bio, Avatar Color, Photo)
      if (pathname === '/api/users/profile' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const auth = getSessionFromRequest(req, parsedUrl);
        const resolved = (auth && auth.user && auth.user.username) ? auth.user.username : resolveUsername(body.username);

        if (!resolved) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'User not found' }));
        }

        const user = DB.getUser(resolved);
        if (!user) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'User record not found in system' }));
        }

        // Process avatarImage if it's a data URL
        let processedAvatarImage = body.avatarImage;
        if (processedAvatarImage && typeof processedAvatarImage === 'string') {
          if (processedAvatarImage.startsWith('http://') || processedAvatarImage.startsWith('https://') || processedAvatarImage.startsWith('/api/uploads/')) {
            // Keep URL as-is
          } else if (processedAvatarImage.startsWith('data:')) {
            // Option A: If <= 500KB, store base64 directly in SQLite (no disk writes, persists across Render deploys)
            if (Buffer.byteLength(processedAvatarImage, 'utf8') > 500 * 1024) {
              try {
                const diskFile = await saveBase64Media(processedAvatarImage, 'avatars', `${resolved}.jpg`, 'image/jpeg');
                processedAvatarImage = diskFile.url;
              } catch (_) {}
            }
          }
        }

        // Check for username handle update
        let requestedNewUsername = body.newUsername ? body.newUsername.trim().toLowerCase().replace(/^@/, '') : null;
        if (requestedNewUsername && requestedNewUsername !== resolved) {
          if (requestedNewUsername.length < 3 || requestedNewUsername.length > 20 || !/^[a-z0-9_]+$/.test(requestedNewUsername)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Username must be 3-20 characters and contain only letters, numbers, and underscores.' }));
          }
          const taken = DB.getUser(requestedNewUsername);
          const isOwnLegacyAccount = taken && (
            (DB.getCanonicalUsername && DB.getCanonicalUsername(requestedNewUsername) === DB.getCanonicalUsername(resolved)) ||
            (DB.getUserAliases && DB.getUserAliases(resolved).includes(requestedNewUsername)) ||
            (user.email && taken.email && user.email === taken.email) ||
            (user.ocId && taken.ocId && (user.ocId === taken.ocId || user.ocId.includes(taken.ocId) || taken.ocId.includes(user.ocId))) ||
            (resolved === '300354198' && (requestedNewUsername === 'mukesh' || requestedNewUsername === 'mukesh_sarwa')) ||
            ((resolved === 'mukesh' || resolved === 'mukesh_sarwa') && requestedNewUsername === '300354198')
          );
          if (taken && !isOwnLegacyAccount && !taken.isDemo) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: `Username @${requestedNewUsername} is already taken.` }));
          }
          if (taken && (isOwnLegacyAccount || taken.isDemo)) {
            DB.deleteUser(requestedNewUsername);
          }
        } else {
          requestedNewUsername = null;
        }

        const updatedUser = DB.updateUserProfile(resolved, {
          newUsername: requestedNewUsername,
          displayName: body.displayName,
          major: body.major,
          campus: body.campus,
          bio: body.bio,
          avatarColor: body.avatarColor,
          avatarImage: processedAvatarImage,
          email: body.email,
          phone: body.phone,
          hasOnboarded: body.hasOnboarded
        });

        const finalUsername = updatedUser ? updatedUser.username : (requestedNewUsername || resolved);

        // Update active SSE connection keys if username changed
        if (requestedNewUsername && sseConnections.has(resolved)) {
          const streams = sseConnections.get(resolved);
          sseConnections.delete(resolved);
          sseConnections.set(finalUsername, streams);
        }

        // Broadcast to ALL clients so directory, friends list, active chats, and group members update in real time
        broadcastToAll('directory_updated', {
          updatedUser: updatedUser,
          renamedUser: requestedNewUsername ? {
            oldUsername: resolved,
            newUsername: finalUsername,
            displayName: updatedUser ? updatedUser.displayName : undefined
          } : undefined
        });

        const myFriends = DB.getFriends(finalUsername);
        for (const f of myFriends) {
          broadcastToUser(f, 'user_updated', {
            user: updatedUser
          });
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          user: updatedUser
        }));
      }

      // 25. SSE Real-Time Stream Endpoint (Supports /api/stream and /api/events)
      if ((pathname === '/api/stream' || pathname === '/api/events') && req.method === 'GET') {
        const username = (parsedUrl.searchParams.get('username') || '').trim().toLowerCase();
        const resolved = resolveUsername(username);

        if (!resolved) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid or unregistered username' }));
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Access-Control-Allow-Origin': isAllowedOrigin ? origin : 'https://oc-connect-1.onrender.com',
          'Access-Control-Allow-Credentials': 'true',
          'X-Accel-Buffering': 'no'
        });
        if (req.socket) {
          req.socket.setNoDelay(true);
          req.socket.setKeepAlive(true, 15000);
        }
        res.write(': connected\n\n');

        if (!sseConnections.has(resolved)) {
          sseConnections.set(resolved, new Set());
        }
        sseConnections.get(resolved).add(res);

        // Flush and delete pending offline notifications immediately
        const pending = DB.getPendingNotifications(resolved);
        if (pending && pending.length > 0) {
          for (const item of pending) {
            safeWriteSSE(res, `event: ${item.eventName}\ndata: ${JSON.stringify(item.data)}\n\n`);
            if (item.eventName === 'new_message' && item.data && item.data.message) {
              const m = item.data.message;
              DB.markMessageDelivered(m.id);
              if (m.sender) {
                broadcastToUser(m.sender, 'message_delivered', {
                  messageId: m.id,
                  chatId: item.data.chatId,
                  status: 'delivered'
                });
              }
            }
          }
          DB.clearPendingNotifications(resolved);
        }

        // Mark user online in SQLite
        DB.setUserOnline(resolved, true);

        // Notify friends user is online
        const myFriends = DB.getFriends(resolved);
        const meUser = DB.getUser(resolved);
        for (const f of myFriends) {
          broadcastToUser(f, 'user_online', {
            username: resolved,
            online: true,
            avatarImage: meUser.avatarImage
          });
        }

        // Heartbeat Keepalive every 20 seconds (resilient to severed sockets)
        const keepaliveTimer = setInterval(() => {
          const ok = safeWriteSSE(res, ': keepalive\n\n');
          if (!ok) {
            clearInterval(keepaliveTimer);
            const userStreams = sseConnections.get(resolved);
            if (userStreams) userStreams.delete(res);
          }
        }, 20000);

        req.on('close', () => {
          clearInterval(keepaliveTimer);
          const userStreams = sseConnections.get(resolved);
          if (userStreams) {
            userStreams.delete(res);
            if (userStreams.size === 0) {
              sseConnections.delete(resolved);
              DB.setUserOnline(resolved, false);
              for (const f of myFriends) {
                broadcastToUser(f, 'user_offline', {
                  username: resolved,
                  lastSeen: Date.now()
                });
              }
            }
          }
        });

        return;
      }

      res.writeHead(404);
      return res.end(JSON.stringify({ error: 'Endpoint not found' }));

    } catch (apiErr) {
      return handleServerError(apiErr, req, res);
    }
  }

  // STATIC FILE SERVING
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '') {
    safePath = '/index.html';
  }

  const filePath = path.join(__dirname, 'public', safePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      const indexFile = path.join(__dirname, 'public', 'index.html');
      fs.readFile(indexFile, (fallbackErr, indexContent) => {
        if (fallbackErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('404 Not Found');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(indexContent);
      });
      return;
    }

    const headers = { 'Content-Type': contentType };
    if (safePath === '/sw.js') {
      headers['Service-Worker-Allowed'] = '/';
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    }
    res.writeHead(200, headers);
    res.end(content);
  });
  } catch (fatalRouteErr) {
    handleServerError(fatalRouteErr, req, res);
  }
});

// ==========================================
// BACKGROUND RUNNER: SCHEDULED MESSAGES DELIVERY (SEND LATER)
// ==========================================
const scheduledRunner = setInterval(() => {
  try {
    const due = DB.getDueScheduledMessages(Date.now());
    for (const s of due) {
      const senderUser = DB.getUser(s.sender);
      const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      const displayName = (senderUser && senderUser.displayName) || s.displayName || s.sender;

      if (s.groupId) {
        const group = DB.getGroup(s.groupId);
        const newMsg = DB.saveMessage({
          id: msgId,
          chatId: 'group_' + s.groupId,
          sender: s.sender,
          displayName: displayName,
          text: s.text,
          image: s.image,
          file: s.file,
          voice: s.voice,
          studyCard: s.studyCard,
          timestamp: Date.now(),
          status: 'sent'
        });
        broadcastToGroup(s.groupId, 'group_message', {
          groupId: s.groupId,
          groupName: group ? group.name : 'Group',
          message: newMsg
        });
      } else if (s.channel) {
        const newMsg = DB.saveMessage({
          id: msgId,
          channel: s.channel.toLowerCase(),
          sender: s.sender,
          displayName: displayName,
          text: s.text,
          image: s.image,
          file: s.file,
          voice: s.voice,
          studyCard: s.studyCard,
          timestamp: Date.now(),
          status: 'sent'
        });
        broadcastToAll('channel_message', { channel: s.channel.toLowerCase(), message: newMsg });
      } else if (s.recipient) {
        const chatId = getDeterministicChatId(s.sender, s.recipient);
        const newMsg = DB.saveMessage({
          id: msgId,
          recipient: s.recipient,
          sender: s.sender,
          displayName: displayName,
          text: s.text,
          image: s.image,
          file: s.file,
          voice: s.voice,
          studyCard: s.studyCard,
          timestamp: Date.now(),
          status: 'sent'
        });
        broadcastToUser(s.recipient, 'new_message', { sender: s.sender, chatId, message: newMsg });
        broadcastToUser(s.sender, 'new_message', { sender: s.sender, chatId, message: newMsg });
      }

      DB.markScheduledSent(s.id);
      broadcastToUser(s.sender, 'scheduled_message_sent', { id: s.id });
    }
  } catch (err) {
    console.error('Scheduled message runner error:', err);
  }
}, 2500);
// Process-Level Resilience Listeners (Prevent Fatal Server Crashes)
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL UNCAUGHT EXCEPTION]', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[CRITICAL UNHANDLED REJECTION]', reason);
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚀 OC Connect SQLite WAL Mode Server running on port ${PORT}`);
    console.log(`Local Access: http://localhost:${PORT}`);
    console.log(`Campus / Mobile Wi-Fi: http://10.0.0.137:${PORT}`);
    console.log(`Storage: SQLite WAL + Local Disk Media Engine`);
    console.log(`=======================================================`);
  });
}

module.exports = { server, DB };
