/**
 * OC Connect - System Integrity & Regression Prevention Test Suite
 * Validates:
 * 1. Canonical Identity & User Aliases Resolution
 * 2. Underscore-safe Direct Chat Partner Discovery (Relational Table)
 * 3. User Renaming & Instant Conversation Continuity
 * 4. Friend Request & Dual Parameter Lifecycle
 * 5. Voice Call Record Null-Safety
 */

const { DB, getDeterministicChatId } = require('./db.js');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  } else {
    passedTests++;
    console.log(`✅ PASSED: ${message}`);
  }
}

async function runTestSuite() {
  console.log('====================================================');
  console.log('🧪 Starting OC Connect System Integrity Test Suite...');
  console.log('====================================================\n');

  // Test 1: Canonical Identity & User Aliases
  console.log('--- Test 1: Canonical Identity & User Aliases ---');
  DB.setAlias('mukesh_test_alias', '300354198');
  assert(DB.getCanonicalUsername('mukesh_test_alias') === '300354198', 'Alias resolves to canonical student ID');
  assert(DB.getUserAliases('300354198').includes('mukesh_test_alias'), 'Canonical user lists registered alias');
  assert(DB.findUser('mukesh_test_alias') !== null, 'findUser resolves alias to active user record');

  // Test 2: Relational Chat Partners with Multi-Underscore Usernames
  console.log('\n--- Test 2: Relational Chat Partners (Multi-Underscore Safety) ---');
  const runId = Date.now().toString().slice(-6);
  const u1 = 'student_test_a_' + runId;
  const u2 = 'student_test_b_' + runId;
  DB.upsertUser({ username: u1, displayName: 'Test Alpha ' + runId, ocId: '30099' + runId });
  DB.upsertUser({ username: u2, displayName: 'Test Beta ' + runId, ocId: '30098' + runId });

  const chatId = getDeterministicChatId(u1, u2);
  DB.saveMessage({
    id: 'test_msg_' + Date.now(),
    chatId: chatId,
    sender: u1,
    recipient: u2,
    text: 'Hello test message with underscore usernames!'
  });

  const partnersA = DB.getDirectChatPartners(u1);
  const partnersB = DB.getDirectChatPartners(u2);
  assert(partnersA.includes(u2), `User A with underscores correctly sees Partner B (Found: ${partnersA.join(', ')})`);
  assert(partnersB.includes(u1), `User B with underscores correctly sees Partner A (Found: ${partnersB.join(', ')})`);

  // Test 3: User Renaming & Chat History Continuity
  console.log('\n--- Test 3: User Renaming & Chat History Continuity ---');
  const u1Renamed = 'student_renamed_' + runId;
  DB.renameUser(u1, u1Renamed, 'Test Renamed ' + runId);

  const partnersRenamed = DB.getDirectChatPartners(u1Renamed);
  const partnersBAfterRename = DB.getDirectChatPartners(u2);
  assert(partnersRenamed.includes(u2), 'Renamed user retains chat partner');
  assert(partnersBAfterRename.includes(u1Renamed), 'Partner B sees updated renamed username');

  const history = DB.getChatHistory(getDeterministicChatId(u1Renamed, u2));
  assert(history.length >= 1, `Chat history successfully migrated to new deterministic chat ID (Messages: ${history.length})`);

  // Test 4: Friend System Lifecycle
  console.log('\n--- Test 4: Friend System Lifecycle ---');
  const fa = 'friend_a_' + runId;
  const fb = 'friend_b_' + runId;
  DB.addFriend(fa, fb);
  assert(DB.isFriend(fa, fb) === true, 'Friendship created and verified (A -> B)');
  assert(DB.isFriend(fb, fa) === true, 'Friendship verified reversely (B -> A)');
  DB.removeFriend(fa, fb);
  assert(DB.isFriend(fa, fb) === false, 'Friendship removed cleanly');

  // Test 5: Call Record & Null-Safety Resilience
  console.log('\n--- Test 5: Voice Call Record & Null-Safety Resilience ---');
  const unknownCaller = DB.findUser('non_existent_student_handle');
  assert(unknownCaller === null, 'Unknown user lookup safely returns null');

  // Ensure saveMessage with call metadata executes cleanly without throwing
  const callMsg = DB.saveMessage({
    id: 'call_test_' + Date.now(),
    chatId: getDeterministicChatId('300354198', '300363794'),
    sender: '300354198',
    recipient: '300363794',
    text: '📞 Voice call • 1 min 24 sec',
    call: {
      callId: 'call_mock_123',
      action: 'completed',
      durationSeconds: 84,
      caller: '300354198',
      callee: '300363794'
    }
  });
  assert(callMsg && callMsg.call && callMsg.call.action === 'completed', 'Call message successfully recorded with metadata');

  console.log('\n====================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} INTEGRITY TESTS PASSED!`);
  console.log('====================================================\n');
}

runTestSuite().catch(err => {
  console.error('Test Suite encountered unhandled error:', err);
  process.exit(1);
});
