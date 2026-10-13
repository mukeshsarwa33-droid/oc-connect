const http = require('http');
const https = require('https');

const BASE_URL = process.env.TEST_URL || 'http://localhost:8080';
const isHttps = BASE_URL.startsWith('https');
const client = isHttps ? https : http;

console.log(`\n====================================================`);
console.log(`🚀 RUNNING COMPREHENSIVE E2E APP TEST ON ${BASE_URL}`);
console.log(`====================================================\n`);

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    failed++;
  }
}

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(options.path || '/', BASE_URL);
    const reqOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = client.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', reject);
    if (body) {
      if (typeof body === 'object') {
        req.write(JSON.stringify(body));
      } else {
        req.write(body);
      }
    }
    req.end();
  });
}

async function runTests() {
  try {
    // 1. APK Distribution & Headers
    console.log(`\n--- 1. APK Distribution & Headers ---`);
    const apkRes = await request({ path: '/download', method: 'GET' });
    assert(apkRes.statusCode === 200 || apkRes.statusCode === 302, `GET /download responds with status ${apkRes.statusCode}`);
    assert(
      apkRes.headers['content-type'] === 'application/vnd.android.package-archive' || apkRes.headers['location'],
      `Content-Type indicates Android package archive or download redirect (${apkRes.headers['content-type'] || apkRes.headers['location']})`
    );

    // Direct APK file header check
    const apkFileRes = await request({ path: '/oc-connect.apk', method: 'GET' });
    assert(apkFileRes.statusCode === 200, `GET /oc-connect.apk directly serves with 200 OK`);
    const contentLength = parseInt(apkFileRes.headers['content-length'] || apkFileRes.body.length.toString(), 10);
    assert(contentLength > 500000, `APK size is verified (~561 KB, exactly ${contentLength} bytes)`);

    // 2. Web App Shell & Service Worker
    console.log(`\n--- 2. Web App Shell & PWA Assets ---`);
    const homeRes = await request({ path: '/' });
    assert(homeRes.statusCode === 200, `Homepage / loads with 200 OK`);
    assert(homeRes.body.includes('OC Connect'), `Page contains title 'OC Connect'`);
    assert(homeRes.body.includes('oc-connect.apk') || homeRes.body.includes('/download'), `Page includes direct APK download button`);

    const swRes = await request({ path: '/sw.js' });
    assert(swRes.statusCode === 200, `Service worker /sw.js is present`);
    assert(swRes.body.includes('CACHE_NAME'), `Service worker has caching logic`);

    // 3. User Directory & Accounts
    console.log(`\n--- 3. Canonical Users & Identity ---`);
    const usersRes = await request({ path: '/api/users/all?me=300354198' });
    assert(usersRes.statusCode === 200, `GET /api/users/all returns 200 OK`);
    const usersData = JSON.parse(usersRes.body);
    const students = usersData.students || [];
    assert(students.length > 0, `Campus directory contains students (Found ${students.length})`);
    
    // Check specific user profile for Mukesh
    const mukeshMeRes = await request({ path: '/api/users/me?username=300354198' });
    assert(mukeshMeRes.statusCode === 200, `Profile /api/users/me?username=300354198 returns 200`);
    const mukeshUser = JSON.parse(mukeshMeRes.body);
    assert(mukeshUser.user && (mukeshUser.user.username === '300354198' || mukeshUser.user.displayName.includes('Mukesh')), `Mukesh canonical account verified (${mukeshUser.user?.displayName})`);

    // Check specific user profile for Aadi (student ID 300363794)
    const aadiMeRes = await request({ path: '/api/users/me?username=300363794' });
    assert(aadiMeRes.statusCode === 200, `Profile /api/users/me?username=300363794 returns 200`);
    const aadiUser = JSON.parse(aadiMeRes.body);
    assert(aadiUser.user && (aadiUser.user.username === '300363794' || aadiUser.user.displayName.includes('Aadi')), `Aadi canonical account verified (${aadiUser.user?.displayName})`);

    // 4. Default Lounges & Groups
    console.log(`\n--- 4. Campus Lounges & Groups ---`);
    const groupsRes = await request({ path: '/api/groups/list?username=300354198' });
    assert(groupsRes.statusCode === 200, `GET /api/groups/list returns 200 OK`);
    const groupsData = JSON.parse(groupsRes.body);
    const groups = groupsData.groups || [];
    assert(Array.isArray(groups) && groups.length > 0, `User groups exist (Found ${groups.length})`);

    // 5. WhatsApp-Style Direct Notification Reply Emulation
    console.log(`\n--- 5. Android Notification Direct Reply Emulation ---`);
    const replyTimestamp = Date.now();
    const replyText = `[Test Notification Inline Reply from Android] ${replyTimestamp}`;
    const testMsgPayload = {
      sender: '300354198',
      channel: 'general',
      text: replyText
    };
    
    const sendRes = await request({
      path: '/api/messages/send',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, testMsgPayload);
    
    assert(sendRes.statusCode === 200, `Direct Notification Reply sent successfully (${sendRes.statusCode})`);
    const sendData = JSON.parse(sendRes.body);
    const createdMsg = sendData.message;
    const createdMsgId = createdMsg ? createdMsg.id : null;
    assert(createdMsgId !== null, `Server acknowledged with message ID: ${createdMsgId}`);

    // Verify message appears in channel history
    const fetchMsgsRes = await request({ path: '/api/messages/history?channel=true&target=general' });
    assert(fetchMsgsRes.statusCode === 200, `GET /api/messages/history returns 200`);
    const msgsData = JSON.parse(fetchMsgsRes.body);
    const msgs = msgsData.messages || [];
    const foundMsg = msgs.find(m => m.id === createdMsgId || m.text === replyText);
    assert(foundMsg !== undefined, `Sent message appears in lounge history`);

    // 6. 15-Minute Recall & Delete Window
    console.log(`\n--- 6. 15-Minute Recall & Deletion Policy ---`);
    if (createdMsgId) {
      const deletePayload = {
        messageId: createdMsgId,
        username: '300354198'
      };
      const delRes = await request({
        path: '/api/messages/delete',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, deletePayload);

      assert(delRes.statusCode === 200, `Message recall succeeds within 15-minute window (${delRes.statusCode})`);
      
      // Verify deleted from chat
      const reFetchRes = await request({ path: '/api/messages/history?channel=true&target=general' });
      const reMsgsData = JSON.parse(reFetchRes.body);
      const reMsgs = reMsgsData.messages || [];
      const isStillThere = reMsgs.some(m => m.id === createdMsgId);
      assert(!isStillThere, `Deleted message is completely purged from server response`);
    }

    // 7. Conversation History Continuity for Mukesh & Aadi
    console.log(`\n--- 7. Mukesh & Aadi Chat History Continuity ---`);
    const dmRes = await request({ path: '/api/messages/history?me=300354198&target=300363794' });
    assert(dmRes.statusCode === 200, `GET /api/messages/history?me=300354198&target=300363794 returns 200`);
    const dmData = JSON.parse(dmRes.body);
    const dmMessages = dmData.messages || [];
    console.log(`Total messages preserved between Mukesh & Aadi: ${dmMessages.length}`);
    assert(dmMessages.length > 0, `Chat history between Mukesh and Aadi is intact (${dmMessages.length} messages)`);

    // 8. Server-Sent Events (SSE) Stream Liveness
    console.log(`\n--- 8. Real-Time SSE Stream Verification ---`);
    const ssePromise = new Promise((resolve) => {
      const url = new URL('/api/stream?username=300354198', BASE_URL);
      const req = client.request({
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: { 'Accept': 'text/event-stream' }
      }, (res) => {
        let connected = (res.statusCode === 200);
        let contentType = res.headers['content-type'] || '';
        assert(connected, `SSE stream connects with HTTP 200`);
        assert(contentType.includes('text/event-stream'), `Content-Type is text/event-stream (${contentType})`);
        req.destroy();
        resolve(true);
      });
      req.on('error', (err) => {
        console.error('SSE Error:', err.message);
        resolve(false);
      });
      req.end();
    });
    await ssePromise;

  } catch (err) {
    console.error('Unexpected test error:', err);
    failed++;
  }

  console.log(`\n====================================================`);
  console.log(`📊 FINAL TEST REPORT SUMMARY:`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Score: ${Math.round((passed / (passed + failed)) * 100)}%`);
  console.log(`====================================================\n`);

  process.exit(failed === 0 ? 0 : 1);
}

runTests();
