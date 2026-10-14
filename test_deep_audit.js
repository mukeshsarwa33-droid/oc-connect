const https = require('https');
const http = require('http');

const BASE_URL = process.env.TEST_URL || 'https://oc-connect-1.onrender.com';
const isHttps = BASE_URL.startsWith('https');
const client = isHttps ? https : http;

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName} - ${details}`);
    failed++;
    failures.push({ testName, details });
  }
}

function req(path, method = 'GET', data = null, headers = {}) {
  return new Promise((resolve) => {
    try {
      const url = new URL(path, BASE_URL);
      const reqHeaders = { ...headers };
      let bodyData = null;
      if (data) {
        if (typeof data === 'object') {
          bodyData = JSON.stringify(data);
          reqHeaders['Content-Type'] = 'application/json';
        } else {
          bodyData = data;
        }
        reqHeaders['Content-Length'] = Buffer.byteLength(bodyData);
      }

      const request = client.request({
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: reqHeaders,
        timeout: 10000
      }, (res) => {
        let resBody = '';
        res.on('data', chunk => resBody += chunk);
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(resBody); } catch (_) {}
          resolve({ status: res.statusCode, headers: res.headers, raw: resBody, json: parsed });
        });
      });

      request.on('error', (err) => {
        resolve({ status: 0, headers: {}, raw: '', json: null, error: err.message });
      });

      request.on('timeout', () => {
        request.destroy();
        resolve({ status: 408, headers: {}, raw: '', json: null, error: 'Request timeout' });
      });

      if (bodyData) request.write(bodyData);
      request.end();
    } catch (e) {
      resolve({ status: 0, headers: {}, raw: '', json: null, error: e.message });
    }
  });
}

async function runDeepAudit() {
  console.log(`\n======================================================`);
  console.log(`🔍 RUNNING DEEP COMPREHENSIVE FEATURE AUDIT`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`======================================================\n`);

  // --- FEATURE 1: Authentication & OTP ---
  console.log(`\n[Feature 1: Authentication & OTP Security]`);
  {
    // Request OTP for student email
    const otpRes = await req('/api/auth/request-otp', 'POST', {
      email: 'audit_test@myokanagan.bc.ca',
      method: 'email',
      mode: 'signup'
    });
    assert(otpRes.status === 200, 'Request OTP for email returns 200', JSON.stringify(otpRes.json));
    assert(otpRes.json && otpRes.json.success, 'Request OTP response has success: true');

    // Reject invalid OTP code
    const badVerify = await req('/api/auth/verify-otp', 'POST', {
      identifier: 'audit_test@myokanagan.bc.ca',
      code: '000000'
    });
    assert(badVerify.status === 400 || badVerify.status === 401, 'Invalid OTP code is rejected (400/401)', badVerify.status);

    // Missing identifier rejection
    const emptyVerify = await req('/api/auth/verify-otp', 'POST', {
      code: '123456'
    });
    assert(emptyVerify.status === 400, 'Missing identifier rejected with 400', emptyVerify.status);
  }

  // --- FEATURE 2: User Profiles & Identity ---
  console.log(`\n[Feature 2: User Profiles & Identity]`);
  {
    const meRes = await req('/api/users/me?username=300354198');
    assert(meRes.status === 200, 'Fetch user profile returns 200', meRes.status);
    assert(meRes.json && meRes.json.user && meRes.json.user.username === '300354198', 'Profile has correct canonical username');
    assert(meRes.json && meRes.json.user.displayName === 'Mukesh S.', 'Profile has correct display name');

    // Update profile
    const updateRes = await req('/api/users/profile', 'POST', {
      username: '300354198',
      displayName: 'Mukesh S.',
      major: 'Computer Information Systems',
      campus: 'Kelowna Campus (KLO)',
      bio: 'CIS student at Okanagan College.'
    });
    assert(updateRes.status === 200, 'Update profile returns 200', updateRes.status);
    assert(updateRes.json && updateRes.json.success, 'Profile update returns success: true');

    // Verify Jeenu profile is non-demo real student
    const jeenuRes = await req('/api/users/me?username=jeenusarwa');
    assert(jeenuRes.status === 200, 'Fetch Jeenu profile returns 200');
    assert(jeenuRes.json && jeenuRes.json.user && jeenuRes.json.user.displayName === 'Jeenu Sarwa', 'Jeenu display name is Jeenu Sarwa');
    assert(jeenuRes.json.user.ocId === '300363795', 'Jeenu has real OC ID 300363795');

    // Verify Lucas profile is independent demo student
    const lucasRes = await req('/api/users/me?username=lucas_smi_oc');
    assert(lucasRes.status === 200, 'Fetch Lucas profile returns 200');
    assert(lucasRes.json && lucasRes.json.user.username === 'lucas_smi_oc', 'Lucas username is lucas_smi_oc');
  }

  // --- FEATURE 3: Messaging Engine & Rich Messages ---
  console.log(`\n[Feature 3: Messaging Engine & Rich Media]`);
  let testMsgId = null;
  {
    // Send 1-on-1 direct message
    const sendRes = await req('/api/messages/send', 'POST', {
      sender: '300354198',
      recipient: '300363794',
      text: 'Audit test message ' + Date.now()
    });
    assert(sendRes.status === 200, 'Send direct message returns 200', sendRes.status);
    assert(sendRes.json && sendRes.json.success && sendRes.json.message, 'Send message returns success and message object');
    testMsgId = sendRes.json && sendRes.json.message ? sendRes.json.message.id : null;

    // Send rich media: Study card
    const cardRes = await req('/api/messages/send', 'POST', {
      sender: '300354198',
      recipient: '300363794',
      text: 'Check this study card',
      studyCard: {
        topic: 'COSC 111',
        title: 'Binary Search Algorithm',
        content: 'O(log n) time complexity divide and conquer',
        tags: ['Computer Science', 'Algorithms']
      }
    });
    assert(cardRes.status === 200, 'Send study card message returns 200', cardRes.status);
    assert(cardRes.json && cardRes.json.message && cardRes.json.message.studyCard, 'Message contains studyCard payload');

    // Emoji reaction
    if (testMsgId) {
      const reactRes = await req('/api/messages/react', 'POST', {
        messageId: testMsgId,
        username: '300354198',
        emoji: '👍'
      });
      assert(reactRes.status === 200, 'Toggle emoji reaction returns 200', reactRes.status);
      assert(reactRes.json && reactRes.json.reactions, 'Reaction response contains reactions object');
    }

    // Message History
    const histRes = await req('/api/messages/history?me=300354198&target=300363794');
    assert(histRes.status === 200, 'Fetch message history returns 200');
    assert(histRes.json && Array.isArray(histRes.json.messages), 'History returns messages array');

    // Mark as read
    const readRes = await req('/api/messages/read', 'POST', {
      reader: '300363794',
      chatId: '300354198_300363794'
    });
    assert(readRes.status === 200, 'Mark messages as read returns 200', readRes.status);

    // Delete message (within 15-min window)
    if (testMsgId) {
      const delRes = await req('/api/messages/delete', 'POST', {
        messageId: testMsgId,
        username: '300354198'
      });
      assert(delRes.status === 200, 'Delete message within 15 min returns 200', delRes.status);
    }
  }

  // --- FEATURE 4: Starred Messages & Pinned Chats ---
  console.log(`\n[Feature 4: Starred Messages & Pinned Chats]`);
  {
    // Pin chat
    const pinRes = await req('/api/chats/pin', 'POST', {
      username: '300354198',
      chatKey: '300363794'
    });
    assert(pinRes.status === 200, 'Toggle pin chat returns 200', pinRes.status);

    // Get pinned chats
    const getPins = await req('/api/chats/pinned?username=300354198');
    assert(getPins.status === 200, 'Get pinned chats returns 200');
    assert(getPins.json && Array.isArray(getPins.json.pinned), 'Pinned chats returns array');

    // Star message
    const starRes = await req('/api/messages/star', 'POST', {
      username: '300354198',
      messageId: 'm1'
    });
    assert(starRes.status === 200, 'Star message returns 200', starRes.status);

    // Get starred messages
    const getStarred = await req('/api/messages/starred?username=300354198');
    assert(getStarred.status === 200, 'Get starred messages returns 200');
    assert(getStarred.json && Array.isArray(getStarred.json.starred), 'Starred messages returns array');
  }

  // --- FEATURE 5: Scheduled Messages ---
  console.log(`\n[Feature 5: Scheduled Messages]`);
  {
    const futureTime = Date.now() + 3600000;
    const schedRes = await req('/api/messages/schedule', 'POST', {
      sender: '300354198',
      recipient: '300363794',
      text: 'Automated study reminder for tomorrow',
      scheduledFor: futureTime
    });
    assert(schedRes.status === 200, 'Schedule future message returns 200', schedRes.status);
    assert(schedRes.json && schedRes.json.scheduledId, 'Scheduled message response contains scheduledId');

    const schedId = schedRes.json ? schedRes.json.scheduledId : null;

    // List scheduled messages
    const listSched = await req('/api/messages/scheduled?username=300354198');
    assert(listSched.status === 200, 'List scheduled messages returns 200');
    assert(listSched.json && Array.isArray(listSched.json.scheduled), 'Scheduled messages list returns array');

    // Cancel scheduled message
    if (schedId) {
      const cancelRes = await req('/api/messages/scheduled/cancel', 'POST', {
        id: schedId,
        username: '300354198'
      });
      assert(cancelRes.status === 200, 'Cancel scheduled message returns 200', cancelRes.status);
    }
  }

  // --- FEATURE 6: Campus Lounges & Groups ---
  console.log(`\n[Feature 6: Campus Lounges & Study Groups]`);
  {
    // List groups
    const listGroups = await req('/api/groups/list?username=300354198');
    assert(listGroups.status === 200, 'List groups returns 200');
    assert(listGroups.json && Array.isArray(listGroups.json.groups), 'Groups list returns array');
    assert(listGroups.json.groups.length > 0, `Campus groups exist (${listGroups.json.groups.length} found)`);

    // Group details
    const firstGroup = listGroups.json.groups[0];
    if (firstGroup) {
      const groupDet = await req(`/api/groups/details?groupId=${encodeURIComponent(firstGroup.id)}`);
      assert(groupDet.status === 200, `Fetch details for group ${firstGroup.name} returns 200`);
      assert(groupDet.json && Array.isArray(groupDet.json.members), 'Group contains member list');
    }

    // Send group message
    if (firstGroup) {
      const grpMsg = await req('/api/groups/message', 'POST', {
        groupId: firstGroup.id,
        sender: '300354198',
        text: 'Hello campus group! Audit check ' + Date.now()
      });
      assert(grpMsg.status === 200, 'Send group message returns 200', grpMsg.status);
    }
  }

  // --- FEATURE 7: Friends & Campus Trust Network ---
  console.log(`\n[Feature 7: Friends & Campus Trust Network]`);
  {
    // Check friend status
    const friendList = await req('/api/friends/list?username=300354198');
    assert(friendList.status === 200, 'Fetch friends list returns 200');
    assert(friendList.json && Array.isArray(friendList.json.friends), 'Friends list is array');

    // Toggle Trust
    const trustRes = await req('/api/friends/trust/toggle', 'POST', {
      truster: '300354198',
      trusted: 'jeenusarwa'
    });
    assert(trustRes.status === 200, 'Toggle trust returns 200', trustRes.status);
    assert(trustRes.json && typeof trustRes.json.isTrusted === 'boolean', 'Trust response returns isTrusted boolean');

    // Self friend request rejection check
    const selfReq = await req('/api/friends/request', 'POST', {
      from: '300354198',
      to: '300354198'
    });
    assert(selfReq.status === 400, 'Self friend request rejected with 400', selfReq.status);
  }

  // --- FEATURE 8: Safety & SOS Alert ---
  console.log(`\n[Feature 8: Campus Safety & SOS System]`);
  {
    const sosRes = await req('/api/sos/alert', 'POST', {
      username: '300354198',
      type: 'walk_safe',
      message: 'Walking from KLO Library to Student Residence'
    });
    assert(sosRes.status === 200, 'Broadcast SOS Walk Safe alert returns 200', sosRes.status);
    assert(sosRes.json && sosRes.json.success, 'SOS response returns success: true');

    // Fetch recent safety alerts
    const recentSos = await req('/api/sos/recent');
    assert(recentSos.status === 200, 'Fetch recent SOS alerts returns 200');
    assert(recentSos.json && Array.isArray(recentSos.json.alerts), 'Recent alerts returns array');
  }

  // --- FEATURE 9: WebRTC Voice Calls ---
  console.log(`\n[Feature 9: WebRTC Voice Calling]`);
  {
    const callRes = await req('/api/calls/initiate', 'POST', {
      caller: '300354198',
      recipient: '300363794'
    });
    assert(callRes.status === 200, 'Initiate voice call returns 200', callRes.status);
    assert(callRes.json && callRes.json.callId, 'Voice call returns unique callId');

    const callId = callRes.json ? callRes.json.callId : null;
    if (callId) {
      // End call
      const endRes = await req('/api/calls/end', 'POST', {
        callId: callId,
        username: '300354198'
      });
      assert(endRes.status === 200, 'End voice call returns 200', endRes.status);
    }
  }

  // --- FEATURE 10: PWA, Assets & Android APK ---
  console.log(`\n[Feature 10: PWA Assets & Standalone APK]`);
  {
    const manifestRes = await req('/manifest.json');
    assert(manifestRes.status === 200, 'Manifest /manifest.json returns 200');
    assert(manifestRes.json && (manifestRes.json.name.includes('OC Connect') || manifestRes.json.short_name === 'OC Connect'), 'Manifest has name "OC Connect"');

    const apkHead = await req('/oc-connect.apk', 'HEAD');
    assert(apkHead.status === 200, 'Standalone APK /oc-connect.apk is accessible (200)');
    const size = parseInt(apkHead.headers['content-length'] || '0', 10);
    assert(size > 500000, `APK size is verified (${Math.round(size / 1024)} KB)`);
  }

  // --- SUMMARY ---
  console.log(`\n======================================================`);
  console.log(`📊 AUDIT SUMMARY:`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  const pct = Math.round((passed / (passed + failed)) * 100);
  console.log(`Score: ${pct}%`);
  console.log(`======================================================\n`);

  if (failures.length > 0) {
    console.error(`Issues to fix:`, failures);
    process.exit(1);
  }
}

runDeepAudit().catch(err => {
  console.error('Audit fatal error:', err);
  process.exit(1);
});
