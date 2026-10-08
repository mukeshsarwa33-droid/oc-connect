// OC Connect Real-Time Client Application
// Okanagan College Student Peer Chat & Campus Safety

// Application State
const state = {
  currentUser: null,       // { ocId, username, displayName, major, avatarColor }
  currentChatTarget: null, // username or channel key
  isChannel: false,
  isGroup: false,
  currentGroupId: null,
  currentGroupInfo: null,
  groups: [],
  selectedCreateGroupMembers: new Set(),
  selectedGroupThemeColor: '#075E54',
  newGroupAvatarDataUrl: null,
  activeTab: 'chats',      // 'chats' | 'friends' | 'channels'
  friends: [],             // array of friend objects
  allStudents: [],         // array of all registered classmates
  incomingRequests: [],    // array of incoming friend request objects
  selectedFilter: 'all',   // 'all' | 'online' | 'klo' | 'tech'
  directorySearchQuery: '',
  chats: {},               // target -> array of messages
  eventSource: null,       // SSE connection
  reconnectTimer: null,
  chatSyncInterval: null,  // Active real-time loop when chat is open (700ms)
  homeSyncInterval: null,  // Background sync for home screen (3500ms)
  renderedMsgIds: new Set(), // Deduplication set for zero-flicker instant appends
  trustedUsersSet: new Set(), // Set of verified trusted usernames
  typingTimeout: null,
  isTypingActive: false,
  audioCtx: null,
  // Google Messages State
  inboxCategory: 'all',    // 'all' | 'unread' | 'personal' | 'groups' | 'starred'
  chatsSearchQuery: '',
  starredMessageIds: new Set(),
  pinnedChatKeys: new Set(),
  scheduledMessages: [],
  smartReplies: [],
  magicComposeStyle: 'formal',
  replyingTo: null,        // { id, sender, displayName, text } (Google Messages Quoted Reply)
  // Voice Recording state
  voiceRecorder: null,     // { mediaRecorder, audioChunks, timerInterval, seconds }
  currentlyPlayingAudio: null, // Currently playing HTMLAudioElement
  // Voice Call state
  activeCall: null,        // { callId, partner, role, status, timerInterval, seconds, isMuted }
  peerConnection: null,
  localCallStream: null,
  pendingSignals: [],
  sharedMediaFilter: 'photos',
  // Onboarding & One-Time OTP State
  authMode: 'login',          // 'login' | 'signup'
  authMethod: 'email',        // 'email' | 'phone_id'
  otpIdentifier: '',
  otpTimerInterval: null
};

// Safe Dynamic Public Tunnel Origin
function getAppPublicUrl() {
  if (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin.includes('trycloudflare.com')) {
    return window.location.origin;
  }
  return 'https://bridal-trim-optimal-organize.trycloudflare.com';
}

// ===========================================================================
// LOCAL DEVICE OFFLINE CHAT STORAGE ENGINE (WhatsApp / iMessage Style)
// ===========================================================================
function getOfflineStorageKey(subKey) {
  const user = state.currentUser ? state.currentUser.username : 'guest';
  return `oc_offline_${user}_${subKey}`;
}

function saveToOfflineCache(subKey, data) {
  try {
    localStorage.setItem(getOfflineStorageKey(subKey), JSON.stringify(data));
  } catch (e) {
    // LocalStorage quota safety
  }
}

function loadFromOfflineCache(subKey) {
  try {
    const raw = localStorage.getItem(getOfflineStorageKey(subKey));
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

// DOM Elements
const el = {
  toastContainer: document.getElementById('toast-container'),
  authScreen: document.getElementById('auth-screen'),
  // Auth Elements (One-Time OTP & Persistent Session)
  authTabLogin: document.getElementById('auth-tab-login'),
  authTabSignup: document.getElementById('auth-tab-signup'),
  methodBtnEmail: document.getElementById('method-btn-email'),
  methodBtnPhone: document.getElementById('method-btn-phone'),
  authRequestForm: document.getElementById('auth-request-form'),
  sectionEmailInput: document.getElementById('section-email-input'),
  sectionPhoneInput: document.getElementById('section-phone-input'),
  authEmailInput: document.getElementById('auth-email-input'),
  authPhoneInput: document.getElementById('auth-phone-input'),
  authOcIdInput: document.getElementById('auth-ocid-input'),
  authSignupFields: document.getElementById('auth-signup-fields'),
  authFullNameInput: document.getElementById('auth-fullname-input'),
  authSignupUsernameInput: document.getElementById('auth-signup-username-input'),
  authMajorInput: document.getElementById('auth-major-input'),
  btnRequestOtp: document.getElementById('btn-request-otp'),
  btnRequestOtpText: document.getElementById('btn-request-otp-text'),
  authOtpForm: document.getElementById('auth-otp-form'),
  btnBackToRequest: document.getElementById('btn-back-to-request'),
  otpDestinationLabel: document.getElementById('otp-destination-label'),
  authOtpCodeInput: document.getElementById('auth-otp-code-input'),
  authQuickFillChip: document.getElementById('auth-quick-fill-chip'),
  quickFillCodeVal: document.getElementById('quick-fill-code-val'),
  otpTimerDisplay: document.getElementById('otp-timer-display'),
  btnResendOtp: document.getElementById('btn-resend-otp'),
  btnVerifyOtp: document.getElementById('btn-verify-otp'),
  mainScreen: document.getElementById('main-screen'),
  // Google Messages Inbox Elements
  chatsSearchInput: document.getElementById('chats-search-input'),
  inboxCategoriesBar: document.getElementById('inbox-categories-bar'),
  btnOpenStarredInbox: document.getElementById('btn-open-starred-inbox'),
  // Group Elements
  btnOpenCreateGroup: document.getElementById('btn-open-create-group'),
  btnQuickNewChat: document.getElementById('btn-quick-new-chat'),
  modalCreateGroup: document.getElementById('modal-create-group'),
  btnCloseCreateGroup: document.getElementById('btn-close-create-group'),
  btnSubmitCreateGroup: document.getElementById('btn-submit-create-group'),
  btnCreateGroupConfirm: document.getElementById('btn-create-group-confirm'),
  newGroupNameInput: document.getElementById('new-group-name-input'),
  newGroupDescInput: document.getElementById('new-group-desc-input'),
  newGroupAvatarPreview: document.getElementById('new-group-avatar-preview'),
  newGroupAvatarFile: document.getElementById('new-group-avatar-file'),
  groupThemeColors: document.getElementById('group-theme-colors'),
  createGroupChipsTray: document.getElementById('create-group-chips-tray'),
  createGroupSelectedCount: document.getElementById('create-group-selected-count'),
  createGroupSearchInput: document.getElementById('create-group-search-input'),
  createGroupClassmatesList: document.getElementById('create-group-classmates-list'),
  groupNameCounter: document.getElementById('group-name-counter'),
  modalGroupInfo: document.getElementById('modal-group-info'),
  btnCloseGroupInfo: document.getElementById('btn-close-group-info'),
  btnGroupInfoEdit: document.getElementById('btn-group-info-edit'),
  groupInfoAvatarHero: document.getElementById('group-info-avatar-hero'),
  groupInfoAvatarText: document.getElementById('group-info-avatar-text'),
  groupInfoName: document.getElementById('group-info-name'),
  groupInfoMeta: document.getElementById('group-info-meta'),
  groupInfoCreatedBy: document.getElementById('group-info-created-by'),
  groupInfoDescText: document.getElementById('group-info-desc-text'),
  btnOpenAddParticipants: document.getElementById('btn-open-add-participants'),
  btnCopyGroupLink: document.getElementById('btn-copy-group-link'),
  groupInfoParticipantsCount: document.getElementById('group-info-participants-count'),
  groupInfoAdminBadgeCount: document.getElementById('group-info-admin-badge-count'),
  groupInfoParticipantsList: document.getElementById('group-info-participants-list'),
  btnExitGroup: document.getElementById('btn-exit-group'),
  btnDeleteGroup: document.getElementById('btn-delete-group'),
  modalAddGroupMembers: document.getElementById('modal-add-group-members'),
  btnCloseAddMembers: document.getElementById('btn-close-add-members'),
  btnSubmitAddMembers: document.getElementById('btn-submit-add-members'),
  addMembersSearchInput: document.getElementById('add-members-search-input'),
  addMembersClassmatesList: document.getElementById('add-members-classmates-list'),
  currentUserAvatar: document.getElementById('current-user-avatar'),
  currentUserHandle: document.getElementById('current-user-handle'),
  connectionStatus: document.getElementById('connection-status'),
  tabButtons: document.querySelectorAll('.tab-btn'),
  tabChats: document.getElementById('tab-chats'),
  tabFriends: document.getElementById('tab-friends'),
  tabChannels: document.getElementById('tab-channels'),
  chatsList: document.getElementById('chats-list'),
  chatsBadge: document.getElementById('chats-badge'),
  // Chat View Elements
  chatScreen: document.getElementById('chat-screen'),
  chatPartnerAvatar: document.getElementById('chat-partner-avatar'),
  chatPartnerTitle: document.getElementById('chat-partner-title'),
  chatPartnerSubtitle: document.getElementById('chat-partner-subtitle'),
  partnerBlueTick: document.getElementById('partner-blue-tick'),
  chatHeaderPartnerClick: document.getElementById('chat-header-partner-click'),
  btnChatStarred: document.getElementById('btn-chat-starred'),
  messagesContainer: document.getElementById('messages-container'),
  scheduledMessagesBanner: document.getElementById('scheduled-messages-banner'),
  scheduledBannerText: document.getElementById('scheduled-banner-text'),
  btnViewScheduledMessages: document.getElementById('btn-view-scheduled-messages'),
  smartRepliesBar: document.getElementById('smart-replies-bar'),
  smartRepliesChips: document.getElementById('smart-replies-chips'),
  // Google Messages Quoted Reply & Reactions
  replyPreviewBar: document.getElementById('reply-preview-bar'),
  replyPreviewSender: document.getElementById('reply-preview-sender'),
  replyPreviewSnippet: document.getElementById('reply-preview-snippet'),
  btnCancelReply: document.getElementById('btn-cancel-reply'),
  reactionPopover: document.getElementById('reaction-popover'),
  popoverBtnReply: document.getElementById('popover-btn-reply'),
  popoverBtnStar: document.getElementById('popover-btn-star'),
  popoverBtnCopy: document.getElementById('popover-btn-copy'),
  screenEffectsCanvas: document.getElementById('screen-effects-canvas'),
  messageInputBox: document.getElementById('message-input-box'),
  messageTextInput: document.getElementById('message-text-input'),
  btnSendMessage: document.getElementById('btn-send-message'),
  btnAttachFile: document.getElementById('btn-attach-file'),
  btnMagicCompose: document.getElementById('btn-magic-compose'),
  attachOptSchedule: document.getElementById('attach-opt-schedule'),
  attachOptMagicCompose: document.getElementById('attach-opt-magic-compose'),
  universalFileInput: document.getElementById('universal-file-input'),
  friendsList: document.getElementById('friends-list'),
  campusDirectoryList: document.getElementById('campus-directory-list'),
  friendRequestsContainer: document.getElementById('friend-requests-container'),
  friendRequestsList: document.getElementById('friend-requests-list'),
  requestsBadge: document.getElementById('requests-badge'),
  friendsRequestsTabBadge: document.getElementById('friends-requests-tab-badge'),
  myFriendsCount: document.getElementById('my-friends-count'),
  totalStudentsCount: document.getElementById('total-students-count'),
  filterChipsBar: document.getElementById('filter-chips-bar'),
  noChatsPlaceholder: document.getElementById('no-chats-placeholder'),
  noFriendsPlaceholder: document.getElementById('no-friends-placeholder'),
  friendsOnlineCount: document.getElementById('friends-online-count'),
  friendsFilterInput: document.getElementById('friends-filter-input'),
  // Chat View
  chatScreen: document.getElementById('chat-screen'),
  chatPartnerAvatar: document.getElementById('chat-partner-avatar'),
  chatPartnerTitle: document.getElementById('chat-partner-title'),
  chatPartnerSubtitle: document.getElementById('chat-partner-subtitle'),
  partnerBlueTick: document.getElementById('partner-blue-tick'),
  chatHeaderPartnerClick: document.getElementById('chat-header-partner-click'),
  offlineChatBanner: document.getElementById('offline-chat-banner'),
  messagesContainer: document.getElementById('messages-container'),
  messageInputBox: document.getElementById('message-input-box'),
  messageTextInput: document.getElementById('message-text-input'),
  btnSendMessage: document.getElementById('btn-send-message'),
  btnAttachFile: document.getElementById('btn-attach-file'),
  universalFileInput: document.getElementById('universal-file-input'),
  btnVoiceRecord: document.getElementById('btn-voice-record'),
  voiceRecordingBar: document.getElementById('voice-recording-bar'),
  recordingTimer: document.getElementById('recording-timer'),
  btnCancelRecording: document.getElementById('btn-cancel-recording'),
  btnSendRecording: document.getElementById('btn-send-recording'),
  btnBackToHome: document.getElementById('btn-back-to-home'),
  btnStartCall: document.getElementById('btn-start-call'),
  btnCallSecurity: document.getElementById('btn-call-security'),
  btnToggleChatSearch: document.getElementById('btn-toggle-chat-search'),
  btnChatMediaHub: document.getElementById('btn-chat-media-hub'),
  inChatSearchBar: document.getElementById('in-chat-search-bar'),
  inChatSearchInput: document.getElementById('in-chat-search-input'),
  chatSearchCount: document.getElementById('chat-search-count'),
  btnChatSearchPrev: document.getElementById('btn-chat-search-prev'),
  btnChatSearchNext: document.getElementById('btn-chat-search-next'),
  btnCloseChatSearch: document.getElementById('btn-close-chat-search'),
  pinnedMessagesBanner: document.getElementById('pinned-messages-banner'),
  pinnedBannerSender: document.getElementById('pinned-banner-sender'),
  pinnedBannerText: document.getElementById('pinned-banner-text'),
  btnUnpinCurrentMsg: document.getElementById('btn-unpin-current-msg'),
  // Modals & Floating Buttons
  fabAddFriend: document.getElementById('fab-add-friend'),
  fabSos: document.getElementById('fab-sos'),
  btnShareApp: document.getElementById('btn-share-app'),
  btnLogout: document.getElementById('btn-logout'),
  modalAddFriend: document.getElementById('modal-add-friend'),
  btnCloseAddModal: document.getElementById('btn-close-add-modal'),
  addFriendInput: document.getElementById('add-friend-input'),
  btnSubmitAddFriend: document.getElementById('btn-submit-add-friend'),
  searchResultsList: document.getElementById('search-results-list'),
  modalSos: document.getElementById('modal-sos'),
  btnCloseSosModal: document.getElementById('btn-close-sos-modal'),
  btnTriggerSos: document.getElementById('btn-trigger-sos'),
  btnWalkMeHome: document.getElementById('btn-walk-me-home'),
  modalShare: document.getElementById('modal-share'),
  btnCloseShareModal: document.getElementById('btn-close-share-modal'),
  shareLinkInput: document.getElementById('share-link-input'),
  btnCopyShareLink: document.getElementById('btn-copy-share-link'),
  btnEmptyAddFriend: document.getElementById('btn-empty-add-friend'),
  // Call Modals
  modalIncomingCall: document.getElementById('modal-incoming-call'),
  callerAvatar: document.getElementById('caller-avatar'),
  callerName: document.getElementById('caller-name'),
  btnDeclineCall: document.getElementById('btn-decline-call'),
  btnAcceptCall: document.getElementById('btn-accept-call'),
  modalActiveCall: document.getElementById('modal-active-call'),
  activeCallAvatar: document.getElementById('active-call-avatar'),
  activeCallName: document.getElementById('active-call-name'),
  activeCallStatus: document.getElementById('active-call-status'),
  activeCallTimer: document.getElementById('active-call-timer'),
  btnToggleMute: document.getElementById('btn-toggle-mute'),
  muteLabel: document.getElementById('mute-label'),
  btnEndCall: document.getElementById('btn-end-call'),
  remoteCallAudio: document.getElementById('remote-call-audio'),
  // Contact Profile & Shared Media
  modalContactProfile: document.getElementById('modal-contact-profile'),
  btnCloseProfileModal: document.getElementById('btn-close-profile-modal'),
  profileModalAvatar: document.getElementById('profile-modal-avatar'),
  profileModalName: document.getElementById('profile-modal-name'),
  profileModalBadge: document.getElementById('profile-modal-badge'),
  profileModalHandle: document.getElementById('profile-modal-handle'),
  profileModalStatus: document.getElementById('profile-modal-status'),
  profileBtnMessage: document.getElementById('profile-btn-message'),
  profileBtnCall: document.getElementById('profile-btn-call'),
  profileBtnToggleTrust: document.getElementById('profile-btn-toggle-trust'),
  profileTrustLabel: document.getElementById('profile-trust-label'),
  profileModalMajor: document.getElementById('profile-modal-major'),
  profileModalCampus: document.getElementById('profile-modal-campus'),
  profileModalTrustStatus: document.getElementById('profile-modal-trust-status'),
  profileMediaCountBadge: document.getElementById('profile-media-count-badge'),
  profileSharedMediaGrid: document.getElementById('profile-shared-media-grid'),
  profileSharedFilesList: document.getElementById('profile-shared-files-list'),
  profileNoMediaHint: document.getElementById('profile-no-media-hint'),
  // Lightbox
  modalImageLightbox: document.getElementById('modal-image-lightbox'),
  btnCloseLightbox: document.getElementById('btn-close-lightbox'),
  lightboxImage: document.getElementById('lightbox-image'),
  // Campus Weather Elements (Open-Meteo API)
  btnCampusWeather: document.getElementById('btn-campus-weather'),
  weatherIcon: document.getElementById('weather-icon'),
  weatherTemp: document.getElementById('weather-temp'),
  modalCampusWeather: document.getElementById('modal-campus-weather'),
  btnCloseWeatherModal: document.getElementById('btn-close-weather-modal'),
  weatherDetailEmoji: document.getElementById('weather-detail-emoji'),
  weatherDetailTemp: document.getElementById('weather-detail-temp'),
  weatherDetailCondition: document.getElementById('weather-detail-condition'),
  weatherDetailCampus: document.getElementById('weather-detail-campus'),
  weatherDetailHumidity: document.getElementById('weather-detail-humidity'),
  weatherDetailWind: document.getElementById('weather-detail-wind'),
  weatherDetailAdvice: document.getElementById('weather-detail-advice'),
  btnShareWeatherChat: document.getElementById('btn-share-weather-chat'),
  // Classmate QR Code Connect Elements (QR Server API)
  btnMyQr: document.getElementById('btn-my-qr'),
  modalQrCode: document.getElementById('modal-qr-code'),
  btnCloseQrModal: document.getElementById('btn-close-qr-modal'),
  myQrImage: document.getElementById('my-qr-image'),
  qrDisplayName: document.getElementById('qr-display-name'),
  qrHandle: document.getElementById('qr-handle'),
  btnCopyQrLink: document.getElementById('btn-copy-qr-link'),
  // Study Tools Elements (Wikipedia, Dictionary, Currency, Locations, Advice, Books, Jokes)
  btnStudyTools: document.getElementById('btn-study-tools'),
  modalStudyTools: document.getElementById('modal-study-tools'),
  btnCloseStudyModal: document.getElementById('btn-close-study-modal'),
  dictSearchInput: document.getElementById('dict-search-input'),
  btnSubmitDict: document.getElementById('btn-submit-dict'),
  dictResultPreview: document.getElementById('dict-result-preview'),
  wikiSearchInput: document.getElementById('wiki-search-input'),
  btnSubmitWiki: document.getElementById('btn-submit-wiki'),
  wikiResultPreview: document.getElementById('wiki-result-preview'),
  currAmountInput: document.getElementById('curr-amount-input'),
  currFromSelect: document.getElementById('curr-from-select'),
  currToSelect: document.getElementById('curr-to-select'),
  btnSubmitConvert: document.getElementById('btn-submit-convert'),
  currResultPreview: document.getElementById('curr-result-preview'),
  campusPinsList: document.getElementById('campus-pins-list'),
  bookSearchInput: document.getElementById('book-search-input'),
  btnSubmitBook: document.getElementById('btn-submit-book'),
  bookResultPreview: document.getElementById('book-result-preview'),
  btnGetAdvice: document.getElementById('btn-get-advice'),
  adviceResultPreview: document.getElementById('advice-result-preview'),
  btnGetJoke: document.getElementById('btn-get-joke'),
  jokeResultPreview: document.getElementById('joke-result-preview'),
  // Document & Book Viewer Modal Elements
  modalDocumentViewer: document.getElementById('modal-document-viewer'),
  btnCloseDocViewer: document.getElementById('btn-close-doc-viewer'),
  docViewerTitle: document.getElementById('doc-viewer-title'),
  btnDocDownloadHeader: document.getElementById('btn-doc-download-header'),
  docMetaIcon: document.getElementById('doc-meta-icon'),
  docMetaName: document.getElementById('doc-meta-name'),
  docMetaSize: document.getElementById('doc-meta-size'),
  btnDocOpenExternal: document.getElementById('btn-doc-open-external'),
  btnDocDownloadDirect: document.getElementById('btn-doc-download-direct'),
  docPreviewContainer: document.getElementById('doc-preview-container'),
  docPreviewIframe: document.getElementById('doc-preview-iframe'),
  // Article & Study Book Reader Modal Elements
  modalArticleReader: document.getElementById('modal-article-reader'),
  btnCloseArticleReader: document.getElementById('btn-close-article-reader'),
  articleReaderTypeTitle: document.getElementById('article-reader-type-title'),
  articleReaderBadge: document.getElementById('article-reader-badge'),
  articleReaderTitle: document.getElementById('article-reader-title'),
  articleReaderByline: document.getElementById('article-reader-byline'),
  articleReaderText: document.getElementById('article-reader-text'),
  btnArticleOpenSource: document.getElementById('btn-article-open-source'),
  articleOpenSourceLabel: document.getElementById('article-open-source-label'),
  btnArticleCopyText: document.getElementById('btn-article-copy-text'),
  // Dynamic Island In-App Notification Banner
  inappNotificationBanner: document.getElementById('inapp-notification-banner'),
  inappBannerAvatar: document.getElementById('inapp-banner-avatar'),
  inappBannerTitle: document.getElementById('inapp-banner-title'),
  inappBannerText: document.getElementById('inapp-banner-text'),
  // Profile Safety Actions (Unfriend & Block)
  profileBtnUnfriend: document.getElementById('profile-btn-unfriend'),
  profileBtnBlock: document.getElementById('profile-btn-block'),
  profileBlockLabel: document.getElementById('profile-block-label'),
  // Notifications & Alerts Settings
  togglePushNotifications: document.getElementById('toggle-push-notifications'),
  toggleNotificationSound: document.getElementById('toggle-notification-sound'),
  toggleHapticVibration: document.getElementById('toggle-haptic-vibration'),
  toggleMessagePreviews: document.getElementById('toggle-message-previews'),
  settingsBlockedList: document.getElementById('settings-blocked-list'),
  settingsBlockedCount: document.getElementById('settings-blocked-count'),
  btnGenerateAvatar: document.getElementById('btn-generate-avatar'),
  // PWA & Mobile Installation Elements (Android & iOS)
  btnInstallApp: document.getElementById('btn-install-app'),
  modalInstallApp: document.getElementById('modal-install-app'),
  btnCloseInstallModal: document.getElementById('btn-close-install-modal'),
  btnSettingsInstallApp: document.getElementById('btn-settings-install-app'),
  btnCopyInstallLink: document.getElementById('btn-copy-install-link'),
  btnTriggerAndroidPwa: document.getElementById('btn-trigger-android-pwa'),
  // Google Messages Modals
  modalMagicCompose: document.getElementById('modal-magic-compose'),
  btnCloseMagicCompose: document.getElementById('btn-close-magic-compose'),
  btnApplyMagicCompose: document.getElementById('btn-apply-magic-compose'),
  magicComposeInput: document.getElementById('magic-compose-input'),
  magicComposeOutput: document.getElementById('magic-compose-output'),
  magicOutputBadge: document.getElementById('magic-output-badge'),
  btnCopyMagicCompose: document.getElementById('btn-copy-magic-compose'),
  btnSendMagicNow: document.getElementById('btn-send-magic-now'),
  modalScheduleMessage: document.getElementById('modal-schedule-message'),
  btnCloseScheduleModal: document.getElementById('btn-close-schedule-modal'),
  scheduleDraftPreview: document.getElementById('schedule-draft-preview'),
  presetLaterToday: document.getElementById('preset-later-today'),
  presetTomorrowMorning: document.getElementById('preset-tomorrow-morning'),
  presetTomorrowAfternoon: document.getElementById('preset-tomorrow-afternoon'),
  customScheduleDatetime: document.getElementById('custom-schedule-datetime'),
  btnSubmitCustomSchedule: document.getElementById('btn-submit-custom-schedule'),
  modalStarredMessages: document.getElementById('modal-starred-messages'),
  btnCloseStarredModal: document.getElementById('btn-close-starred-modal'),
  starredSearchInput: document.getElementById('starred-search-input'),
  starredMessagesList: document.getElementById('starred-messages-list'),
  noStarredPlaceholder: document.getElementById('no-starred-placeholder'),
  modalViewScheduled: document.getElementById('modal-view-scheduled'),
  btnCloseViewScheduled: document.getElementById('btn-close-view-scheduled'),
  viewScheduledList: document.getElementById('view-scheduled-list'),
  modalChatMediaHub: document.getElementById('modal-chat-media-hub'),
  btnCloseMediaHub: document.getElementById('btn-close-media-hub')
};

// Web Audio Synthesizer for Authentic WhatsApp Sounds
function initAudio() {
  if (!state.audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      state.audioCtx = new AudioContext();
    }
  }
}

function playSentSound() {
  try {
    initAudio();
    if (!state.audioCtx) return;
    if (state.audioCtx.state === 'suspended') state.audioCtx.resume();

    const osc = state.audioCtx.createOscillator();
    const gain = state.audioCtx.createGain();
    osc.type = 'sine';
    const now = state.audioCtx.currentTime;

    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(450, now + 0.08);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(gain);
    gain.connect(state.audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.08);
  } catch (_) {}
}

function playReceivedSound() {
  try {
    initAudio();
    if (!state.audioCtx) return;
    if (state.audioCtx.state === 'suspended') state.audioCtx.resume();

    const now = state.audioCtx.currentTime;

    const osc1 = state.audioCtx.createOscillator();
    const gain1 = state.audioCtx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(659.25, now); // E5
    gain1.gain.setValueAtTime(0.2, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
    osc1.connect(gain1);
    gain1.connect(state.audioCtx.destination);
    osc1.start(now);
    osc1.stop(now + 0.12);

    const osc2 = state.audioCtx.createOscillator();
    const gain2 = state.audioCtx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.08); // A5
    gain2.gain.setValueAtTime(0.25, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc2.connect(gain2);
    gain2.connect(state.audioCtx.destination);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.28);
  } catch (_) {}
}

function playRingtoneSound() {
  try {
    initAudio();
    if (!state.audioCtx) return;
    if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
    const now = state.audioCtx.currentTime;
    const osc1 = state.audioCtx.createOscillator();
    const osc2 = state.audioCtx.createOscillator();
    const gain = state.audioCtx.createGain();
    osc1.frequency.setValueAtTime(440, now);
    osc2.frequency.setValueAtTime(480, now);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(state.audioCtx.destination);
    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.8);
    osc2.stop(now + 0.8);
  } catch (_) {}
}

function playCallConnectedSound() {
  try {
    initAudio();
    if (!state.audioCtx) return;
    if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
    const now = state.audioCtx.currentTime;
    const osc = state.audioCtx.createOscillator();
    const gain = state.audioCtx.createGain();
    osc.frequency.setValueAtTime(523.25, now);
    osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.15);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
    osc.connect(gain);
    gain.connect(state.audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  } catch (_) {}
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getFileIcon(filename) {
  if (!filename) return '📎';
  const ext = filename.split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return '🖼️';
  if (['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(ext)) return '🎥';
  if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) return '🎵';
  if (['pdf'].includes(ext)) return '📑';
  if (['doc', 'docx', 'txt', 'rtf'].includes(ext)) return '📄';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
  if (['ppt', 'pptx'].includes(ext)) return '📽️';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '📦';
  if (['js', 'ts', 'py', 'java', 'c', 'cpp', 'html', 'css', 'json'].includes(ext)) return '💻';
  return '📎';
}

function formatAudioDuration(secs) {
  const s = Math.floor(secs || 0);
  const m = Math.floor(s / 60);
  const remainingSecs = s % 60;
  return `${m}:${remainingSecs < 10 ? '0' : ''}${remainingSecs}`;
}

const twitterTickSvg = `<svg class="twitter-blue-tick" viewBox="0 0 22 22" width="16" height="16" title="Verified Trusted Classmate"><path fill="#1D9BF0" d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.246-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.136 2.136 5.864-5.864 1.293 1.302-7.157 7.156z"/></svg>`;

// Toast Notifications
function showToast(message, icon = 'ℹ️') {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  el.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Format Timestamp (e.g. 10:45 AM or Oct 7)
function formatTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Fluid Modal Animation Helpers
function openModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.remove('hidden');
  requestAnimationFrame(() => {
    modalEl.classList.add('active');
  });
}

function closeModal(modalEl) {
  if (!modalEl) return;
  if (modalEl === el.modalDocumentViewer && el.docPreviewIframe) {
    el.docPreviewIframe.src = 'about:blank';
  }
  modalEl.classList.remove('active');
  setTimeout(() => {
    if (!modalEl.classList.contains('active')) {
      modalEl.classList.add('hidden');
    }
  }, 260);
}

// Convert Base64 Data URL to Blob for reliable browser rendering & downloading
function dataUrlToBlob(dataUrl, defaultType = 'application/octet-stream') {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const parts = dataUrl.split(',');
  if (parts.length < 2) return null;
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime = (mimeMatch && mimeMatch[1]) ? mimeMatch[1] : defaultType;
  try {
    const bstr = atob(parts[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  } catch (err) {
    console.error('Failed to parse data URL to Blob:', err);
    return null;
  }
}

// Open or Download Attachment (PDFs, eBooks, Articles, Documents)
function openOrDownloadAttachment(file, msgId, forceDownload = false) {
  if (!file) {
    showToast('Attachment not found', '⚠️');
    return;
  }

  const fName = file.name || 'Attachment';
  const fType = file.type || '';
  const ext = (fName.split('.').pop() || '').toLowerCase();
  const isPdf = ext === 'pdf' || fType.includes('pdf');
  const isText = ['txt', 'csv', 'json', 'md', 'html', 'js', 'py', 'ts', 'log'].includes(ext) || fType.startsWith('text/');

  // Canonical HTTP streaming endpoint on server
  const canonicalUrl = (msgId && !String(msgId).startsWith('temp_'))
    ? `/api/files/${encodeURIComponent(msgId)}`
    : null;

  // Local Blob URL
  let blobUrl = null;
  if (file.data && typeof file.data === 'string' && file.data.startsWith('data:')) {
    const blob = dataUrlToBlob(file.data, fType || 'application/octet-stream');
    if (blob) {
      blobUrl = URL.createObjectURL(blob);
    }
  }

  const downloadUrl = canonicalUrl ? `${canonicalUrl}?download=1` : blobUrl;
  const viewUrl = canonicalUrl || blobUrl;

  if (forceDownload) {
    if (downloadUrl) {
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = fName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 500);
      showToast(`Saving "${fName}"...`, '💾');
      return;
    }
    showToast('Could not download file', '⚠️');
    return;
  }

  // Populate In-App Document & Book Viewer Modal
  if (el.docViewerTitle) el.docViewerTitle.textContent = fName;
  if (el.docMetaName) el.docMetaName.textContent = fName;
  if (el.docMetaSize) el.docMetaSize.textContent = `${formatBytes(file.size)} • ${ext.toUpperCase() || 'DOCUMENT'}`;
  if (el.docMetaIcon) el.docMetaIcon.textContent = getFileIcon(fName);

  const doDownload = () => {
    if (downloadUrl) {
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = fName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 500);
      showToast(`Downloading "${fName}"...`, '💾');
    } else {
      showToast('Download link unavailable', '⚠️');
    }
  };

  if (el.btnDocDownloadDirect) el.btnDocDownloadDirect.onclick = doDownload;
  if (el.btnDocDownloadHeader) el.btnDocDownloadHeader.onclick = doDownload;

  if (el.btnDocOpenExternal) {
    el.btnDocOpenExternal.onclick = () => {
      if (viewUrl) {
        window.open(viewUrl, '_blank');
      } else {
        showToast('Preview link unavailable', '⚠️');
      }
    };
  }

  // Embedded Preview iframe for PDFs and text documents
  if (el.docPreviewContainer && el.docPreviewIframe) {
    if ((isPdf || isText) && viewUrl) {
      el.docPreviewContainer.classList.remove('hidden');
      el.docPreviewIframe.src = viewUrl;
    } else {
      el.docPreviewContainer.classList.add('hidden');
      el.docPreviewIframe.src = 'about:blank';
    }
  }

  openModal(el.modalDocumentViewer);
}

// Open In-App Article & Study Book Reader Modal (Wikipedia articles & Open Library books)
function openStudyCardReader(sc) {
  if (!sc) return;
  const isBook = sc.type === 'book';

  if (el.articleReaderTypeTitle) {
    el.articleReaderTypeTitle.textContent = isBook ? 'Open Library Book' : 'Study Article';
  }
  if (el.articleReaderBadge) {
    el.articleReaderBadge.textContent = isBook ? 'Open Library 📚' : 'Wikipedia 📖';
    el.articleReaderBadge.className = `article-reader-badge ${isBook ? 'badge-book' : 'badge-wiki'}`;
  }
  if (el.articleReaderTitle) {
    el.articleReaderTitle.textContent = sc.title || 'Untitled';
  }

  if (el.articleReaderByline) {
    if (isBook) {
      el.articleReaderByline.textContent = `By ${sc.author || 'Unknown Author'} • Published ${sc.year || 'N/A'}`;
      el.articleReaderByline.classList.remove('hidden');
    } else {
      el.articleReaderByline.textContent = 'Wikipedia • The Free Encyclopedia';
      el.articleReaderByline.classList.remove('hidden');
    }
  }

  if (el.articleReaderText) {
    if (isBook) {
      el.articleReaderText.innerHTML = `
        <p style="margin-bottom:12px;font-size:15px;line-height:1.6;color:var(--text-dark);">
          <strong>${escapeHtml(sc.title || '')}</strong> is an open-access book cataloged by Open Library and the Internet Archive.
        </p>
        <div style="background:#F2F2F7;border-radius:14px;padding:14px;font-size:13.5px;color:var(--text-medium);line-height:1.6;">
          📖 <strong>Title:</strong> ${escapeHtml(sc.title || '')}<br/>
          ✍️ <strong>Author:</strong> ${escapeHtml(sc.author || 'Unknown')}<br/>
          📅 <strong>First Published:</strong> ${escapeHtml(String(sc.year || 'N/A'))}<br/>
          🏛️ <strong>Digital Archive:</strong> Open Library
        </div>
      `;
    } else {
      el.articleReaderText.innerHTML = `
        <p style="font-size:15px;line-height:1.65;color:var(--text-dark);">
          ${escapeHtml(sc.extract || 'No article extract available.')}
        </p>
      `;
    }
  }

  if (el.articleOpenSourceLabel) {
    el.articleOpenSourceLabel.textContent = isBook ? 'Open in Open Library ↗' : 'Read Full Wikipedia Article ↗';
  }

  if (el.btnArticleOpenSource) {
    el.btnArticleOpenSource.onclick = () => {
      if (sc.url) {
        window.open(sc.url, '_blank', 'noopener,noreferrer');
      } else {
        showToast('Source link unavailable', '⚠️');
      }
    };
  }

  if (el.btnArticleCopyText) {
    el.btnArticleCopyText.onclick = () => {
      const textToCopy = isBook
        ? `${sc.title} by ${sc.author} (${sc.year})\n${sc.url || ''}`
        : `${sc.title}\n\n${sc.extract || ''}\n\nSource: ${sc.url || ''}`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(textToCopy).then(() => {
          showToast('Article text copied! 📋', '✅');
        }).catch(() => {
          showToast('Could not copy text', '⚠️');
        });
      } else {
        showToast('Clipboard not supported', '⚠️');
      }
    };
  }

  openModal(el.modalArticleReader);
}

// Auto-expanding Input & Smooth Button Morphing
function updateInputState() {
  if (!el.messageTextInput) return;
  el.messageTextInput.style.height = 'auto';
  const newHeight = Math.min(el.messageTextInput.scrollHeight, 110);
  el.messageTextInput.style.height = (newHeight > 22 ? newHeight : 22) + 'px';

  const hasText = el.messageTextInput.value.trim().length > 0;
  if (hasText) {
    if (el.btnVoiceRecord) el.btnVoiceRecord.classList.add('morph-hidden');
    if (el.btnSendMessage) el.btnSendMessage.classList.remove('morph-hidden');
  } else {
    if (el.btnSendMessage) el.btnSendMessage.classList.add('morph-hidden');
    if (el.btnVoiceRecord) el.btnVoiceRecord.classList.remove('morph-hidden');
  }
}

// ===========================================================================
// ONE-TIME OTP & PERSISTENT DEVICE SESSION AUTHENTICATION ENGINE
// ===========================================================================

function switchAuthMode(mode) {
  state.authMode = mode;
  if (el.authTabLogin) el.authTabLogin.classList.toggle('active', mode === 'login');
  if (el.authTabSignup) el.authTabSignup.classList.toggle('active', mode === 'signup');
  if (el.authSignupFields) {
    el.authSignupFields.classList.toggle('hidden', mode !== 'signup');
  }
  if (el.btnRequestOtpText) {
    el.btnRequestOtpText.textContent = mode === 'signup' ? 'Send Verification Code (Sign Up)' : 'Send One-Time OTP Code';
  }
}

function switchAuthMethod(method) {
  state.authMethod = method;
  if (el.methodBtnEmail) el.methodBtnEmail.classList.toggle('active', method === 'email');
  if (el.methodBtnPhone) el.methodBtnPhone.classList.toggle('active', method === 'phone_id');
  if (el.sectionEmailInput) el.sectionEmailInput.classList.toggle('hidden', method !== 'email');
  if (el.sectionPhoneInput) el.sectionPhoneInput.classList.toggle('hidden', method !== 'phone_id');
}

function startOtpCountdown(seconds = 300) {
  if (state.otpTimerInterval) {
    clearInterval(state.otpTimerInterval);
  }
  let remaining = seconds;
  const updateTimer = () => {
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    const str = `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    if (el.otpTimerDisplay) {
      el.otpTimerDisplay.textContent = remaining > 0 ? `⏱️ Expires in ${str}` : '⏱️ Code expired';
      el.otpTimerDisplay.style.color = remaining <= 60 ? '#FF3B30' : '#8E8E93';
    }
    if (remaining <= 0) {
      clearInterval(state.otpTimerInterval);
      state.otpTimerInterval = null;
      if (el.btnResendOtp) el.btnResendOtp.disabled = false;
    }
    remaining--;
  };
  updateTimer();
  state.otpTimerInterval = setInterval(updateTimer, 1000);
}

// Request OTP Form Submit Handler
async function handleRequestOtpSubmit(e) {
  if (e) e.preventDefault();
  initAudio();

  const isEmail = state.authMethod === 'email';
  const email = el.authEmailInput ? el.authEmailInput.value.trim() : '';
  const phone = el.authPhoneInput ? el.authPhoneInput.value.trim() : '';
  const ocId = el.authOcIdInput ? el.authOcIdInput.value.trim() : '';
  const fullName = el.authFullNameInput ? el.authFullNameInput.value.trim() : '';
  const username = el.authSignupUsernameInput ? el.authSignupUsernameInput.value.trim().toLowerCase().replace(/^@/, '') : '';
  const major = el.authMajorInput ? el.authMajorInput.value.trim() : 'CIS Year 2 • KLO';

  if (isEmail) {
    if (!email || !email.includes('@')) {
      showToast('Please enter your student email address', '⚠️');
      return;
    }
  } else {
    if (!phone || phone.replace(/[^0-9]/g, '').length < 7) {
      showToast('Please enter a valid phone number', '⚠️');
      return;
    }
    if (!ocId) {
      showToast('Please enter your Okanagan College Student ID', '⚠️');
      return;
    }
  }

  if (state.authMode === 'signup' && username) {
    if (username.length < 3 || !/^[a-z0-9_]+$/.test(username)) {
      showToast('Username must be 3-20 letters, numbers, or underscores', '⚠️');
      return;
    }
  }

  if (el.btnRequestOtp) el.btnRequestOtp.disabled = true;
  if (el.btnRequestOtpText) el.btnRequestOtpText.textContent = 'Generating OTP...';

  try {
    const res = await fetch('/api/auth/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: state.authMode,
        method: state.authMethod,
        email,
        phone,
        ocId,
        fullName,
        username,
        major
      })
    });
    const data = await res.json();

    if (!res.ok) {
      if (data.needsSignup) {
        showToast(data.error || 'Account not found. Switched to Sign Up.', '💡');
        switchAuthMode('signup');
        if (isEmail && el.authSignupUsernameInput && !el.authSignupUsernameInput.value) {
          el.authSignupUsernameInput.value = email.split('@')[0].replace(/[^a-z0-9_]/gi, '').toLowerCase();
        }
      } else {
        showToast(data.error || 'Could not send verification code', '❌');
      }
      return;
    }

    state.otpIdentifier = data.identifier;

    // Transition to OTP verification form
    if (el.authRequestForm) el.authRequestForm.classList.add('hidden');
    if (el.authOtpForm) el.authOtpForm.classList.remove('hidden');

    // Update destination hint
    if (el.otpDestinationLabel) {
      el.otpDestinationLabel.textContent = isEmail ? email : `Phone (ID: ${ocId})`;
    }

    // Show Quick-Fill helper if demo code returned
    if (data.previewCode && el.authQuickFillChip && el.quickFillCodeVal) {
      el.quickFillCodeVal.textContent = data.previewCode;
      el.authQuickFillChip.classList.remove('hidden');
    } else if (el.authQuickFillChip) {
      el.authQuickFillChip.classList.add('hidden');
    }

    if (el.authOtpCodeInput) {
      el.authOtpCodeInput.value = '';
      setTimeout(() => el.authOtpCodeInput.focus(), 150);
    }

    startOtpCountdown(data.expiresInSecs || 300);
    showToast(data.message || 'Verification code dispatched! Check your screen.', '📬');
  } catch (err) {
    showToast('Network error: ' + err.message, '❌');
  } finally {
    if (el.btnRequestOtp) el.btnRequestOtp.disabled = false;
    if (el.btnRequestOtpText) {
      el.btnRequestOtpText.textContent = state.authMode === 'signup' ? 'Send Verification Code (Sign Up)' : 'Send One-Time OTP Code';
    }
  }
}

// Verify OTP Form Submit Handler
async function handleVerifyOtpSubmit(e) {
  if (e) e.preventDefault();
  const code = el.authOtpCodeInput ? el.authOtpCodeInput.value.trim() : '';

  if (!code || code.length < 4) {
    showToast('Please enter the 6-digit verification code', '⚠️');
    return;
  }

  const fullName = el.authFullNameInput ? el.authFullNameInput.value.trim() : '';
  const username = el.authSignupUsernameInput ? el.authSignupUsernameInput.value.trim().toLowerCase().replace(/^@/, '') : '';
  const major = el.authMajorInput ? el.authMajorInput.value.trim() : '';

  if (el.btnVerifyOtp) el.btnVerifyOtp.disabled = true;

  try {
    const res = await fetch('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: state.otpIdentifier,
        code,
        username,
        displayName: fullName,
        major
      })
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Verification failed', '❌');
      return;
    }

    // Save Persistent Session Token (OTP JUST ONE TIME NOT EVERYTIME)
    if (data.token) {
      localStorage.setItem('oc_connect_auth_token', data.token);
    }
    if (data.user) {
      localStorage.setItem('oc_connect_user', JSON.stringify(data.user));
      state.currentUser = data.user;
    }

    if (state.otpTimerInterval) {
      clearInterval(state.otpTimerInterval);
      state.otpTimerInterval = null;
    }

    showMainScreen();
    showToast(`Welcome to OC Connect, ${data.user.displayName || data.user.username}! 🎓`, '🎉');
  } catch (err) {
    showToast('Error verifying code: ' + err.message, '❌');
  } finally {
    if (el.btnVerifyOtp) el.btnVerifyOtp.disabled = false;
  }
}

// Bind Authentication UI Events
function initAuthListeners() {
  // Mode tabs: Log In vs Sign Up
  if (el.authTabLogin) {
    el.authTabLogin.addEventListener('click', () => switchAuthMode('login'));
  }
  if (el.authTabSignup) {
    el.authTabSignup.addEventListener('click', () => switchAuthMode('signup'));
  }

  // Method chips: Email vs Phone+ID
  if (el.methodBtnEmail) {
    el.methodBtnEmail.addEventListener('click', () => switchAuthMethod('email'));
  }
  if (el.methodBtnPhone) {
    el.methodBtnPhone.addEventListener('click', () => switchAuthMethod('phone_id'));
  }

  // Request Form Submit
  if (el.authRequestForm) {
    el.authRequestForm.addEventListener('submit', handleRequestOtpSubmit);
  }

  // OTP Form Submit
  if (el.authOtpForm) {
    el.authOtpForm.addEventListener('submit', handleVerifyOtpSubmit);
  }

  // Back to Request Form
  if (el.btnBackToRequest) {
    el.btnBackToRequest.addEventListener('click', () => {
      if (state.otpTimerInterval) clearInterval(state.otpTimerInterval);
      if (el.authOtpForm) el.authOtpForm.classList.add('hidden');
      if (el.authRequestForm) el.authRequestForm.classList.remove('hidden');
    });
  }

  // 1-Tap Quick Fill Chip
  if (el.authQuickFillChip) {
    el.authQuickFillChip.addEventListener('click', () => {
      if (el.quickFillCodeVal && el.authOtpCodeInput) {
        const code = el.quickFillCodeVal.textContent.trim();
        el.authOtpCodeInput.value = code;
        showToast('Auto-filled OTP code ' + code + ' ⚡', '✅');
        handleVerifyOtpSubmit();
      }
    });
  }

  // Resend OTP
  if (el.btnResendOtp) {
    el.btnResendOtp.addEventListener('click', () => {
      handleRequestOtpSubmit();
    });
  }

  // OTP Input Auto-Submit when 6 digits entered
  if (el.authOtpCodeInput) {
    el.authOtpCodeInput.addEventListener('input', () => {
      const v = el.authOtpCodeInput.value.replace(/[^0-9]/g, '');
      el.authOtpCodeInput.value = v;
      if (v.length === 6) {
        handleVerifyOtpSubmit();
      }
    });
  }
}

// Initialization & Fast Instant LocalStorage Session Restore
window.addEventListener('DOMContentLoaded', async () => {
  // Dismiss modals on backdrop tap
  document.querySelectorAll('.modal-backdrop').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal(modal);
      }
    });
  });

  updateInputState();
  initAuthListeners();
  initScreenEffectsCanvas();

  const token = localStorage.getItem('oc_connect_auth_token');
  const cachedUserStr = localStorage.getItem('oc_connect_user');

  // Instant Sub-30ms Startup from Device Storage
  if (token && cachedUserStr) {
    try {
      const cachedUser = JSON.parse(cachedUserStr);
      if (cachedUser && cachedUser.username) {
        state.currentUser = cachedUser;
        showMainScreen();

        // Concurrently validate/refresh token with server in background
        fetch('/api/auth/session', {
          headers: { 'Authorization': 'Bearer ' + token }
        }).then(res => {
          if (res.ok) {
            return res.json();
          } else if (res.status === 401) {
            // Session revoked or expired on server
            localStorage.removeItem('oc_connect_auth_token');
            localStorage.removeItem('oc_connect_user');
            location.reload();
          }
        }).then(data => {
          if (data && data.user) {
            state.currentUser = data.user;
            localStorage.setItem('oc_connect_user', JSON.stringify(data.user));
            updateAllMyAvatarInstances();
          }
        }).catch(() => {
          // Offline / Tunnel reconnection: keep smooth offline session active
        });

        return;
      }
    } catch (_) {}
  } else if (cachedUserStr) {
    // Legacy session migration to token
    try {
      const cachedUser = JSON.parse(cachedUserStr);
      const res = await fetch(`/api/users/me?username=${encodeURIComponent(cachedUser.username)}`);
      if (res.ok) {
        const data = await res.json();
        state.currentUser = data.user;
        showMainScreen();
        return;
      }
    } catch (_) {}
  }

  // Not logged in: Show onboarding & OTP request screen
  if (el.authScreen) el.authScreen.classList.remove('hidden');
});

// Display Main Screen
function showMainScreen() {
  el.authScreen.classList.add('hidden');
  const appViewport = document.getElementById('app-viewport');
  if (appViewport) appViewport.classList.remove('hidden');
  el.mainScreen.classList.remove('hidden');
  el.mainScreen.classList.remove('chat-open');
  el.chatScreen.classList.remove('open');
  el.chatScreen.classList.add('hidden');

  el.currentUserAvatar.textContent = (state.currentUser.displayName || state.currentUser.username).charAt(0).toUpperCase();
  el.currentUserAvatar.style.backgroundColor = state.currentUser.avatarColor || '#128C7E';
  // Render profile picture if user has one
  if (state.currentUser.avatarImage) {
    setTimeout(() => {
      if (typeof renderAvatar === 'function') {
        renderAvatar(
          el.currentUserAvatar,
          (state.currentUser.displayName || state.currentUser.username).charAt(0).toUpperCase(),
          state.currentUser.avatarColor,
          state.currentUser.avatarImage
        );
      }
    }, 0);
  }
  el.currentUserHandle.textContent = `@${state.currentUser.username}`;

  // Start real-time stream
  connectEventSource();

  // Load initial data
  loadRecentChats();
  loadFriendsList();
  loadFriendRequests();
  loadCampusDirectory();
  loadCampusWeather();

  // Initialize WhatsApp-style Group Modals
  initCreateGroupModal();
  initGroupInfoActions();

  // Background home screen sync every 3.5s when main screen is active
  if (state.homeSyncInterval) clearInterval(state.homeSyncInterval);
  state.homeSyncInterval = setInterval(() => {
    if (!el.mainScreen.classList.contains('hidden')) {
      if (state.activeTab === 'chats') loadRecentChats();
      if (state.activeTab === 'friends') {
        loadFriendRequests();
        loadFriendsList();
      }
    }
    if (state.currentUser) {
      checkActiveCallFallback();
    }
  }, 3500);
}

// Real-Time EventSource (SSE) with Auto-Reconnect
function connectEventSource() {
  if (state.eventSource) {
    state.eventSource.close();
  }
  clearTimeout(state.reconnectTimer);

  const streamUrl = `/api/stream?username=${encodeURIComponent(state.currentUser.username)}`;
  state.eventSource = new EventSource(streamUrl);

  state.eventSource.addEventListener('connected', () => {
    el.connectionStatus.textContent = '● Live Real-Time';
    el.connectionStatus.className = 'status-indicator online';
  });

  state.eventSource.addEventListener('new_message', (e) => {
    const data = JSON.parse(e.data);
    handleIncomingMessage(data);
  });

  state.eventSource.addEventListener('channel_message', (e) => {
    const data = JSON.parse(e.data);
    handleIncomingChannelMessage(data);
  });

  state.eventSource.addEventListener('message_reaction_updated', (e) => {
    try {
      const data = JSON.parse(e.data);
      handleMessageReactionUpdated(data);
    } catch (_) {}
  });

  state.eventSource.addEventListener('friend_added', (e) => {
    const data = JSON.parse(e.data);
    showToast(`Connected with @${data.friend.username}!`, '🤝');
    playReceivedSound();
    loadFriendsList();
    loadRecentChats();
    loadCampusDirectory();
    loadFriendRequests();
  });

  state.eventSource.addEventListener('friend_request_received', (e) => {
    const data = JSON.parse(e.data);
    playReceivedSound();
    showToast(`📬 New friend request from @${data.from}!`, '📬');
    loadFriendRequests();
  });

  state.eventSource.addEventListener('friend_request_accepted', (e) => {
    const data = JSON.parse(e.data);
    playReceivedSound();
    showToast(`🎉 @${data.friend.username} accepted your friend request!`, '🎉');
    loadFriendsList();
    loadRecentChats();
    loadCampusDirectory();
  });

  state.eventSource.addEventListener('friend_removed', (e) => {
    try {
      const data = JSON.parse(e.data);
      loadFriendsList();
      loadRecentChats();
      loadCampusDirectory();
    } catch (_) {}
  });

  state.eventSource.addEventListener('user_blocked', (e) => {
    try {
      const data = JSON.parse(e.data);
      loadFriendsList();
      loadRecentChats();
      loadCampusDirectory();
      loadBlockedStudentsList();
    } catch (_) {}
  });

  state.eventSource.addEventListener('user_online', (e) => {
    const data = JSON.parse(e.data);
    updateFriendOnlineStatus(data.username, data.online);
  });

  state.eventSource.addEventListener('directory_updated', () => {
    loadCampusDirectory();
  });

  // Group Event Listeners (WhatsApp Style Real-Time Multi-Member Sync)
  state.eventSource.addEventListener('group_message', (e) => {
    try {
      const data = JSON.parse(e.data);
      handleIncomingGroupMessage(data);
    } catch (_) {}
  });

  state.eventSource.addEventListener('group_created', (e) => {
    try {
      const data = JSON.parse(e.data);
      showToast(`👥 You were added to group "${data.group.name}"`, '👥');
      playReceivedSound();
      loadRecentChats();
    } catch (_) {}
  });

  state.eventSource.addEventListener('group_member_added', (e) => {
    try {
      const data = JSON.parse(e.data);
      loadRecentChats();
      if (state.isGroup && state.currentGroupId === data.groupId) {
        if (data.systemMessage && !state.renderedMsgIds.has(data.systemMessage.id)) {
          state.renderedMsgIds.add(data.systemMessage.id);
          appendMessageToChat(data.systemMessage, false);
          scrollToBottom();
        }
        updateGroupChatHeaderSubtitle(data.groupId);
      }
    } catch (_) {}
  });

  state.eventSource.addEventListener('group_member_removed', (e) => {
    try {
      const data = JSON.parse(e.data);
      loadRecentChats();
      if (state.isGroup && state.currentGroupId === data.groupId) {
        if (data.systemMessage && !state.renderedMsgIds.has(data.systemMessage.id)) {
          state.renderedMsgIds.add(data.systemMessage.id);
          appendMessageToChat(data.systemMessage, false);
          scrollToBottom();
        }
        updateGroupChatHeaderSubtitle(data.groupId);
      }
    } catch (_) {}
  });

  state.eventSource.addEventListener('group_updated', (e) => {
    try {
      const data = JSON.parse(e.data);
      loadRecentChats();
      if (state.isGroup && state.currentGroupId === data.groupId) {
        if (data.group && data.group.name) {
          el.chatPartnerTitle.textContent = data.group.name;
        }
        if (data.systemMessage && !state.renderedMsgIds.has(data.systemMessage.id)) {
          state.renderedMsgIds.add(data.systemMessage.id);
          appendMessageToChat(data.systemMessage, false);
          scrollToBottom();
        }
      }
    } catch (_) {}
  });

  state.eventSource.addEventListener('group_deleted', (e) => {
    try {
      const data = JSON.parse(e.data);
      loadRecentChats();
      if (state.isGroup && state.currentGroupId === data.groupId) {
        showToast('This group was deleted by the admin.', '⚠️');
        el.btnBackToHome.click();
      }
    } catch (_) {}
  });

  state.eventSource.addEventListener('group_left', (e) => {
    try {
      const data = JSON.parse(e.data);
      loadRecentChats();
      if (state.isGroup && state.currentGroupId === data.groupId) {
        showToast('You left this group.', 'ℹ️');
        el.btnBackToHome.click();
      }
    } catch (_) {}
  });

  state.eventSource.addEventListener('typing', (e) => {
    const data = JSON.parse(e.data);
    if (state.currentChatTarget === data.from && !state.isChannel) {
      if (data.isTyping) {
        el.chatPartnerSubtitle.textContent = 'typing...';
        el.chatPartnerSubtitle.style.color = 'var(--accent-green)';
      } else {
        const friend = state.friends.find(f => f.username === data.from);
        el.chatPartnerSubtitle.textContent = friend && friend.online ? 'online' : 'last seen recently';
        el.chatPartnerSubtitle.style.color = '';
      }
    }
  });

  state.eventSource.addEventListener('messages_read', (e) => {
    const data = JSON.parse(e.data);
    const cleanBy = (data.by || '').toLowerCase().replace(/^@/, '');
    const cleanTarget = (state.currentChatTarget || '').toLowerCase().replace(/^@/, '');
    if (cleanTarget === cleanBy) {
      document.querySelectorAll('.imessage-status').forEach(st => {
        st.textContent = 'Read';
        st.classList.add('read');
      });
    }
  });

  state.eventSource.addEventListener('sos_beacon', (e) => {
    const data = JSON.parse(e.data);
    playReceivedSound();
    showToast(`🚨 SOS BEACON: @${data.sender} requested emergency assistance at ${data.locationName}!`, '🚨');
  });

  state.eventSource.addEventListener('user_trust_updated', (e) => {
    const data = JSON.parse(e.data);
    const targetUser = (data.target || data.by || '').toLowerCase();
    if (data.isTrusted) {
      state.trustedUsersSet.add(targetUser);
    } else {
      state.trustedUsersSet.delete(targetUser);
    }
    if (state.currentChatTarget && state.currentChatTarget.toLowerCase() === targetUser) {
      if (data.isTrusted) {
        el.partnerBlueTick.classList.remove('hidden');
      } else {
        el.partnerBlueTick.classList.add('hidden');
      }
    }
    loadRecentChats();
    loadFriendsList();
    loadCampusDirectory();
  });

  state.eventSource.addEventListener('voice_call_incoming', (e) => {
    const data = JSON.parse(e.data);
    playRingtoneSound();
    state.activeCall = {
      callId: data.callId,
      partner: data.caller,
      partnerName: data.callerName || data.caller,
      role: 'callee',
      status: 'ringing',
      seconds: 0
    };
    el.callerName.textContent = data.callerName || data.caller;
    el.callerAvatar.textContent = (data.callerName || data.caller).charAt(0).toUpperCase();
    if (data.callerAvatar) el.callerAvatar.style.backgroundColor = data.callerAvatar;
    openModal(el.modalIncomingCall);
  });

  state.eventSource.addEventListener('voice_call_signal', (e) => {
    try {
      const payload = JSON.parse(e.data);
      handleCallSignal(payload);
    } catch (_) {}
  });

  state.eventSource.addEventListener('voice_call_accepted', (e) => {
    const data = JSON.parse(e.data);
    playCallConnectedSound();
    if (state.activeCall && state.activeCall.callId === data.callId) {
      state.activeCall.status = 'connected';
      el.activeCallStatus.textContent = 'Connected - Voice Call';
      el.activeCallStatus.style.color = '#34C759';
      el.activeCallTimer.classList.remove('hidden');
      startCallTimer();
      showToast('Voice call connected!', '📞');
      startCallAudioRelay();
    }
  });

  state.eventSource.addEventListener('voice_call_audio_chunk', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (!state.activeCall || state.activeCall.callId !== data.callId) return;
      // If WebRTC direct P2P is already flowing, ignore server chunk to avoid echo
      if (state.peerConnection && (state.peerConnection.iceConnectionState === 'connected' || state.peerConnection.iceConnectionState === 'completed')) {
        return;
      }
      if (data.chunk) {
        const audio = new Audio(data.chunk);
        audio.volume = 1.0;
        audio.play().catch(() => {});
      }
    } catch (_) {}
  });

  state.eventSource.addEventListener('voice_call_declined', (e) => {
    const data = JSON.parse(e.data);
    if (state.activeCall && state.activeCall.callId === data.callId) {
      el.activeCallStatus.textContent = 'Call Declined';
      el.activeCallStatus.style.color = '#FF3B30';
      showToast(`@${data.responder} declined the voice call`, '📞');
      setTimeout(() => {
        cleanupCall();
        if (state.currentChatTarget) fetchAndRenderChatMessages(false);
        loadRecentChats();
      }, 1500);
    }
  });

  state.eventSource.addEventListener('voice_call_ended', (e) => {
    const data = JSON.parse(e.data);
    if (state.activeCall && state.activeCall.callId === data.callId) {
      el.activeCallStatus.textContent = 'Call Ended';
      showToast('Call ended by partner', '📞');
      cleanupCall();
      if (state.currentChatTarget) fetchAndRenderChatMessages(false);
      loadRecentChats();
    }
  });

  state.eventSource.onerror = () => {
    el.connectionStatus.textContent = '○ Reconnecting...';
    el.connectionStatus.className = 'status-indicator offline';
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = setTimeout(connectEventSource, 2000);
  };
}

// ===========================================================================
// NOTIFICATION & ALERT SYSTEM (In-App Banner, Sound Chimes, Web Push)
// ===========================================================================

let inappBannerTimeout = null;

function getNotificationPrefs() {
  return {
    push: localStorage.getItem('oc_notify_push') !== 'false',
    sound: localStorage.getItem('oc_notify_sound') !== 'false',
    haptic: localStorage.getItem('oc_notify_haptic') !== 'false',
    preview: localStorage.getItem('oc_notify_preview') !== 'false'
  };
}

function triggerHapticFeedback(pattern = [15]) {
  try {
    const prefs = getNotificationPrefs();
    if (prefs.haptic && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch (_) {}
}

function initNotificationSettings() {
  const prefs = getNotificationPrefs();
  if (el.togglePushNotifications) el.togglePushNotifications.checked = prefs.push;
  if (el.toggleNotificationSound) el.toggleNotificationSound.checked = prefs.sound;
  if (el.toggleHapticVibration) el.toggleHapticVibration.checked = prefs.haptic;
  if (el.toggleMessagePreviews) el.toggleMessagePreviews.checked = prefs.preview;
}

if (el.togglePushNotifications) {
  el.togglePushNotifications.addEventListener('change', async (e) => {
    const enable = e.target.checked;
    localStorage.setItem('oc_notify_push', enable ? 'true' : 'false');
    if (enable && 'Notification' in window && Notification.permission !== 'granted') {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          showToast('Push notifications were denied in browser permissions.', '⚠️');
          e.target.checked = false;
          localStorage.setItem('oc_notify_push', 'false');
        } else {
          showToast('Push notifications enabled! 🔔', '✅');
        }
      } catch (_) {}
    }
  });
}

if (el.toggleNotificationSound) {
  el.toggleNotificationSound.addEventListener('change', (e) => {
    localStorage.setItem('oc_notify_sound', e.target.checked ? 'true' : 'false');
    if (e.target.checked) playReceivedSound();
  });
}

if (el.toggleHapticVibration) {
  el.toggleHapticVibration.addEventListener('change', (e) => {
    localStorage.setItem('oc_notify_haptic', e.target.checked ? 'true' : 'false');
    if (e.target.checked) triggerHapticFeedback([25]);
  });
}

if (el.toggleMessagePreviews) {
  el.toggleMessagePreviews.addEventListener('change', (e) => {
    localStorage.setItem('oc_notify_preview', e.target.checked ? 'true' : 'false');
  });
}

function showInAppNotification(senderName, messageText, avatarColor, targetUsername, isChannel = false) {
  const prefs = getNotificationPrefs();

  if (prefs.sound) {
    playReceivedSound();
  }

  // Native Web Push Notification (when tab is minimized / backgrounded)
  if (document.visibilityState !== 'visible' && prefs.push && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const bodyText = prefs.preview ? messageText : 'New message received';
      const notif = new Notification(senderName, {
        body: bodyText,
        icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220%22%20width=%22100%22%20height=%22100%22><circle cx=%2250%22 cy=%2250%22 r=%2248%22 fill=%22%23075E54%22/><text x=%2250%22 y=%2264%22 font-size=%2244%22 text-anchor=%22middle%22 fill=%22white%22 font-family=%22sans-serif%22 font-weight=%22bold%22>OC</text></svg>'
      });
      notif.onclick = () => {
        window.focus();
        if (isGroup) {
          openGroupChat(targetUsername, groupName || senderName);
        } else if (targetUsername) {
          openChat(targetUsername, senderName, isChannel);
        }
        notif.close();
      };
    } catch (_) {}
  }

  // Cupertino Dynamic Island in-app banner
  if (el.inappNotificationBanner) {
    clearTimeout(inappBannerTimeout);

    if (el.inappBannerTitle) el.inappBannerTitle.textContent = senderName;
    if (el.inappBannerText) el.inappBannerText.textContent = prefs.preview ? messageText : 'New message received';
    if (el.inappBannerAvatar) {
      el.inappBannerAvatar.textContent = (senderName || 'U').charAt(0).toUpperCase();
      el.inappBannerAvatar.style.backgroundColor = avatarColor || '#075E54';
    }

    el.inappNotificationBanner.onclick = () => {
      el.inappNotificationBanner.classList.add('hidden');
      if (isGroup) {
        openGroupChat(targetUsername, groupName || senderName);
      } else if (targetUsername) {
        openChat(targetUsername, senderName, isChannel);
      }
    };

    el.inappNotificationBanner.classList.remove('hidden');

    inappBannerTimeout = setTimeout(() => {
      if (el.inappNotificationBanner) el.inappNotificationBanner.classList.add('hidden');
    }, 4500);
  }
}

// Incoming 1-on-1 Message Handler
function handleIncomingMessage(payload) {
  const { sender, message } = payload;
  if (!message) return;

  const cleanSender = (sender || message.sender || '').trim().toLowerCase().replace(/^@/, '');
  const cleanTarget = (state.currentChatTarget || '').trim().toLowerCase().replace(/^@/, '');
  const myUsername = state.currentUser ? state.currentUser.username.toLowerCase() : '';

  if (cleanSender === myUsername) {
    if (message.id) state.renderedMsgIds.add(message.id);
    return;
  }

  const isCurrentChat = (!state.isChannel && !state.isGroup && cleanTarget === cleanSender);

  if (isCurrentChat && document.visibilityState === 'visible') {
    if (!state.renderedMsgIds.has(message.id)) {
      state.renderedMsgIds.add(message.id);
      const prefs = getNotificationPrefs();
      if (prefs.sound) playReceivedSound();
      appendMessageToChat(message, false);
      scrollToBottom();
      checkAndTriggerCelebrationEffect(message.text);
    }
    // Acknowledge read status
    fetch(`/api/messages/history?me=${encodeURIComponent(state.currentUser.username)}&target=${encodeURIComponent(cleanSender)}`);
  } else {
    let previewText = message.text;
    if (message.voice) previewText = '🎤 Voice message';
    else if (message.file) previewText = `📎 ${message.file.name || 'File'}`;
    else if (message.image) previewText = '📷 Photo';
    else if (message.studyCard) previewText = '📚 Study card';

    const senderObj = state.friends.find(f => f.username.toLowerCase() === cleanSender) ||
                      state.allStudents.find(s => s.username.toLowerCase() === cleanSender);
    const senderDisplayName = (senderObj && senderObj.displayName) || message.displayName || `@${cleanSender}`;
    const avatarColor = (senderObj && senderObj.avatarColor) || '#075E54';

    showInAppNotification(senderDisplayName, previewText || 'Sent a message', avatarColor, cleanSender, false);
    loadRecentChats();
  }
}

// Incoming Channel Message Handler
function handleIncomingChannelMessage(payload) {
  const { channel, message } = payload;
  if (!message) return;

  const cleanChannel = (channel || '').trim().toLowerCase();
  const cleanTarget = (state.currentChatTarget || '').trim().toLowerCase();
  const myUsername = state.currentUser ? state.currentUser.username.toLowerCase() : '';
  const sender = (message.sender || '').trim().toLowerCase();

  if (sender === myUsername) return;

  if (state.isChannel && cleanTarget === cleanChannel && document.visibilityState === 'visible') {
    if (!state.renderedMsgIds.has(message.id)) {
      state.renderedMsgIds.add(message.id);
      const prefs = getNotificationPrefs();
      if (prefs.sound) playReceivedSound();
      appendMessageToChat(message, false);
      scrollToBottom();
      checkAndTriggerCelebrationEffect(message.text);
    }
  } else {
    let previewText = message.text;
    if (message.voice) previewText = '🎤 Voice message';
    else if (message.file) previewText = `📎 ${message.file.name || 'File'}`;
    else if (message.image) previewText = '📷 Photo';
    else if (message.studyCard) previewText = '📚 Study card';

    const chTitle = cleanChannel === 'kelowna-general' ? 'Kelowna General Room' : (cleanChannel === 'study-lounge' ? 'Study Lounge' : 'Campus Safety Beacon');
    showInAppNotification(`${chTitle} (@${message.sender})`, previewText || 'Sent a message', '#007AFF', cleanChannel, true);
  }
}

// Incoming Group Message Handler (WhatsApp Style)
function handleIncomingGroupMessage(payload) {
  const { groupId, groupName, message } = payload;
  if (!message) return;

  const cleanGroupId = (groupId || '').trim();
  const cleanTarget = (state.currentChatTarget || '').trim();
  const myUsername = state.currentUser ? state.currentUser.username.toLowerCase() : '';
  const sender = (message.sender || '').trim().toLowerCase();

  if (sender === myUsername) {
    if (message.id) state.renderedMsgIds.add(message.id);
    return;
  }

  const isCurrentGroupChat = (state.isGroup && cleanTarget === cleanGroupId);

  if (isCurrentGroupChat && document.visibilityState === 'visible') {
    if (!state.renderedMsgIds.has(message.id)) {
      state.renderedMsgIds.add(message.id);
      const prefs = getNotificationPrefs();
      if (prefs.sound) playReceivedSound();
      appendMessageToChat(message, false);
      scrollToBottom();
      checkAndTriggerCelebrationEffect(message.text);
    }
  } else {
    let previewText = message.text;
    if (message.voice) previewText = '🎤 Voice message';
    else if (message.file) previewText = `📎 ${message.file.name || 'File'}`;
    else if (message.image) previewText = '📷 Photo';
    else if (message.studyCard) previewText = '📚 Study card';

    const senderDisplay = message.displayName || `@${message.sender}`;
    showInAppNotification(`${groupName || 'Group'}: ${senderDisplay}`, previewText || 'Sent a message', '#075E54', cleanGroupId, false, true, groupName);
    loadRecentChats();
  }
}

// Update Friend Online State
function updateFriendOnlineStatus(username, isOnline) {
  const friend = state.friends.find(f => f.username === username);
  if (friend) {
    friend.online = isOnline;
    renderFriendsList(state.friends);
    updateFriendsOnlineCount();
    if (state.currentChatTarget === username && !state.isChannel) {
      el.chatPartnerSubtitle.textContent = isOnline ? 'online' : 'last seen recently';
    }
  }
  const student = state.allStudents.find(s => s.username === username);
  if (student) {
    student.online = isOnline;
    renderCampusDirectory(state.allStudents);
  }
}

function updateFriendsOnlineCount() {
  const onlineCount = state.friends.filter(f => f.online).length;
  el.friendsOnlineCount.textContent = `${onlineCount} online`;
}

// LOAD FRIEND REQUESTS SECTION (INCOMING)
async function loadFriendRequests() {
  if (!state.currentUser) return;
  try {
    const res = await fetch(`/api/friends/requests?username=${encodeURIComponent(state.currentUser.username)}`);
    const data = await res.json();
    state.incomingRequests = data.incoming || [];

    if (state.incomingRequests.length > 0) {
      el.friendRequestsContainer.classList.remove('hidden');
      el.requestsBadge.textContent = state.incomingRequests.length;
      el.friendsRequestsTabBadge.textContent = state.incomingRequests.length;
      el.friendsRequestsTabBadge.classList.remove('hidden');
      renderFriendRequests(state.incomingRequests);
    } else {
      el.friendRequestsContainer.classList.add('hidden');
      el.friendsRequestsTabBadge.classList.add('hidden');
    }
  } catch (err) {
    console.error('Error loading friend requests:', err);
  }
}

function renderFriendRequests(requests) {
  el.friendRequestsList.innerHTML = '';
  requests.forEach(r => {
    const card = document.createElement('div');
    card.className = 'request-card';
    card.innerHTML = `
      <div class="avatar-circle" style="width:42px;height:42px;font-size:15px;background-color:${r.avatarColor || '#075E54'}">
        ${(r.fromName || r.from).charAt(0).toUpperCase()}
      </div>
      <div class="request-info">
        <div class="request-name">${r.fromName || r.from} <small style="color:var(--text-light);font-weight:normal">@${r.from}</small></div>
        <div class="request-major">${r.major || 'Okanagan College'}</div>
      </div>
      <div class="request-actions">
        <button class="btn-accept-request" data-from="${r.from}">✓ Accept</button>
        <button class="btn-decline-request" data-from="${r.from}">✕</button>
      </div>
    `;

    card.querySelector('.btn-accept-request').addEventListener('click', () => {
      respondToRequest(r.from, 'accept');
    });

    card.querySelector('.btn-decline-request').addEventListener('click', () => {
      respondToRequest(r.from, 'decline');
    });

    el.friendRequestsList.appendChild(card);
  });
}

async function respondToRequest(fromUsername, action) {
  try {
    const res = await fetch('/api/friends/request/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        me: state.currentUser.username,
        from: fromUsername,
        action: action
      })
    });
    const data = await res.json();

    if (action === 'accept') {
      playReceivedSound();
      showToast(`Connected with @${fromUsername}!`, '🎉');
      loadFriendRequests();
      loadFriendsList();
      loadRecentChats();
      loadCampusDirectory();
    } else {
      showToast(`Declined request from @${fromUsername}`);
      loadFriendRequests();
    }
  } catch (err) {
    showToast('Error responding to request: ' + err.message, '❌');
  }
}

// SEND FRIEND REQUEST ACTION
async function sendFriendRequestAction(targetUsername) {
  try {
    const res = await fetch('/api/friends/request/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: state.currentUser.username,
        to: targetUsername
      })
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Failed to send request', '⚠️');
      return;
    }

    showToast(`Friend request sent to @${targetUsername}!`, '📬');
    loadCampusDirectory();
  } catch (err) {
    showToast('Error sending request: ' + err.message, '❌');
  }
}

// Load Friends
async function loadFriendsList() {
  if (!state.currentUser) return;
  try {
    const res = await fetch(`/api/friends/list?username=${encodeURIComponent(state.currentUser.username)}`);
    const data = await res.json();
    if (data.friends) {
      state.friends = data.friends;
      el.myFriendsCount.textContent = data.friends.length;
      renderFriendsList(state.friends);
      updateFriendsOnlineCount();
    }
  } catch (err) {
    console.error('Error loading friends:', err);
  }
}

function renderFriendsList(friends) {
  el.friendsList.innerHTML = '';
  if (!friends || friends.length === 0) {
    el.noFriendsPlaceholder.classList.remove('hidden');
    return;
  }
  el.noFriendsPlaceholder.classList.add('hidden');

  friends.forEach(f => {
    const isTrusted = f.isTrusted || state.trustedUsersSet.has(f.username.toLowerCase());
    const blueTickHtml = isTrusted ? twitterTickSvg : '';

    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <div class="avatar-circle" style="background-color: ${f.avatarColor || '#075E54'}">
        ${(f.displayName || f.username).charAt(0).toUpperCase()}
        ${f.online ? '<span class="online-badge"></span>' : ''}
      </div>
      <div class="item-content">
        <div class="item-top-row">
          <span class="item-name">${f.displayName || f.username} ${blueTickHtml} <small style="color:var(--text-light);font-weight:normal">@${f.username}</small></span>
        </div>
        <div class="item-bottom-row">
          <span class="item-snippet ${f.online ? 'status-online' : ''}">${f.online ? 'Online now' : (f.major || 'Okanagan College')}</span>
        </div>
      </div>
      <div class="item-actions">
        <button class="btn-chat-inline">💬 Chat</button>
      </div>
    `;
    item.addEventListener('click', () => openChat(f.username, f.displayName, false, f.online));
    el.friendsList.appendChild(item);
  });
}

// Load Campus Directory (All 100+ Students)
async function loadCampusDirectory() {
  if (!state.currentUser) return;
  try {
    const url = `/api/users/all?me=${encodeURIComponent(state.currentUser.username)}&query=${encodeURIComponent(state.directorySearchQuery)}&filter=${encodeURIComponent(state.selectedFilter)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.students) {
      state.allStudents = data.students;
      el.totalStudentsCount.textContent = data.total || data.students.length;
      renderCampusDirectory(data.students);
    }
  } catch (err) {
    console.error('Error loading campus directory:', err);
  }
}

function renderCampusDirectory(students) {
  el.campusDirectoryList.innerHTML = '';
  if (!students || students.length === 0) {
    if (!state.directorySearchQuery) {
      el.campusDirectoryList.innerHTML = `
        <div style="text-align:center;padding:28px 16px;color:var(--text-light)">
          <div style="font-size:28px;margin-bottom:8px">🔒</div>
          <strong style="color:var(--text-dark);font-size:14px">Student Privacy Protected</strong>
          <p style="font-size:12px;margin-top:6px;line-height:1.5;max-width:320px;margin-left:auto;margin-right:auto">
            To preserve student safety and privacy, public directory browsing is restricted. Type an exact <strong>@username</strong> in the search bar above to find and connect with classmates.
          </p>
        </div>
      `;
    } else {
      el.campusDirectoryList.innerHTML = `<div class="empty-inline-hint">No registered classmates match "@${escapeHtml(state.directorySearchQuery)}".</div>`;
    }
    return;
  }

  students.forEach(s => {
    const isFriend = state.friends.some(f => f.username === s.username);
    const isTrusted = s.isTrusted || state.trustedUsersSet.has(s.username.toLowerCase());
    const blueTickHtml = isTrusted ? twitterTickSvg : '';

    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <div class="avatar-circle" style="background-color: ${s.avatarColor || '#075E54'}">
        ${(s.displayName || s.username).charAt(0).toUpperCase()}
        ${s.online ? '<span class="online-badge"></span>' : ''}
      </div>
      <div class="item-content">
        <div class="item-top-row">
          <span class="item-name">${s.displayName || s.username} ${blueTickHtml} <small style="color:var(--text-light);font-weight:normal">@${s.username}</small></span>
        </div>
        <div class="item-bottom-row">
          <span class="item-snippet ${s.online ? 'status-online' : ''}">${s.online ? '● Online' : s.major}</span>
        </div>
      </div>
      <div class="item-actions">
        <button class="btn-chat-inline btn-start-chat">💬 Chat</button>
        ${!isFriend ? (s.isRequested ? `<span style="font-size:11px;color:var(--text-light)">Requested</span>` : `<button class="btn-add-inline btn-add-user" data-username="${s.username}">+ Add</button>`) : `<span style="font-size:11px;color:var(--accent-green);font-weight:600">✓ Friends</span>`}
      </div>
    `;

    item.querySelector('.btn-start-chat').addEventListener('click', (e) => {
      e.stopPropagation();
      openChat(s.username, s.displayName, false, s.online);
    });

    const addBtn = item.querySelector('.btn-add-user');
    if (addBtn) {
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sendFriendRequestAction(s.username);
      });
    }

    item.addEventListener('click', () => openChat(s.username, s.displayName, false, s.online));
    el.campusDirectoryList.appendChild(item);
  });
}

// Filter Chips handler
if (el.filterChipsBar) {
  el.filterChipsBar.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      el.filterChipsBar.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.selectedFilter = chip.dataset.filter;
      loadCampusDirectory();
    });
  });
}

// Friends Search Input
if (el.friendsFilterInput) {
  let searchDebounce;
  el.friendsFilterInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.directorySearchQuery = el.friendsFilterInput.value.trim().toLowerCase();
      loadCampusDirectory();
    }, 250);
  });
}

// Load Recent Chats (Google Messages Inbox with Categories, Pinning & Search)
async function loadRecentChats() {
  if (!state.currentUser) return;
  try {
    const [friendsRes, groupsRes, pinnedRes, starredIdsRes] = await Promise.all([
      fetch(`/api/friends/list?username=${encodeURIComponent(state.currentUser.username)}`),
      fetch(`/api/groups/list?username=${encodeURIComponent(state.currentUser.username)}`),
      fetch(`/api/chats/pinned?username=${encodeURIComponent(state.currentUser.username)}`),
      fetch(`/api/messages/starred-ids?username=${encodeURIComponent(state.currentUser.username)}`)
    ]);

    const friendsData = await friendsRes.json();
    const groupsData = await groupsRes.json();
    const pinnedData = await pinnedRes.json();
    const starredData = await starredIdsRes.json();

    const friends = friendsData.friends || [];
    const groups = groupsData.groups || [];
    state.groups = groups;
    state.pinnedChatKeys = new Set(pinnedData.pinnedChats || []);
    state.starredMessageIds = new Set(starredData.starredIds || []);

    // Cache trusted status
    friends.forEach(c => {
      if (c.isTrusted) state.trustedUsersSet.add(c.username.toLowerCase());
    });

    // Merge chats list items
    let mergedList = [];

    // Add friends (Direct / Personal)
    friends.forEach(f => {
      mergedList.push({
        type: 'direct',
        id: f.username,
        chatKey: f.username,
        name: f.displayName || f.username,
        handle: f.username,
        avatarColor: f.avatarColor || '#075E54',
        avatarImage: f.avatarImage || null,
        online: f.online,
        isTrusted: f.isTrusted || state.trustedUsersSet.has(f.username.toLowerCase()),
        unreadCount: f.unreadCount || 0,
        lastMessage: f.lastMessage,
        sortTime: (f.lastMessage && f.lastMessage.timestamp) || f.lastSeen || 0,
        isPinned: state.pinnedChatKeys.has(f.username)
      });
    });

    // Add groups
    groups.forEach(g => {
      mergedList.push({
        type: 'group',
        id: g.id,
        chatKey: 'group_' + g.id,
        name: g.name,
        description: g.description,
        avatarColor: g.avatarColor || '#075E54',
        avatarImage: g.avatarImage || null,
        memberCount: g.memberCount || 1,
        myRole: g.myRole,
        unreadCount: 0,
        lastMessage: g.lastMessage,
        sortTime: (g.lastMessage && g.lastMessage.timestamp) || g.createdAt || 0,
        isPinned: state.pinnedChatKeys.has('group_' + g.id) || state.pinnedChatKeys.has(g.id)
      });
    });

    // Cache recent chats list into local device storage
    try {
      saveToOfflineCache('recent_chats', mergedList);
    } catch (_) {}

    // 1. Google Messages Category Filter
    if (state.inboxCategory === 'unread') {
      mergedList = mergedList.filter(item => (item.unreadCount && item.unreadCount > 0));
    } else if (state.inboxCategory === 'personal') {
      mergedList = mergedList.filter(item => item.type === 'direct');
    } else if (state.inboxCategory === 'groups') {
      mergedList = mergedList.filter(item => item.type === 'group');
    } else if (state.inboxCategory === 'starred') {
      // Filter items that have starred messages
      mergedList = mergedList.filter(item => item.lastMessage && state.starredMessageIds.has(item.lastMessage.id));
    }

    // 2. Search Query Filter
    if (state.chatsSearchQuery) {
      const q = state.chatsSearchQuery.toLowerCase();
      mergedList = mergedList.filter(item => {
        const nameMatch = item.name && item.name.toLowerCase().includes(q);
        const handleMatch = item.handle && item.handle.toLowerCase().includes(q);
        const textMatch = item.lastMessage && item.lastMessage.text && item.lastMessage.text.toLowerCase().includes(q);
        return nameMatch || handleMatch || textMatch;
      });
    }

    // 3. Sort: Pinned chats on top, then newest activity
    mergedList.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return b.sortTime - a.sortTime;
    });

    // Update global unread badge on Chats tab
    const totalUnread = friends.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
    if (el.chatsBadge) {
      if (totalUnread > 0) {
        el.chatsBadge.textContent = totalUnread;
        el.chatsBadge.classList.remove('hidden');
      } else {
        el.chatsBadge.classList.add('hidden');
      }
    }

    renderRecentChatsList(mergedList);
  } catch (err) {
    console.error('Error loading chats:', err);
    // Offline fallback from local device storage
    const cachedChats = loadFromOfflineCache('recent_chats');
    if (cachedChats && Array.isArray(cachedChats) && cachedChats.length > 0) {
      renderRecentChatsList(cachedChats);
    }
  }
}

function renderRecentChatsList(mergedList) {
  if (!el.chatsList) return;
  el.chatsList.innerHTML = '';

  if (mergedList.length === 0) {
    if (el.noChatsPlaceholder) el.noChatsPlaceholder.classList.remove('hidden');
    return;
  }
  if (el.noChatsPlaceholder) el.noChatsPlaceholder.classList.add('hidden');

    mergedList.forEach(item => {
      let snippetText = item.type === 'group' ? 'Tap to open group' : 'Tap to start chatting';
      let tick = '';
      let timeText = '';

      if (item.lastMessage) {
        const isMyMsg = item.lastMessage.sender === state.currentUser.username;
        tick = isMyMsg ? (item.lastMessage.status === 'read' ? '<span class="tick-icon read">✓✓</span> ' : '<span class="tick-icon">✓✓</span> ') : '';
        
        let msgContent = '';
        if (item.lastMessage.voice) {
          msgContent = '🎤 Voice message';
        } else if (item.lastMessage.file) {
          msgContent = '📎 ' + (item.lastMessage.file.name || 'File attachment');
        } else if (item.lastMessage.studyCard) {
          const sc = item.lastMessage.studyCard;
          msgContent = sc.type === 'wiki' ? `📖 Wiki: ${sc.title}` : (sc.type === 'book' ? `📚 Book: ${sc.title}` : (sc.type === 'joke' ? '😂 Study Joke' : '🌤️ Campus Weather'));
        } else {
          msgContent = item.lastMessage.text || 'Photo';
        }

        if (item.type === 'group' && !isMyMsg) {
          const senderName = item.lastMessage.displayName || item.lastMessage.sender || '';
          snippetText = `${senderName}: ${msgContent}`;
        } else {
          snippetText = msgContent;
        }

        timeText = formatTime(item.lastMessage.timestamp);
      }

      const itemEl = document.createElement('div');
      itemEl.className = `list-item chat-item ${item.isPinned ? 'pinned' : ''}`;

      const pinIconHtml = item.isPinned ? `<span class="chat-pin-icon" title="Pinned Chat">📌</span>` : '';

      if (item.type === 'group') {
        itemEl.innerHTML = `
          <div class="avatar-circle" style="background-color: ${item.avatarColor || '#075E54'}">
            ${item.avatarImage ? `<img src="${item.avatarImage}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />` : (item.name.charAt(0).toUpperCase() || '👥')}
          </div>
          <div class="item-content">
            <div class="item-top-row">
              <span class="item-name">${escapeHtml(item.name)} <span class="chat-group-badge">Group</span> ${pinIconHtml}</span>
              <div style="display:flex;align-items:center;gap:4px">
                <span class="item-time">${timeText}</span>
              </div>
            </div>
            <div class="item-bottom-row">
              <span class="item-snippet">${tick}${escapeHtml(snippetText)}</span>
            </div>
          </div>
        `;
        itemEl.addEventListener('click', () => openGroupChat(item.id, item.name, item.avatarColor, item.avatarImage));
      } else {
        const blueTick = item.isTrusted ? twitterTickSvg : '';
        const unreadBadge = (item.unreadCount && item.unreadCount > 0)
          ? `<span class="unread-count-pill">${item.unreadCount}</span>`
          : '';

        itemEl.innerHTML = `
          <div class="avatar-circle" style="background-color: ${item.avatarColor || '#075E54'}">
            ${item.avatarImage ? `<img src="${item.avatarImage}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />` : (item.name.charAt(0).toUpperCase())}
            ${item.online ? '<span class="online-badge"></span>' : ''}
          </div>
          <div class="item-content">
            <div class="item-top-row">
              <span class="item-name">${escapeHtml(item.name)} ${blueTick} ${pinIconHtml}</span>
              <div style="display:flex;align-items:center;gap:4px">
                <span class="item-time">${timeText}</span>
                ${unreadBadge}
              </div>
            </div>
            <div class="item-bottom-row">
              <span class="item-snippet">${tick}${escapeHtml(snippetText)}</span>
            </div>
          </div>
        `;
        itemEl.addEventListener('click', () => openChat(item.handle, item.name, false, item.online));
      }

      // Context menu / long-press for Pin / Unpin
      itemEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        togglePinChat(item.chatKey);
      });

      el.chatsList.appendChild(itemEl);
    });
}

// Tab Switching
el.tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    el.tabButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const target = btn.dataset.tab;
    state.activeTab = target;

    el.tabChats.classList.remove('active');
    el.tabFriends.classList.remove('active');
    el.tabChannels.classList.remove('active');

    if (target === 'chats') {
      el.tabChats.classList.add('active');
      loadRecentChats();
    } else if (target === 'friends') {
      el.tabFriends.classList.add('active');
      loadFriendRequests();
      loadFriendsList();
      loadCampusDirectory();
    } else if (target === 'channels') {
      el.tabChannels.classList.add('active');
    }
  });
});

if (el.btnEmptyAddFriend) {
  el.btnEmptyAddFriend.addEventListener('click', () => {
    document.querySelector('.tab-btn[data-tab="friends"]').click();
  });
}

if (el.btnQuickNewChat) {
  el.btnQuickNewChat.addEventListener('click', () => {
    document.querySelector('.tab-btn[data-tab="friends"]').click();
  });
}

// Channel Card Clicks
document.querySelectorAll('.channel-card').forEach(card => {
  card.addEventListener('click', () => {
    const chanKey = card.dataset.channel;
    const titles = {
      'kelowna-general': '#Kelowna-General',
      'study-lounge': '#Study-Lounge',
      'campus-safety': '#Campus-Safety',
      'cosc-study-room': '#COSC-Computer-Science',
      'buad-study-room': '#BUAD-Business-Admin',
      'math-study-room': '#MATH-Help-Lounge',
      'nursing-study-room': '#NURS-Health-Sciences',
      'engr-trades-room': '#ENGR-Trades-Tech'
    };
    openChat(chanKey, titles[chanKey] || `#${chanKey}`, true, true);
  });
});

// Open 1-on-1 / Channel Chat
async function openChat(target, title, isChannel = false, isOnline = false) {
  initAudio();
  if (state.chatSyncInterval) {
    clearInterval(state.chatSyncInterval);
    state.chatSyncInterval = null;
  }

  const cleanTarget = isChannel ? target.toLowerCase() : target.trim().toLowerCase().replace(/^@/, '');
  state.currentChatTarget = cleanTarget;
  state.isChannel = isChannel;
  state.isGroup = false;
  state.currentGroupId = null;
  state.renderedMsgIds.clear();

  // Smooth Native iOS Navigation Slide-In
  el.mainScreen.classList.add('chat-open');
  el.chatScreen.classList.remove('hidden');
  requestAnimationFrame(() => {
    el.chatScreen.classList.add('open');
  });

  el.chatPartnerTitle.textContent = title;
  el.chatPartnerAvatar.textContent = title.replace(/^#/, '').charAt(0).toUpperCase();

  // Twitter / X Blue Tick in Chat Header
  if (!isChannel && state.trustedUsersSet.has(cleanTarget)) {
    el.partnerBlueTick.classList.remove('hidden');
  } else {
    el.partnerBlueTick.classList.add('hidden');
  }

  // Clear unread badge immediately for this friend
  const friendObj = state.friends.find(f => f.username.toLowerCase() === cleanTarget);
  if (friendObj) {
    friendObj.unreadCount = 0;
    const totalUnread = state.friends.reduce((acc, f) => acc + (f.unreadCount || 0), 0);
    if (el.chatsBadge) {
      if (totalUnread > 0) {
        el.chatsBadge.textContent = totalUnread;
        el.chatsBadge.classList.remove('hidden');
      } else {
        el.chatsBadge.classList.add('hidden');
      }
    }
  }

  if (isChannel) {
    el.chatPartnerSubtitle.textContent = 'Campus Public Room';
    if (el.btnStartCall) el.btnStartCall.classList.add('hidden');
  } else {
    el.chatPartnerSubtitle.textContent = isOnline ? 'online' : 'last seen recently';
    if (el.btnStartCall) el.btnStartCall.classList.remove('hidden');
  }

  if (el.messageTextInput) {
    el.messageTextInput.value = '';
    updateInputState();
  }

  // Instant offline cache load from local device storage
  const cachedDirect = loadFromOfflineCache(`messages_${cleanTarget}`);
  if (cachedDirect && Array.isArray(cachedDirect) && cachedDirect.length > 0) {
    el.messagesContainer.innerHTML = '';
    cachedDirect.forEach(m => {
      const mSender = (m.sender || '').trim().toLowerCase().replace(/^@/, '');
      const isSent = (mSender === state.currentUser.username.toLowerCase());
      state.renderedMsgIds.add(m.id);
      appendMessageToChat(m, isSent);
    });
    scrollToBottom(false);
  } else {
    el.messagesContainer.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-light)">Loading messages...</div>';
  }

  // Initial load
  await fetchAndRenderChatMessages(true);
  loadPinnedMessages();

  // Active sync loop: fetches any new messages every 700ms while chat screen is open (instant feel!)
  state.chatSyncInterval = setInterval(() => {
    if (!el.chatScreen.classList.contains('hidden') && state.currentChatTarget && !state.isGroup) {
      fetchAndRenderChatMessages(false);
      checkActiveCallFallback();
    }
  }, 700);
}

// Open WhatsApp-Style Group Chat
async function openGroupChat(groupId, groupName, avatarColor, avatarImage) {
  initAudio();
  if (state.chatSyncInterval) {
    clearInterval(state.chatSyncInterval);
    state.chatSyncInterval = null;
  }

  state.currentChatTarget = groupId;
  state.isGroup = true;
  state.isChannel = false;
  state.currentGroupId = groupId;
  state.renderedMsgIds.clear();

  el.mainScreen.classList.add('chat-open');
  el.chatScreen.classList.remove('hidden');
  requestAnimationFrame(() => {
    el.chatScreen.classList.add('open');
  });

  el.chatPartnerTitle.textContent = groupName;
  el.chatPartnerAvatar.style.backgroundColor = avatarColor || '#075E54';
  if (avatarImage) {
    el.chatPartnerAvatar.innerHTML = `<img src="${avatarImage}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
  } else {
    el.chatPartnerAvatar.textContent = groupName.charAt(0).toUpperCase() || '👥';
  }

  el.partnerBlueTick.classList.add('hidden');
  if (el.btnStartCall) el.btnStartCall.classList.add('hidden');
  el.chatPartnerSubtitle.textContent = 'Group • Loading participants...';

  updateGroupChatHeaderSubtitle(groupId);

  if (el.messageTextInput) {
    el.messageTextInput.value = '';
    updateInputState();
  }

  // Instant offline cache load for group
  const cachedGroup = loadFromOfflineCache(`messages_group_${groupId}`);
  if (cachedGroup && Array.isArray(cachedGroup) && cachedGroup.length > 0) {
    el.messagesContainer.innerHTML = '';
    cachedGroup.forEach(m => {
      const mSender = (m.sender || '').trim().toLowerCase().replace(/^@/, '');
      const isSent = (mSender === state.currentUser.username.toLowerCase());
      state.renderedMsgIds.add(m.id);
      appendMessageToChat(m, isSent);
    });
    scrollToBottom(false);
  } else {
    el.messagesContainer.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-light)">Loading group messages...</div>';
  }

  await fetchAndRenderChatMessages(true);
  loadPinnedMessages();

  state.chatSyncInterval = setInterval(() => {
    if (!el.chatScreen.classList.contains('hidden') && state.isGroup && state.currentGroupId === groupId) {
      fetchAndRenderChatMessages(false);
    }
  }, 700);
}

// Update Group Chat Header Subtitle (Participant Names)
async function updateGroupChatHeaderSubtitle(groupId) {
  try {
    const res = await fetch(`/api/groups/info?groupId=${encodeURIComponent(groupId)}&username=${encodeURIComponent(state.currentUser.username)}`);
    const data = await res.json();
    if (data.success && data.members) {
      state.currentGroupInfo = data;
      const names = data.members.map(m => m.displayName || m.username);
      const snippet = names.slice(0, 3).join(', ') + (names.length > 3 ? `, +${names.length - 3} more` : '');
      if (state.isGroup && state.currentGroupId === groupId) {
        el.chatPartnerSubtitle.textContent = `${snippet} • Tap for info`;
      }
    }
  } catch (_) {}
}

// Fetch and render messages for active chat
async function fetchAndRenderChatMessages(isInitial = false) {
  if (!state.currentChatTarget || !state.currentUser) return;

  const targetKey = state.isGroup ? `group_${state.currentGroupId}` : state.currentChatTarget.toLowerCase();
  const offlineKey = `messages_${targetKey}`;

  // If browser is offline, reveal offline banner and load cache
  if (!navigator.onLine) {
    if (el.offlineChatBanner) el.offlineChatBanner.classList.remove('hidden');
    const cached = loadFromOfflineCache(offlineKey);
    if (cached && Array.isArray(cached) && isInitial) {
      el.messagesContainer.innerHTML = '';
      cached.forEach(m => {
        const mSender = (m.sender || '').trim().toLowerCase().replace(/^@/, '');
        const isSent = (mSender === state.currentUser.username.toLowerCase());
        state.renderedMsgIds.add(m.id);
        appendMessageToChat(m, isSent);
      });
      scrollToBottom(false);
    }
    return;
  }

  try {
    let url;
    if (state.isGroup) {
      url = `/api/messages/history?target=${encodeURIComponent(state.currentGroupId)}&isGroup=true`;
    } else if (state.isChannel) {
      url = `/api/messages/history?target=${encodeURIComponent(state.currentChatTarget)}&channel=true`;
    } else {
      url = `/api/messages/history?me=${encodeURIComponent(state.currentUser.username)}&target=${encodeURIComponent(state.currentChatTarget)}`;
    }

    const res = await fetch(url);
    if (!res.ok) {
      if (el.offlineChatBanner) el.offlineChatBanner.classList.remove('hidden');
      return;
    }

    if (el.offlineChatBanner) el.offlineChatBanner.classList.add('hidden');
    const data = await res.json();
    const messages = data.messages || [];
    state.chats[state.currentChatTarget] = messages;

    // Save recent messages into local device offline storage (limit to latest 200 messages)
    try {
      saveToOfflineCache(offlineKey, messages.slice(-200));
    } catch (_) {}

    if (isInitial) {
      el.messagesContainer.innerHTML = '';
      if (messages.length === 0) {
        el.messagesContainer.innerHTML = `<div id="chat-empty-hint" style="text-align:center;padding:30px 20px;color:var(--text-light);font-size:13px">
          🔒 Real-time chat ready! Send a message to start chatting with ${el.chatPartnerTitle.textContent}.
        </div>`;
      }
    }

    const emptyHint = document.getElementById('chat-empty-hint');
    if (messages.length > 0 && emptyHint) {
      emptyHint.remove();
    }

    let hasNewReceived = false;

    messages.forEach(m => {
      const mSender = (m.sender || '').trim().toLowerCase().replace(/^@/, '');
      const myUsername = state.currentUser.username.toLowerCase();
      const isSent = (mSender === myUsername);

      if (!state.renderedMsgIds.has(m.id)) {
        state.renderedMsgIds.add(m.id);
        appendMessageToChat(m, isSent);
        if (!isSent && !isInitial) {
          hasNewReceived = true;
        }
      } else {
        // Update read status to Read if recipient viewed
        if (isSent && m.status === 'read') {
          const bubble = document.querySelector(`.message-bubble[data-msg-id="${m.id}"]`);
          if (bubble) {
            const statusEl = bubble.querySelector('.imessage-status');
            if (statusEl && !statusEl.classList.contains('read')) {
              statusEl.textContent = 'Read';
              statusEl.classList.add('read');
            }
          }
        }
      }
    });

    if (hasNewReceived) {
      playReceivedSound();
      scrollToBottom();
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.text) fetchSmartReplies(lastMsg.text);
    } else if (isInitial && messages.length > 0) {
      scrollToBottom();
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.text) fetchSmartReplies(lastMsg.text);
    }

    if (isInitial) {
      loadChatScheduledMessages();
    }
  } catch (err) {
    console.error('Chat sync error:', err);
    if (el.offlineChatBanner) el.offlineChatBanner.classList.remove('hidden');
    const cached = loadFromOfflineCache(offlineKey);
    if (cached && Array.isArray(cached) && isInitial && state.renderedMsgIds.size === 0) {
      el.messagesContainer.innerHTML = '';
      cached.forEach(m => {
        const mSender = (m.sender || '').trim().toLowerCase().replace(/^@/, '');
        const isSent = (mSender === state.currentUser.username.toLowerCase());
        state.renderedMsgIds.add(m.id);
        appendMessageToChat(m, isSent);
      });
      scrollToBottom(false);
    }
  }
}

// Append Message to UI (WhatsApp & iMessage Hybrid Style)
function appendMessageToChat(msg, isSent) {
  // WhatsApp-style Centered System Message Pill (e.g. "Alex created group 'COSC 111'")
  if (msg.sender === 'System' || msg.sender === 'OC System') {
    const sysDiv = document.createElement('div');
    sysDiv.className = 'chat-system-message';
    sysDiv.dataset.msgId = msg.id;
    sysDiv.innerHTML = `<span class="chat-system-pill">${escapeHtml(msg.text)}</span>`;
    el.messagesContainer.appendChild(sysDiv);
    return;
  }

  const bubble = document.createElement('div');
  bubble.className = `message-bubble ${isSent ? 'sent' : 'received'}`;
  bubble.dataset.msgId = msg.id;

  let senderNameHtml = '';
  if (!isSent && state.isGroup) {
    const senderColor = getAvatarColor(msg.sender);
    const displayName = msg.displayName || `@${msg.sender}`;
    senderNameHtml = `<span class="group-sender-tag" style="color: ${senderColor};">${escapeHtml(displayName)}</span>`;
  } else if (!isSent && state.isChannel) {
    senderNameHtml = `<span class="message-sender-name">@${msg.sender}</span>`;
  }

  // 1. Photos
  let imageHtml = '';
  if (msg.image) {
    imageHtml = `<img src="${msg.image}" class="message-image" alt="Shared photo" loading="lazy" />`;
  }

  // 2. All file types & videos (PDFs, Books, Articles, Docs, Code, Media)
  let fileHtml = '';
  if (msg.file) {
    const fType = msg.file.type || '';
    const fName = msg.file.name || 'Attachment';
    if (fType.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(fName)) {
      fileHtml = `<video src="${msg.file.data}" controls class="message-video" playsinline preload="metadata"></video>`;
    } else if (fType.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(fName)) {
      fileHtml = `<img src="${msg.file.data}" class="message-image" alt="${escapeHtml(fName)}" loading="lazy" />`;
    } else {
      fileHtml = `
        <div class="file-attachment-card file-card-clickable" data-msg-id="${msg.id || ''}" data-file-name="${escapeHtml(fName)}" title="Tap to Open & Read Document">
          <span class="file-card-icon">${getFileIcon(fName)}</span>
          <div class="file-card-details">
            <div class="file-card-name">${escapeHtml(fName)}</div>
            <div class="file-card-size">${formatBytes(msg.file.size)}</div>
          </div>
          <span class="file-action-badge">Open 📖</span>
          <button type="button" class="file-download-icon btn-direct-download" title="Save file to device" data-msg-id="${msg.id || ''}">⬇️</button>
        </div>
      `;
    }
  }

  // 3. Call Details in Chat History (WhatsApp / iOS Style)
  let callHtml = '';
  if (msg.call) {
    const isMissed = msg.call.status === 'missed';
    const isDeclined = msg.call.status === 'declined';
    const durText = msg.call.duration > 0 ? formatAudioDuration(msg.call.duration) : (isMissed ? 'Missed' : 'Declined');
    const icon = isMissed ? '📞' : (isDeclined ? '📵' : '📞');
    const title = isMissed ? 'Missed Voice Call' : (isDeclined ? 'Declined Call' : 'Voice Call');
    callHtml = `
      <div class="call-history-card ${msg.call.status}">
        <div class="call-icon-circle ${isMissed ? 'missed' : 'success'}">${icon}</div>
        <div class="call-info">
          <div class="call-title">${title}</div>
          <div class="call-subtitle">${durText} • ${formatTime(msg.timestamp)}</div>
        </div>
        <button class="btn-call-back" type="button" data-partner="${isSent ? (state.currentChatTarget || '') : msg.sender}" title="Call Back">Call back</button>
      </div>
    `;
  }

  // 4. Playable Voice Message
  let voiceHtml = '';
  if (msg.voice) {
    const dur = formatAudioDuration(msg.voice.duration || 0);
    voiceHtml = `
      <div class="voice-bubble-container" data-audio-src="${msg.voice.data}">
        <button class="btn-play-voice" type="button" title="Play Voice Note">▶</button>
        <div class="voice-waveform-wrap">
          <div class="voice-progress-bar">
            <div class="voice-progress-fill"></div>
          </div>
          <div class="voice-meta-row">
            <span class="voice-duration">${dur}</span>
            <span>🎤 Voice Note</span>
          </div>
        </div>
        <button class="voice-speed-pill" type="button" title="Playback Speed">1x</button>
        <audio src="${msg.voice.data}" preload="metadata" class="hidden"></audio>
      </div>
    `;
  }

  // 5. Rich Study & Campus Cards (Open APIs)
  let studyCardHtml = '';
  if (msg.studyCard) {
    const sc = msg.studyCard;
    if (sc.type === 'wiki') {
      studyCardHtml = `
        <div class="study-card-bubble study-card-clickable" data-study-type="wiki">
          <div class="study-card-header">
            <span class="study-card-tag tag-wiki">Wikipedia Explainer</span>
            <span>📖</span>
          </div>
          <div class="study-card-title">${escapeHtml(sc.title || '')}</div>
          <div class="study-card-body">${escapeHtml(sc.extract || '')}</div>
          <div class="study-card-action-row">
            <button type="button" class="btn-study-card-action btn-read-study-article">
              <span>Read Article 📖</span>
            </button>
            ${sc.url ? `<a href="${sc.url}" target="_blank" rel="noopener noreferrer" class="study-card-link" style="margin:0;font-size:11.5px;">Wikipedia ↗</a>` : ''}
          </div>
        </div>
      `;
    } else if (sc.type === 'book') {
      studyCardHtml = `
        <div class="study-card-bubble study-card-clickable" data-study-type="book">
          <div class="study-card-header">
            <span class="study-card-tag tag-book">Open Library Book</span>
            <span>📚</span>
          </div>
          <div class="study-card-title">${escapeHtml(sc.title || '')}</div>
          <div class="study-card-body">By <strong>${escapeHtml(sc.author || 'Unknown')}</strong> (${escapeHtml(String(sc.year || ''))})</div>
          <div class="study-card-action-row">
            <button type="button" class="btn-study-card-action btn-read-study-book">
              <span>View Book Details 📚</span>
            </button>
            ${sc.url ? `<a href="${sc.url}" target="_blank" rel="noopener noreferrer" class="study-card-link" style="margin:0;font-size:11.5px;">Open Library ↗</a>` : ''}
          </div>
        </div>
      `;
    } else if (sc.type === 'joke') {
      studyCardHtml = `
        <div class="study-card-bubble">
          <div class="study-card-header">
            <span class="study-card-tag tag-joke">Study Break Joke</span>
            <span>😂</span>
          </div>
          <div class="study-card-title">${escapeHtml(sc.setup || '')}</div>
          <div class="study-card-body" style="font-style:italic;color:#FDBA74;margin-top:4px;">${escapeHtml(sc.punchline || '')}</div>
        </div>
      `;
    } else if (sc.type === 'weather') {
      studyCardHtml = `
        <div class="study-card-bubble">
          <div class="study-card-header">
            <span class="study-card-tag tag-weather">${escapeHtml(sc.campus || 'Campus Weather')}</span>
            <span>🌤️</span>
          </div>
          <div class="study-card-weather-grid">
            <div class="study-card-weather-emoji">${sc.emoji || '🌤️'}</div>
            <div class="study-card-weather-info">
              <span class="study-card-weather-temp">${escapeHtml(sc.tempString || '')} • ${escapeHtml(sc.condition || '')}</span>
              <span class="study-card-weather-desc">Humidity: ${escapeHtml(sc.humidity || '')} | Wind: ${escapeHtml(sc.wind || '')}</span>
            </div>
          </div>
          <div class="study-card-body" style="margin-top:6px;font-size:12px;color:#86EFAC;">🚶 ${escapeHtml(sc.advice || '')}</div>
        </div>
      `;
    } else if (sc.type === 'define') {
      studyCardHtml = `
        <div class="study-card-bubble">
          <div class="study-card-header">
            <span class="study-card-tag tag-define">Dictionary • ${escapeHtml(sc.partOfSpeech || 'noun')}</span>
            <span>📖</span>
          </div>
          <div class="study-card-title">${escapeHtml(sc.word || '')} <span style="font-size:12px;font-weight:400;opacity:0.8;">${escapeHtml(sc.phonetic || '')}</span></div>
          <div class="study-card-body">
            <strong>Definition:</strong> ${escapeHtml(sc.definition || '')}
            ${sc.example ? `<div style="margin-top:4px;font-style:italic;opacity:0.9;">"${escapeHtml(sc.example)}"</div>` : ''}
          </div>
          ${sc.sourceUrl ? `
            <div class="study-card-action-row">
              <a href="${sc.sourceUrl}" target="_blank" rel="noopener noreferrer" class="study-card-link" style="margin:0;font-size:11.5px;">Wiktionary ↗</a>
            </div>
          ` : ''}
        </div>
      `;
    } else if (sc.type === 'convert') {
      studyCardHtml = `
        <div class="study-card-bubble">
          <div class="study-card-header">
            <span class="study-card-tag tag-convert">Currency Conversion</span>
            <span>💱</span>
          </div>
          <div class="study-card-title">${escapeHtml(String(sc.amount))} ${escapeHtml(sc.from)} = ${escapeHtml(String(sc.result))} ${escapeHtml(sc.to)}</div>
          <div class="study-card-body" style="font-size:12px;">
            Exchange Rate: 1 ${escapeHtml(sc.from)} = ${escapeHtml(String(sc.rate))} ${escapeHtml(sc.to)}
          </div>
        </div>
      `;
    } else if (sc.type === 'location') {
      studyCardHtml = `
        <div class="study-card-bubble">
          <div class="study-card-header">
            <span class="study-card-tag tag-location">${escapeHtml(sc.campus || 'Okanagan College')}</span>
            <span>📍</span>
          </div>
          <div class="study-card-title">${escapeHtml(sc.name || '')}</div>
          <div class="study-card-body">
            <div><strong>${escapeHtml(sc.building || '')}</strong></div>
            <div style="margin-top:2px;font-size:12px;opacity:0.9;">${escapeHtml(sc.details || '')}</div>
          </div>
          ${sc.mapUrl ? `
            <div class="study-card-action-row">
              <a href="${sc.mapUrl}" target="_blank" rel="noopener noreferrer" class="study-card-link" style="margin:0;font-size:11.5px;">Open in Maps ↗</a>
            </div>
          ` : ''}
        </div>
      `;
    } else if (sc.type === 'advice') {
      studyCardHtml = `
        <div class="study-card-bubble">
          <div class="study-card-header">
            <span class="study-card-tag tag-advice">Student Life Tip</span>
            <span>💡</span>
          </div>
          <div class="study-card-body" style="font-size:13.5px;font-weight:500;line-height:1.4;">
            "${escapeHtml(sc.advice || '')}"
          </div>
        </div>
      `;
    }
  }

  let textHtml = '';
  let otpChipHtml = '';
  if (msg.text) {
    textHtml = `<div class="message-text">${escapeHtml(msg.text)}</div>`;
    // Detect 4-8 digit OTP verification codes or student numbers
    const otpMatch = msg.text.match(/\b\d{4,8}\b/);
    if (otpMatch) {
      otpChipHtml = `<div style="margin-top:4px;"><button type="button" class="otp-copy-chip" data-code="${otpMatch[0]}" title="Copy code to clipboard">📋 Copy ${otpMatch[0]}</button></div>`;
    }
  }

  const isStarred = state.starredMessageIds.has(msg.id);
  const starBtnHtml = `<button type="button" class="msg-star-btn ${isStarred ? 'starred' : ''}" data-msg-id="${msg.id}" title="${isStarred ? 'Unstar message' : 'Star message'}">${isStarred ? '⭐' : '☆'}</button>`;

  let statusHtml = '';
  if (isSent) {
    const isRead = msg.status === 'read';
    statusHtml = `<div class="imessage-status ${isRead ? 'read' : ''}">${isRead ? 'Read' : 'Delivered'} ${starBtnHtml}</div>`;
  } else {
    statusHtml = `<div class="imessage-status" style="justify-content: flex-end;">${starBtnHtml}</div>`;
  }

  let replyToHtml = '';
  if (msg.replyTo) {
    const rSender = msg.replyTo.displayName || msg.replyTo.sender || 'Original message';
    const rText = msg.replyTo.text || 'Shared attachment';
    replyToHtml = `
      <div class="message-quoted-preview" data-reply-id="${escapeHtml(msg.replyTo.id || '')}" title="Tap to jump to original message">
        <div class="quoted-body">
          <div class="quoted-sender">${escapeHtml(rSender)}</div>
          <div class="quoted-text">${escapeHtml(rText)}</div>
        </div>
      </div>
    `;
  }

  let linkPreviewHtml = '';
  let detectedUrl = null;
  if (msg.text) {
    const urlMatch = msg.text.match(/https?:\/\/[^\s]+/i);
    if (urlMatch) {
      detectedUrl = urlMatch[0];
      linkPreviewHtml = `<div class="message-link-preview-slot" data-url="${escapeHtml(detectedUrl)}"></div>`;
    }
  }

  bubble.innerHTML = `
    ${senderNameHtml}
    ${replyToHtml}
    ${imageHtml}
    ${fileHtml}
    ${callHtml}
    ${voiceHtml}
    ${studyCardHtml}
    ${textHtml}
    ${linkPreviewHtml}
    ${otpChipHtml}
    ${statusHtml}
  `;

  if (detectedUrl) {
    const slot = bubble.querySelector('.message-link-preview-slot');
    if (slot) {
      fetchLinkPreview(detectedUrl, slot);
    }
  }

  // Attach Quoted Message Jump Click
  const quoteEl = bubble.querySelector('.message-quoted-preview');
  if (quoteEl) {
    quoteEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetId = quoteEl.dataset.replyId;
      if (targetId) {
        const targetBubble = document.querySelector(`.message-bubble[data-msg-id="${targetId}"]`);
        if (targetBubble) {
          targetBubble.scrollIntoView({ behavior: 'smooth', block: 'center' });
          targetBubble.classList.remove('flash-highlight');
          void targetBubble.offsetWidth;
          targetBubble.classList.add('flash-highlight');
        } else {
          showToast('Original message earlier in chat', '📜');
        }
      }
    });
  }

  // Attach OTP copy chip click
  const otpBtn = bubble.querySelector('.otp-copy-chip');
  if (otpBtn) {
    otpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const code = otpBtn.dataset.code;
      navigator.clipboard.writeText(code).then(() => {
        showToast(`Copied "${code}" to clipboard! 📋`, '✅');
      });
    });
  }

  // Attach Star Message Button click
  const starBtn = bubble.querySelector('.msg-star-btn');
  if (starBtn) {
    starBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleStarMessage(msg.id, starBtn);
    });
  }

  // Attach Lightbox click on images
  bubble.querySelectorAll('.message-image').forEach(img => {
    img.style.cursor = 'pointer';
    img.addEventListener('click', () => openLightbox(img.src));
  });

  // Attach Document & Book Viewer click on file cards
  const fileCard = bubble.querySelector('.file-card-clickable');
  if (fileCard && msg.file) {
    fileCard.addEventListener('click', (e) => {
      if (e.target.closest('.btn-direct-download')) {
        e.stopPropagation();
        openOrDownloadAttachment(msg.file, msg.id, true);
        return;
      }
      openOrDownloadAttachment(msg.file, msg.id, false);
    });
  }

  // Attach Study Card Reader click on study cards
  const studyCardEl = bubble.querySelector('.study-card-clickable');
  if (studyCardEl && msg.studyCard) {
    studyCardEl.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      openStudyCardReader(msg.studyCard);
    });
  }

  // Attach Call Back click on call tiles
  const btnCallBack = bubble.querySelector('.btn-call-back');
  if (btnCallBack) {
    btnCallBack.addEventListener('click', (e) => {
      e.stopPropagation();
      const partner = btnCallBack.dataset.partner;
      if (partner && !state.isChannel) {
        initiateVoiceCall(partner);
      }
    });
  }

  // Attach audio playback listener if voice note
  if (msg.voice) {
    const playBtn = bubble.querySelector('.btn-play-voice');
    const audioEl = bubble.querySelector('audio');
    const progressFill = bubble.querySelector('.voice-progress-fill');
    const durationLabel = bubble.querySelector('.voice-duration');

    if (playBtn && audioEl) {
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.currentlyPlayingAudio && state.currentlyPlayingAudio !== audioEl) {
          state.currentlyPlayingAudio.pause();
          state.currentlyPlayingAudio.currentTime = 0;
          document.querySelectorAll('.btn-play-voice').forEach(b => b.textContent = '▶');
        }

        if (audioEl.paused) {
          audioEl.play().then(() => {
            playBtn.textContent = '⏸';
            state.currentlyPlayingAudio = audioEl;
          }).catch(() => {});
        } else {
          audioEl.pause();
          playBtn.textContent = '▶';
        }
      });

      audioEl.addEventListener('timeupdate', () => {
        if (audioEl.duration) {
          const pct = (audioEl.currentTime / audioEl.duration) * 100;
          progressFill.style.width = pct + '%';
          durationLabel.textContent = formatAudioDuration(audioEl.currentTime);
        }
      });

      audioEl.addEventListener('ended', () => {
        playBtn.textContent = '▶';
        progressFill.style.width = '0%';
        durationLabel.textContent = formatAudioDuration(msg.voice.duration || 0);
        state.currentlyPlayingAudio = null;
      });

      // Click-to-seek audio scrubbing
      const progressBar = bubble.querySelector('.voice-progress-bar');
      if (progressBar) {
        progressBar.style.cursor = 'pointer';
        progressBar.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!audioEl.duration) return;
          const rect = progressBar.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const newPct = Math.max(0, Math.min(1, clickX / rect.width));
          audioEl.currentTime = newPct * audioEl.duration;
          progressFill.style.width = (newPct * 100) + '%';
          durationLabel.textContent = formatAudioDuration(audioEl.currentTime);
        });
      }

      // Voice note playback speed toggle (1x -> 1.5x -> 2x)
      const speedBtn = bubble.querySelector('.voice-speed-pill');
      if (speedBtn) {
        speedBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const speeds = [1, 1.5, 2];
          const curRate = audioEl.playbackRate || 1;
          const nextIdx = (speeds.indexOf(curRate) + 1) % speeds.length;
          const nextRate = speeds[nextIdx >= 0 ? nextIdx : 0];
          audioEl.playbackRate = nextRate;
          speedBtn.textContent = `${nextRate}x`;
          triggerHapticFeedback([12]);
        });
      }
    }
  }

  // Wrapper for swipe-to-reply physics and icon
  const wrapper = document.createElement('div');
  wrapper.className = `message-bubble-wrapper ${isSent ? 'sent' : 'received'}`;
  wrapper.dataset.msgId = msg.id;

  const swipeIcon = document.createElement('div');
  swipeIcon.className = 'swipe-reply-icon';
  swipeIcon.innerHTML = '↩️';
  wrapper.appendChild(swipeIcon);
  wrapper.appendChild(bubble);

  // Render Persisted Reactions
  renderBubbleReactions(bubble, msg.reactions, msg.id);

  // Attach Native Touch & Drag Swipe-to-Reply
  attachSwipeToReply(wrapper, bubble, msg);

  el.messagesContainer.appendChild(wrapper);
}

// ===========================================================================
// GOOGLE MESSAGES & RCS: EMOJI REACTIONS ENGINE
// ===========================================================================
let activeReactionBubble = null;
let activeReactionMsg = null;
const reactionPopover = document.getElementById('reaction-popover');

function renderBubbleReactions(bubbleEl, reactionsObj, msgId) {
  let wrap = bubbleEl.querySelector('.message-reactions-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'message-reactions-wrap';
    bubbleEl.appendChild(wrap);
  }
  wrap.innerHTML = '';
  if (!reactionsObj || typeof reactionsObj !== 'object') return;

  const myUsername = state.currentUser ? state.currentUser.username.toLowerCase() : '';

  Object.entries(reactionsObj).forEach(([emoji, rData]) => {
    if (!rData || !rData.count || rData.count <= 0) return;
    const users = Array.isArray(rData.users) ? rData.users : [];
    const hasMyReaction = users.some(u => u.toLowerCase() === myUsername);

    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = `reaction-pill-badge ${hasMyReaction ? 'active' : ''}`;
    pill.dataset.emoji = emoji;
    pill.dataset.msgId = msgId;
    pill.title = users.map(u => `@${u}`).join(', ');
    pill.innerHTML = `<span>${emoji}</span>${rData.count > 1 ? `<span class="reaction-count">${rData.count}</span>` : ''}`;

    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      pill.style.transform = 'scale(1.2)';
      setTimeout(() => { pill.style.transform = ''; }, 150);
      toggleMessageReaction(msgId, emoji);
    });

    wrap.appendChild(pill);
  });
}

async function toggleMessageReaction(msgId, emoji) {
  if (!state.currentUser || !msgId || !emoji) return;

  playSentSound();
  if (['🎓', '🔥', '❤️', '🎉', '👏'].includes(emoji)) {
    triggerCelebrationEffect(emoji === '🎓' ? 'campus' : (emoji === '🔥' ? 'hype' : 'congrats'));
  }

  try {
    const res = await fetch('/api/messages/react', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messageId: msgId,
        username: state.currentUser.username,
        emoji: emoji
      })
    });
    const data = await res.json();
    if (data.success && data.reactions) {
      const bubble = document.querySelector(`.message-bubble[data-msg-id="${msgId}"]`);
      if (bubble) {
        renderBubbleReactions(bubble, data.reactions, msgId);
      }
    }
  } catch (err) {
    console.error('Reaction toggle error:', err);
  }
}

function handleMessageReactionUpdated(payload) {
  const { messageId, reactions, emoji } = payload;
  if (!messageId) return;

  const bubble = document.querySelector(`.message-bubble[data-msg-id="${messageId}"]`);
  if (bubble) {
    renderBubbleReactions(bubble, reactions, messageId);
    const pill = bubble.querySelector(`.reaction-pill-badge[data-emoji="${emoji}"]`);
    if (pill) {
      pill.style.transform = 'scale(1.3)';
      setTimeout(() => { pill.style.transform = ''; }, 220);
    }
  }
}

function showReactionPopover(bubbleEl, event, msg) {
  activeReactionBubble = bubbleEl;
  activeReactionMsg = msg;
  if (!reactionPopover) return;

  const rect = bubbleEl.getBoundingClientRect();
  const containerRect = el.messagesContainer.getBoundingClientRect();

  reactionPopover.classList.remove('hidden');

  const popoverWidth = 330;
  const topPos = (rect.top - containerRect.top) + el.messagesContainer.scrollTop - 52;
  const leftPos = Math.max(10, Math.min(containerRect.width - popoverWidth - 10, (rect.left - containerRect.left) + (rect.width / 2) - (popoverWidth / 2)));

  reactionPopover.style.top = `${Math.max(8, topPos)}px`;
  reactionPopover.style.left = `${Math.max(8, leftPos)}px`;
}

function hideReactionPopover() {
  if (reactionPopover) {
    reactionPopover.classList.add('hidden');
  }
  activeReactionBubble = null;
  activeReactionMsg = null;
}

// Popover quick reactions
document.querySelectorAll('.reaction-emoji-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const emoji = btn.dataset.reaction;
    if (activeReactionMsg && emoji) {
      toggleMessageReaction(activeReactionMsg.id, emoji);
    }
    hideReactionPopover();
  });
});

// Popover action buttons
const popoverBtnReply = document.getElementById('popover-btn-reply');
if (popoverBtnReply) {
  popoverBtnReply.addEventListener('click', (e) => {
    e.stopPropagation();
    if (activeReactionMsg) {
      startReply(activeReactionMsg);
    }
    hideReactionPopover();
  });
}

const popoverBtnStar = document.getElementById('popover-btn-star');
if (popoverBtnStar) {
  popoverBtnStar.addEventListener('click', (e) => {
    e.stopPropagation();
    if (activeReactionMsg) {
      const bubble = activeReactionBubble;
      const starBtn = bubble ? bubble.querySelector('.msg-star-btn') : null;
      toggleStarMessage(activeReactionMsg.id, starBtn);
    }
    hideReactionPopover();
  });
}

const popoverBtnCopy = document.getElementById('popover-btn-copy');
if (popoverBtnCopy) {
  popoverBtnCopy.addEventListener('click', (e) => {
    e.stopPropagation();
    if (activeReactionMsg) {
      const text = activeReactionMsg.text || '';
      if (text) {
        navigator.clipboard.writeText(text).then(() => {
          showToast('Message text copied to clipboard! 📋', '✅');
        });
      } else {
        showToast('Attachment / Media message', 'ℹ️');
      }
    }
    hideReactionPopover();
  });
}

const popoverBtnPin = document.getElementById('popover-btn-pin');
if (popoverBtnPin) {
  popoverBtnPin.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (activeReactionMsg) {
      const isCurrentlyPinned = state.pinnedMessages && state.pinnedMessages.some(m => m.id === activeReactionMsg.id);
      await togglePinMessage(activeReactionMsg.id, !isCurrentlyPinned);
    }
    hideReactionPopover();
  });
}

// Click outside reaction popover to close
document.addEventListener('click', (e) => {
  if (reactionPopover && !reactionPopover.contains(e.target) && !e.target.closest('.message-bubble')) {
    hideReactionPopover();
  }
});

// ===========================================================================
// GOOGLE MESSAGES: QUOTED REPLIES & SWIPE-TO-REPLY
// ===========================================================================
function startReply(msg) {
  if (!msg) return;
  const snippet = msg.text || (msg.voice ? '🎤 Voice note' : (msg.file ? `📎 ${msg.file.name || 'File'}` : (msg.image ? '📷 Photo' : (msg.studyCard ? '📚 Study card' : 'Message'))));
  const senderDisplay = msg.displayName || (msg.sender ? `@${msg.sender}` : 'Classmate');

  state.replyingTo = {
    id: msg.id,
    sender: msg.sender,
    displayName: senderDisplay,
    text: snippet.length > 90 ? snippet.substring(0, 90) + '…' : snippet
  };

  if (el.replyPreviewSender) {
    el.replyPreviewSender.textContent = `Replying to ${senderDisplay}`;
  }
  if (el.replyPreviewSnippet) {
    el.replyPreviewSnippet.textContent = state.replyingTo.text;
  }
  if (el.replyPreviewBar) {
    el.replyPreviewBar.classList.remove('hidden');
  }

  if (el.messageTextInput) {
    el.messageTextInput.focus();
  }
}

function cancelReply() {
  state.replyingTo = null;
  if (el.replyPreviewBar) {
    el.replyPreviewBar.classList.add('hidden');
  }
}

if (el.btnCancelReply) {
  el.btnCancelReply.addEventListener('click', cancelReply);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (state.replyingTo) {
      cancelReply();
    }
    hideReactionPopover();
  }
});

function attachSwipeToReply(wrapper, bubble, msg) {
  let startX = 0;
  let startY = 0;
  let isSwiping = false;
  let currentTranslate = 0;
  let longPressTimer = null;

  bubble.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    isSwiping = false;
    currentTranslate = 0;

    longPressTimer = setTimeout(() => {
      if (!isSwiping) {
        if (navigator.vibrate) navigator.vibrate(25);
        showReactionPopover(bubble, touch, msg);
      }
    }, 450);
  }, { passive: true });

  bubble.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;

    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      clearTimeout(longPressTimer);
    }

    if (dx > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      isSwiping = true;
      wrapper.classList.add('swiping-active');
      bubble.classList.add('swiping');

      currentTranslate = Math.min(75, dx * 0.65);
      bubble.style.transform = `translateX(${currentTranslate}px)`;

      if (currentTranslate >= 42) {
        if (!wrapper.classList.contains('swipe-ready')) {
          wrapper.classList.add('swipe-ready');
          if (navigator.vibrate) navigator.vibrate(15);
        }
      } else {
        wrapper.classList.remove('swipe-ready');
      }
    }
  }, { passive: true });

  bubble.addEventListener('touchend', () => {
    clearTimeout(longPressTimer);
    if (isSwiping) {
      if (currentTranslate >= 42) {
        startReply(msg);
        playSentSound();
      }
      isSwiping = false;
      wrapper.classList.remove('swiping-active');
      wrapper.classList.remove('swipe-ready');
      bubble.classList.remove('swiping');
      bubble.style.transform = '';
    }
  });

  bubble.addEventListener('touchcancel', () => {
    clearTimeout(longPressTimer);
    isSwiping = false;
    wrapper.classList.remove('swiping-active');
    wrapper.classList.remove('swipe-ready');
    bubble.classList.remove('swiping');
    bubble.style.transform = '';
  });

  bubble.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showReactionPopover(bubble, e, msg);
  });

  bubble.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showReactionPopover(bubble, e, msg);
  });
}

// ===========================================================================
// CAMPUS CELEBRATIONS & SCREEN EFFECTS ENGINE (Confetti, Stars, Coffee, Safe)
// ===========================================================================
let screenEffectsCanvas = null;
let screenEffectsCtx = null;
let activeScreenParticles = [];
let screenEffectsAnimationId = null;

function initScreenEffectsCanvas() {
  screenEffectsCanvas = document.getElementById('screen-effects-canvas');
  if (!screenEffectsCanvas) return;
  screenEffectsCtx = screenEffectsCanvas.getContext('2d');

  function resizeCanvas() {
    if (!screenEffectsCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    screenEffectsCanvas.width = window.innerWidth * dpr;
    screenEffectsCanvas.height = window.innerHeight * dpr;
    if (screenEffectsCtx) screenEffectsCtx.scale(dpr, dpr);
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
}

function checkAndTriggerCelebrationEffect(text) {
  if (!text || typeof text !== 'string') return;
  const t = text.toLowerCase();

  if (/(congrat|congrats|passed|exam pass|graduat|yay|woohoo|cheers|awesome|celebrat|happy birthday)/.test(t)) {
    triggerCelebrationEffect('congrats');
  } else if (/(coffee|latte|espresso|klo tim|tim hortons|caffeine|study fuel)/.test(t)) {
    triggerCelebrationEffect('coffee');
  } else if (/(safe|home safe|walk me home|security safe|campus safety)/.test(t)) {
    triggerCelebrationEffect('safe');
  } else if (/(hype|fire|let's go|lets go|crushed it|legend)/.test(t)) {
    triggerCelebrationEffect('hype');
  }
}

function triggerCelebrationEffect(theme = 'congrats') {
  if (!screenEffectsCanvas || !screenEffectsCtx) {
    initScreenEffectsCanvas();
    if (!screenEffectsCanvas || !screenEffectsCtx) return;
  }

  const w = window.innerWidth;
  const h = window.innerHeight;
  const particleCount = 70;

  const colorPalettes = {
    congrats: ['#007AFF', '#FF9500', '#34C759', '#AF52DE', '#FF2D55', '#FFD60A'],
    campus: ['#075E54', '#128C7E', '#25D366', '#FFD60A', '#FFFFFF'],
    coffee: ['#795548', '#8D6E63', '#D7CCC8', '#FF9800', '#FFB74D'],
    safe: ['#34C759', '#30D158', '#32D74B', '#007AFF', '#64D2FF'],
    hype: ['#FF3B30', '#FF9500', '#FFCC00', '#FF2D55', '#AF52DE']
  };

  const emojiIcons = {
    congrats: ['🎓', '🎉', '⭐', '✨'],
    campus: ['🎓', '📚', '🌲', '🏆'],
    coffee: ['☕', '⚡', '🥐', '✨'],
    safe: ['🛡️', '✨', '💚', '🚶'],
    hype: ['🔥', '🚀', '💥', '⚡']
  };

  const palette = colorPalettes[theme] || colorPalettes.congrats;
  const icons = emojiIcons[theme] || emojiIcons.congrats;

  for (let i = 0; i < particleCount; i++) {
    const isEmoji = (i % 3 === 0);
    const startX = w * (0.2 + Math.random() * 0.6);
    const startY = h * (0.3 + Math.random() * 0.4);

    activeScreenParticles.push({
      x: startX,
      y: startY,
      vx: (Math.random() - 0.5) * 14,
      vy: -(Math.random() * 12 + 6),
      size: isEmoji ? (Math.random() * 14 + 16) : (Math.random() * 7 + 5),
      color: palette[Math.floor(Math.random() * palette.length)],
      isEmoji: isEmoji,
      char: icons[Math.floor(Math.random() * icons.length)],
      rotation: Math.random() * Math.PI * 2,
      vRotation: (Math.random() - 0.5) * 0.25,
      alpha: 1,
      gravity: 0.38,
      drag: 0.98,
      decay: Math.random() * 0.015 + 0.008
    });
  }

  if (!screenEffectsAnimationId) {
    runScreenEffectsLoop();
  }
}

function runScreenEffectsLoop() {
  if (!screenEffectsCtx || !screenEffectsCanvas) return;
  const w = window.innerWidth;
  const h = window.innerHeight;

  screenEffectsCtx.clearRect(0, 0, w, h);

  for (let i = activeScreenParticles.length - 1; i >= 0; i--) {
    const p = activeScreenParticles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.gravity;
    p.vx *= p.drag;
    p.rotation += p.vRotation;
    p.alpha -= p.decay;

    if (p.alpha <= 0 || p.y > h + 40) {
      activeScreenParticles.splice(i, 1);
      continue;
    }

    screenEffectsCtx.save();
    screenEffectsCtx.globalAlpha = Math.max(0, p.alpha);
    screenEffectsCtx.translate(p.x, p.y);
    screenEffectsCtx.rotate(p.rotation);

    if (p.isEmoji) {
      screenEffectsCtx.font = `${p.size}px sans-serif`;
      screenEffectsCtx.textAlign = 'center';
      screenEffectsCtx.textBaseline = 'middle';
      screenEffectsCtx.fillText(p.char, 0, 0);
    } else {
      screenEffectsCtx.fillStyle = p.color;
      screenEffectsCtx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.5);
    }

    screenEffectsCtx.restore();
  }

  if (activeScreenParticles.length > 0) {
    screenEffectsAnimationId = requestAnimationFrame(runScreenEffectsLoop);
  } else {
    screenEffectsCtx.clearRect(0, 0, w, h);
    screenEffectsAnimationId = null;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function scrollToBottom(smooth = true) {
  if (smooth && typeof el.messagesContainer.scrollTo === 'function') {
    el.messagesContainer.scrollTo({
      top: el.messagesContainer.scrollHeight,
      behavior: 'smooth'
    });
  } else {
    el.messagesContainer.scrollTop = el.messagesContainer.scrollHeight;
  }
}

// Back to Home with Smooth Slide-Out
el.btnBackToHome.addEventListener('click', () => {
  if (state.chatSyncInterval) {
    clearInterval(state.chatSyncInterval);
    state.chatSyncInterval = null;
  }
  state.currentChatTarget = null;
  state.renderedMsgIds.clear();

  // Smooth slide out to right
  el.chatScreen.classList.remove('open');
  el.mainScreen.classList.remove('chat-open');

  setTimeout(() => {
    if (!state.currentChatTarget) {
      el.chatScreen.classList.add('hidden');
    }
  }, 320);

  loadRecentChats();
  loadFriendsList();
});

// Send a Rich Study Card into the active chat
async function sendStudyCardMessage(studyCard, optionalText = '') {
  if (!state.currentChatTarget) {
    showToast('Open a chat to share this card!', '💬');
    return;
  }
  const tempId = 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
  state.renderedMsgIds.add(tempId);
  const tempMsg = {
    id: tempId,
    sender: state.currentUser.username,
    displayName: state.currentUser.displayName,
    text: optionalText,
    studyCard: studyCard,
    timestamp: Date.now(),
    status: 'sent'
  };
  const emptyHint = document.getElementById('chat-empty-hint');
  if (emptyHint) emptyHint.remove();
  appendMessageToChat(tempMsg, true);
  scrollToBottom();
  playSentSound();

  try {
    const body = {
      sender: state.currentUser.username,
      text: optionalText,
      studyCard: studyCard
    };
    if (state.isGroup) {
      body.groupId = state.currentGroupId;
    } else if (state.isChannel) {
      body.channel = state.currentChatTarget;
    } else {
      body.recipient = state.currentChatTarget;
    }
    const res = await fetch('/api/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.message && data.message.id) {
      state.renderedMsgIds.add(data.message.id);
      const tempBubble = document.querySelector(`.message-bubble[data-msg-id="${tempId}"]`);
      if (tempBubble) tempBubble.dataset.msgId = data.message.id;
    }
    loadRecentChats();
  } catch (err) {
    showToast('Failed to send card: ' + err.message, '❌');
  }
}

// Send Message
async function sendMessage() {
  const text = el.messageTextInput.value.trim();
  if (!text) return;
  if (!state.currentChatTarget) return;

  // Slash Commands Support: /wiki <query>, /book <query>, /joke, /weather [campus], /help
  if (text.startsWith('/')) {
    const parts = text.split(' ');
    const cmd = parts[0].toLowerCase();
    const arg = parts.slice(1).join(' ').trim();

    if (cmd === '/help') {
      el.messageTextInput.value = '';
      updateInputState();
      showToast('Commands: /wiki <topic>, /book <title>, /joke, /weather [campus]', '💡');
      return;
    }

    if (cmd === '/joke') {
      el.messageTextInput.value = '';
      updateInputState();
      showToast('Fetching college joke...', '😂');
      try {
        const data = await fetchStudyJoke();
        if (data && data.success) {
          await sendStudyCardMessage({
            type: 'joke',
            setup: data.setup,
            punchline: data.punchline
          });
          return;
        }
      } catch (err) {
        showToast('Joke API error: ' + err.message, '⚠️');
      }
    }

    if (cmd === '/weather') {
      el.messageTextInput.value = '';
      updateInputState();
      const campusCode = arg ? arg.toLowerCase() : (state.currentCampus || 'klo');
      showToast('Fetching campus weather...', '🌤️');
      try {
        const data = await fetchCampusWeather(campusCode);
        if (data && data.success) {
          await sendStudyCardMessage({
            type: 'weather',
            campus: data.campus,
            tempString: data.tempString,
            condition: data.condition,
            emoji: data.emoji,
            humidity: data.humidity,
            wind: data.wind,
            advice: data.advice
          });
          return;
        }
      } catch (err) {
        showToast('Weather API error: ' + err.message, '⚠️');
      }
    }

    if (cmd === '/wiki') {
      if (!arg) {
        showToast('Usage: /wiki <topic> (e.g. /wiki binary search)', '📖');
        return;
      }
      el.messageTextInput.value = '';
      updateInputState();
      showToast(`Searching Wikipedia for "${arg}"...`, '📖');
      try {
        const data = await fetchWikiSummary(arg);
        if (data && data.success) {
          await sendStudyCardMessage({
            type: 'wiki',
            title: data.title,
            extract: data.extract,
            url: data.url
          });
          return;
        } else {
          showToast(data?.error || 'Topic not found on Wikipedia.', '⚠️');
          return;
        }
      } catch (err) {
        showToast('Wikipedia API error: ' + err.message, '⚠️');
      }
    }

    if (cmd === '/define') {
      if (!arg) {
        showToast('Usage: /define <word> (e.g. /define algorithm)', '📖');
        return;
      }
      el.messageTextInput.value = '';
      updateInputState();
      showToast(`Looking up definition for "${arg}"...`, '📖');
      try {
        const data = await fetchWordDefinition(arg);
        if (data && data.success) {
          await sendStudyCardMessage({
            type: 'define',
            word: data.word,
            phonetic: data.phonetic,
            partOfSpeech: data.partOfSpeech,
            definition: data.definition,
            example: data.example,
            sourceUrl: data.sourceUrl
          });
          return;
        } else {
          showToast(data?.error || 'Word definition not found.', '⚠️');
          return;
        }
      } catch (err) {
        showToast('Dictionary API error: ' + err.message, '⚠️');
      }
    }

    if (cmd === '/convert') {
      el.messageTextInput.value = '';
      updateInputState();
      // Parse syntax: /convert 100 CAD to USD or /convert 50 USD to INR
      let amt = 100, from = 'CAD', to = 'INR';
      const parts = arg.trim().split(/\s+/);
      if (parts.length >= 4 && parts[2].toLowerCase() === 'to') {
        amt = parseFloat(parts[0]) || 100;
        from = parts[1].toUpperCase();
        to = parts[3].toUpperCase();
      } else if (parts.length === 3) {
        amt = parseFloat(parts[0]) || 100;
        from = parts[1].toUpperCase();
        to = parts[2].toUpperCase();
      } else if (parts.length === 2) {
        amt = parseFloat(parts[0]) || 100;
        to = parts[1].toUpperCase();
      }

      showToast(`Converting ${amt} ${from} to ${to}...`, '💱');
      try {
        const data = await fetchCurrencyConversion(amt, from, to);
        if (data && data.success) {
          await sendStudyCardMessage({
            type: 'convert',
            amount: data.amount,
            from: data.from,
            to: data.to,
            rate: data.rate,
            result: data.result
          });
          return;
        }
      } catch (err) {
        showToast('Currency API error: ' + err.message, '⚠️');
      }
    }

    if (cmd === '/advice') {
      el.messageTextInput.value = '';
      updateInputState();
      showToast('Getting student advice tip...', '💡');
      try {
        const data = await fetchStudentAdvice();
        if (data && data.success) {
          await sendStudyCardMessage({
            type: 'advice',
            advice: data.advice
          });
          return;
        }
      } catch (err) {
        showToast('Advice API error: ' + err.message, '⚠️');
      }
    }

    if (cmd === '/location' || cmd === '/pin' || cmd === '/meet') {
      el.messageTextInput.value = '';
      updateInputState();
      try {
        const locs = await fetchCampusLocations();
        let chosen = locs[0];
        if (arg) {
          const match = locs.find(l => l.name.toLowerCase().includes(arg.toLowerCase()) || l.id.toLowerCase().includes(arg.toLowerCase()));
          if (match) chosen = match;
        }
        if (chosen) {
          await sendStudyCardMessage({
            type: 'location',
            name: chosen.name,
            campus: chosen.campus,
            building: chosen.building,
            details: chosen.details,
            mapUrl: chosen.mapUrl
          });
          return;
        }
      } catch (err) {
        showToast('Locations error: ' + err.message, '⚠️');
      }
    }

    if (cmd === '/qr') {
      el.messageTextInput.value = '';
      updateInputState();
      openCampusQrModal();
      return;
    }

    if (cmd === '/book') {
      if (!arg) {
        showToast('Usage: /book <title> (e.g. /book calculus)', '📚');
        return;
      }
      el.messageTextInput.value = '';
      updateInputState();
      showToast(`Searching Open Library for "${arg}"...`, '📚');
      try {
        const data = await fetchBookSearch(arg);
        if (data && data.success && data.books && data.books.length > 0) {
          const b = data.books[0];
          await sendStudyCardMessage({
            type: 'book',
            title: b.title,
            author: b.author,
            year: b.year,
            url: b.url
          });
          return;
        } else {
          showToast('No books found for that query.', '⚠️');
          return;
        }
      } catch (err) {
        showToast('Open Library API error: ' + err.message, '⚠️');
      }
    }
  }

  el.messageTextInput.value = '';
  updateInputState();
  playSentSound();

  const tempId = 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
  state.renderedMsgIds.add(tempId);

  const replyContext = state.replyingTo ? { ...state.replyingTo } : null;
  cancelReply();

  const tempMsg = {
    id: tempId,
    sender: state.currentUser.username,
    displayName: state.currentUser.displayName,
    text: text,
    replyTo: replyContext,
    timestamp: Date.now(),
    status: 'sent'
  };

  const emptyHint = document.getElementById('chat-empty-hint');
  if (emptyHint) emptyHint.remove();

  appendMessageToChat(tempMsg, true);
  scrollToBottom();
  checkAndTriggerCelebrationEffect(text);

  try {
    const body = {
      sender: state.currentUser.username,
      text: text,
      replyTo: replyContext
    };
    if (state.isGroup) {
      body.groupId = state.currentGroupId;
    } else if (state.isChannel) {
      body.channel = state.currentChatTarget;
    } else {
      body.recipient = state.currentChatTarget;
    }

    const res = await fetch('/api/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to deliver message', '⚠️');
      el.messageTextInput.value = text;
      updateInputState();
    } else {
      if (data.message && data.message.id) {
        state.renderedMsgIds.add(data.message.id);
        const tempBubble = document.querySelector(`.message-bubble[data-msg-id="${tempId}"]`);
        if (tempBubble) {
          tempBubble.dataset.msgId = data.message.id;
        }
      }
      loadRecentChats();
    }
  } catch (err) {
    showToast('Failed to send message: ' + err.message, '❌');
    el.messageTextInput.value = text;
    updateInputState();
  }
}

el.btnSendMessage.addEventListener('click', sendMessage);

el.messageTextInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Typing Indicator & Live Auto-Resize Dispatch
el.messageTextInput.addEventListener('input', () => {
  updateInputState();
  if (state.isChannel || !state.currentChatTarget) return;
  clearTimeout(state.typingTimeout);

  fetch('/api/messages/typing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: state.currentUser.username,
      recipient: state.currentChatTarget,
      isTyping: true
    })
  });

  state.typingTimeout = setTimeout(() => {
    fetch('/api/messages/typing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: state.currentUser.username,
        recipient: state.currentChatTarget,
        isTyping: false
      })
    });
  }, 2000);
});

// Lightweight GPU Canvas Image Compressor
async function compressImage(file, maxDimension = 1600, quality = 0.85) {
  return new Promise((resolve) => {
    // If SVG or GIF (animated), don't draw to canvas (preserves animation/vectors)
    if (file.type === 'image/gif' || file.type === 'image/svg+xml' || file.name.endsWith('.gif') || file.name.endsWith('.svg')) {
      return readFileAsBase64(file).then(resolve).catch(() => resolve(null));
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      const img = new Image();
      img.onload = () => {
        try {
          let width = img.width;
          let height = img.height;
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
          resolve(compressedBase64);
        } catch (_) {
          resolve(dataUrl);
        }
      };
      img.onerror = () => {
        resolve(dataUrl);
      };
      img.src = dataUrl;
    };
    reader.onerror = () => {
      readFileAsBase64(file).then(resolve).catch(() => resolve(null));
    };
    reader.readAsDataURL(file);
  });
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Cupertino Attachment Action Sheet & Media Sharing
const attachmentSheetBackdrop = document.getElementById('attachment-sheet-backdrop');
const attachOptPhotos = document.getElementById('attach-opt-photos');
const attachOptDocs = document.getElementById('attach-opt-docs');
const attachOptLocation = document.getElementById('attach-opt-location');
const attachOptDefine = document.getElementById('attach-opt-define');
const attachOptConvert = document.getElementById('attach-opt-convert');
const attachOptAdvice = document.getElementById('attach-opt-advice');

function openAttachmentSheet() {
  if (!state.currentChatTarget) {
    showToast('Please select or open a chat before sharing files.', '⚠️');
    return;
  }
  if (attachmentSheetBackdrop) {
    attachmentSheetBackdrop.classList.remove('hidden');
  }
}

function closeAttachmentSheet() {
  if (attachmentSheetBackdrop) {
    attachmentSheetBackdrop.classList.add('hidden');
  }
}

if (attachmentSheetBackdrop) {
  attachmentSheetBackdrop.addEventListener('click', (e) => {
    if (e.target === attachmentSheetBackdrop) closeAttachmentSheet();
  });
}

if (attachOptPhotos) {
  attachOptPhotos.addEventListener('click', () => {
    closeAttachmentSheet();
    if (el.universalFileInput) {
      el.universalFileInput.accept = 'image/*,video/*';
      el.universalFileInput.click();
    }
  });
}

if (attachOptDocs) {
  attachOptDocs.addEventListener('click', () => {
    closeAttachmentSheet();
    if (el.universalFileInput) {
      el.universalFileInput.accept = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar,.7z,.tar,.gz,.csv,.epub,.json,.js,.py,.cpp,.c,.html,.css,application/*,text/*';
      el.universalFileInput.click();
    }
  });
}

if (attachOptLocation) {
  attachOptLocation.addEventListener('click', () => {
    closeAttachmentSheet();
    openModal(el.modalStudyTools);
    document.querySelector('.study-tab-btn[data-study-view="places"]')?.click();
  });
}

if (attachOptDefine) {
  attachOptDefine.addEventListener('click', () => {
    closeAttachmentSheet();
    openModal(el.modalStudyTools);
    document.querySelector('.study-tab-btn[data-study-view="dict"]')?.click();
  });
}

if (attachOptConvert) {
  attachOptConvert.addEventListener('click', () => {
    closeAttachmentSheet();
    openModal(el.modalStudyTools);
    document.querySelector('.study-tab-btn[data-study-view="convert"]')?.click();
  });
}

if (attachOptAdvice) {
  attachOptAdvice.addEventListener('click', () => {
    closeAttachmentSheet();
    openModal(el.modalStudyTools);
    document.querySelector('.study-tab-btn[data-study-view="fun"]')?.click();
  });
}

// Universal File & Media Sharing (Photos, Videos, PDFs, Docs, Any File)
if (el.btnAttachFile && el.universalFileInput) {
  // Direct click handler on + button opens Cupertino Attachment Sheet
  el.btnAttachFile.addEventListener('click', (e) => {
    e.preventDefault();
    openAttachmentSheet();
  });

  // Keyboard accessibility (Enter / Space)
  el.btnAttachFile.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openAttachmentSheet();
    }
  });

  el.universalFileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    // Reset file input value immediately so user can select the same file again
    el.universalFileInput.value = '';
    if (!files.length) return;

    if (!state.currentChatTarget) {
      showToast('Please select or open a chat before sharing files.', '⚠️');
      return;
    }

    for (const file of files) {
      const isImg = (file.type && file.type.startsWith('image/')) || /\.(jpe?g|png|webp|heic|gif|svg|bmp|ico)$/i.test(file.name);

      if (!isImg && file.size > 50 * 1024 * 1024) {
        showToast(`"${file.name}" is too large! Max file size is 50MB.`, '⚠️');
        continue;
      }

      showToast(isImg ? 'Uploading photo...' : `Sending "${file.name}"...`, '📤');
      playSentSound();

      let imagePayload = null;
      let filePayload = null;

      if (isImg) {
        imagePayload = await compressImage(file, 1600, 0.85);
        if (!imagePayload) {
          imagePayload = await readFileAsBase64(file);
        }
      } else {
        const rawData = await readFileAsBase64(file);
        filePayload = {
          name: file.name,
          size: file.size,
          type: file.type || 'application/octet-stream',
          data: rawData
        };
      }

      const tempId = 'temp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      state.renderedMsgIds.add(tempId);

      const tempMsg = {
        id: tempId,
        sender: state.currentUser.username,
        displayName: state.currentUser.displayName,
        text: '',
        image: imagePayload,
        file: filePayload,
        timestamp: Date.now(),
        status: 'sent'
      };

      appendMessageToChat(tempMsg, true);
      scrollToBottom();

      const body = {
        sender: state.currentUser.username,
        image: imagePayload,
        file: filePayload
      };
      if (state.isGroup) {
        body.groupId = state.currentGroupId;
      } else if (state.isChannel) {
        body.channel = state.currentChatTarget;
      } else {
        body.recipient = state.currentChatTarget;
      }

      try {
        const res = await fetch('/api/messages/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data.error || 'Failed to deliver attachment', '⚠️');
        } else {
          if (data.message && data.message.id) {
            state.renderedMsgIds.add(data.message.id);
            const tempBubble = document.querySelector(`.message-bubble[data-msg-id="${tempId}"]`);
            if (tempBubble) {
              tempBubble.dataset.msgId = data.message.id;
              const fc = tempBubble.querySelector('.file-card-clickable');
              if (fc) fc.dataset.msgId = data.message.id;
            }
          }
          showToast(isImg ? 'Photo delivered!' : 'File delivered!', '✓');
          loadRecentChats();
        }
      } catch (err) {
        showToast('Failed to upload file: ' + err.message, '❌');
      }
    }
  });
}

// Voice Recording (Microphone -> Waveform -> Send Voice Bubble)
async function startVoiceRecording() {
  if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    showToast('Voice recording requires HTTPS. Redirecting to secure link...', '🔒');
    setTimeout(() => {
      location.replace(getAppPublicUrl() + location.pathname);
    }, 800);
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('Microphone not supported on this browser context. Please use the secure HTTPS link.', '⚠️');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    initAudio();

    const mediaRecorder = new MediaRecorder(stream);
    const audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    let seconds = 0;
    el.recordingTimer.textContent = '00:00';
    el.messageInputBox.classList.add('hidden');
    el.btnVoiceRecord.classList.add('hidden');
    el.voiceRecordingBar.classList.remove('hidden');

    const timerInterval = setInterval(() => {
      seconds++;
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      el.recordingTimer.textContent = `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }, 1000);

    state.voiceRecorder = {
      mediaRecorder,
      stream,
      audioChunks,
      timerInterval,
      getSeconds: () => seconds
    };

    mediaRecorder.start(200);
  } catch (err) {
    showToast('Microphone access denied: ' + err.message, '⚠️');
  }
}

function stopVoiceRecording(shouldSend = false) {
  if (!state.voiceRecorder) return;
  const { mediaRecorder, stream, audioChunks, timerInterval, getSeconds } = state.voiceRecorder;
  clearInterval(timerInterval);

  el.voiceRecordingBar.classList.add('hidden');
  el.messageInputBox.classList.remove('hidden');
  updateInputState();

  if (!shouldSend) {
    mediaRecorder.stop();
    stream.getTracks().forEach(track => track.stop());
    state.voiceRecorder = null;
    showToast('Voice message cancelled');
    return;
  }

  const durationSec = getSeconds();

  mediaRecorder.onstop = () => {
    stream.getTracks().forEach(track => track.stop());
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const reader = new FileReader();
    reader.onload = async () => {
      const base64Audio = reader.result;
      playSentSound();

      const tempId = 'temp_' + Date.now();
      state.renderedMsgIds.add(tempId);

      const voicePayload = {
        duration: durationSec,
        data: base64Audio
      };

      const tempMsg = {
        id: tempId,
        sender: state.currentUser.username,
        displayName: state.currentUser.displayName,
        text: '',
        voice: voicePayload,
        timestamp: Date.now(),
        status: 'sent'
      };

      appendMessageToChat(tempMsg, true);
      scrollToBottom();

      const body = {
        sender: state.currentUser.username,
        voice: voicePayload
      };
      if (state.isGroup) {
        body.groupId = state.currentGroupId;
      } else if (state.isChannel) {
        body.channel = state.currentChatTarget;
      } else {
        body.recipient = state.currentChatTarget;
      }

      try {
        const res = await fetch('/api/messages/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (data.message && data.message.id) {
          state.renderedMsgIds.add(data.message.id);
          const tempBubble = document.querySelector(`.message-bubble[data-msg-id="${tempId}"]`);
          if (tempBubble) tempBubble.dataset.msgId = data.message.id;
        }
        loadRecentChats();
      } catch (err) {
        showToast('Failed to send voice note: ' + err.message, '❌');
      }
    };
    reader.readAsDataURL(audioBlob);
    state.voiceRecorder = null;
  };

  mediaRecorder.stop();
}

if (el.btnVoiceRecord) el.btnVoiceRecord.addEventListener('click', startVoiceRecording);
if (el.btnCancelRecording) el.btnCancelRecording.addEventListener('click', () => stopVoiceRecording(false));
if (el.btnSendRecording) el.btnSendRecording.addEventListener('click', () => stopVoiceRecording(true));

// WebRTC Live Voice Calling System (Real-Time Peer-to-Peer Audio + Dual Audio Bridge)
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.services.mozilla.com' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ]
};

async function sendCallSignal(type, data) {
  if (!state.activeCall || !state.activeCall.callId) return;
  try {
    await fetch('/api/calls/signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callId: state.activeCall.callId,
        sender: state.currentUser.username,
        recipient: state.activeCall.partner,
        type: type,
        data: data
      })
    });
  } catch (err) {
    console.error('Error sending call signal:', err);
  }
}

function setupPeerConnection() {
  if (state.peerConnection) {
    try { state.peerConnection.close(); } catch (_) {}
    state.peerConnection = null;
  }

  try {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    state.peerConnection = pc;

    if (state.localCallStream) {
      state.localCallStream.getTracks().forEach(track => {
        pc.addTrack(track, state.localCallStream);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && state.activeCall) {
        sendCallSignal('candidate', event.candidate);
      }
    };

    pc.ontrack = (event) => {
      console.log('[WebRTC ontrack] Audio track received!');
      if (el.remoteCallAudio) {
        el.remoteCallAudio.srcObject = event.streams[0];
        el.remoteCallAudio.play().catch(() => {});
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[WebRTC ICE State]:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        if (state.activeCall && state.activeCall.status === 'ringing') {
          state.activeCall.status = 'connected';
          el.activeCallStatus.textContent = 'Connected - Voice Call';
          el.activeCallStatus.style.color = '#34C759';
          el.activeCallTimer.classList.remove('hidden');
          startCallTimer();
        }
      }
    };

    return pc;
  } catch (err) {
    console.error('Failed to create RTCPeerConnection:', err);
    return null;
  }
}

async function handleCallSignal(payload) {
  const { type, data } = payload;
  console.log('[Call Signal Received]', type);

  if (type === 'offer') {
    state.pendingOffer = data;
    // If peer connection already initialized and call connected, process immediately
    if (state.peerConnection && state.activeCall && state.activeCall.status === 'connected') {
      await handleSignalOffer(data);
    }
  } else if (type === 'answer') {
    if (state.peerConnection) {
      try {
        await state.peerConnection.setRemoteDescription(new RTCSessionDescription(data));
        while (state.pendingCandidates && state.pendingCandidates.length > 0) {
          const c = state.pendingCandidates.shift();
          try {
            await state.peerConnection.addIceCandidate(new RTCIceCandidate(c));
          } catch (_) {}
        }
      } catch (err) {
        console.error('Error setting remote description for answer:', err);
      }
    }
  } else if (type === 'candidate') {
    if (state.peerConnection && state.peerConnection.remoteDescription) {
      try {
        await state.peerConnection.addIceCandidate(new RTCIceCandidate(data));
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    } else {
      state.pendingCandidates = state.pendingCandidates || [];
      state.pendingCandidates.push(data);
    }
  }
}

async function handleSignalOffer(offerData) {
  if (!state.peerConnection) {
    setupPeerConnection();
  }
  try {
    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(offerData));
    const answer = await state.peerConnection.createAnswer();
    await state.peerConnection.setLocalDescription(answer);
    await sendCallSignal('answer', answer);

    while (state.pendingCandidates && state.pendingCandidates.length > 0) {
      const c = state.pendingCandidates.shift();
      try {
        await state.peerConnection.addIceCandidate(new RTCIceCandidate(c));
      } catch (_) {}
    }
  } catch (err) {
    console.error('Error handling offer:', err);
  }
}

async function initiateVoiceCall(partnerOverride) {
  const partner = partnerOverride || state.currentChatTarget;
  if (!partner) return;
  if (state.isChannel) {
    showToast('Voice calls are only for 1-on-1 classmate chats.', 'ℹ️');
    return;
  }

  const cleanPartner = partner.trim().toLowerCase().replace(/^@/, '');
  const partnerObj = state.friends.find(f => f.username.toLowerCase() === cleanPartner) ||
                     state.allStudents.find(s => s.username.toLowerCase() === cleanPartner);
  const partnerName = (partnerObj && partnerObj.displayName) || el.chatPartnerTitle.textContent || cleanPartner;

  // Ensure secure context before requesting microphone
  if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    showToast('Switching to secure HTTPS link for voice calls...', '🔒');
    setTimeout(() => {
      location.replace(getAppPublicUrl() + location.pathname);
    }, 800);
    return;
  }

  // Cross-browser microphone access with legacy fallback
  const getAudioStream = () => {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
    // Legacy fallback for older browsers
    const legacyGUM = navigator.getUserMedia || navigator.webkitGetUserMedia ||
                      navigator.mozGetUserMedia || navigator.msGetUserMedia;
    if (legacyGUM) {
      return new Promise((resolve, reject) => legacyGUM.call(navigator, { audio: true }, resolve, reject));
    }
    return Promise.reject(new DOMException('getUserMedia not supported', 'NotSupportedError'));
  };

  try {
    const stream = await getAudioStream();
    state.localCallStream = stream;
  } catch (err) {
    let msg = 'Microphone permission required for voice calls.';
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      msg = 'Microphone blocked: Tap 🔒 in your browser address bar and enable Microphone.';
    } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      msg = 'No microphone found on this device.';
    } else if (err.name === 'NotSupportedError' || err.name === 'SecurityError' || !window.isSecureContext) {
      msg = 'Switching to secure HTTPS link for microphone...';
      showToast(msg, '🔒');
      setTimeout(() => {
        location.replace(getAppPublicUrl() + location.pathname);
      }, 800);
      return;
    } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      msg = 'Microphone is in use by another app. Please close other audio apps and try again.';
    } else if (err.name === 'OverconstrainedError') {
      msg = 'No compatible microphone found on this device.';
    }
    showToast(msg, '🎤');
    return;
  }

  try {
    const res = await fetch('/api/calls/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caller: state.currentUser.username,
        recipient: cleanPartner
      })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Could not initiate voice call', '⚠️');
      if (state.localCallStream) {
        state.localCallStream.getTracks().forEach(t => t.stop());
        state.localCallStream = null;
      }
      return;
    }

    state.activeCall = {
      callId: data.call.callId,
      partner: cleanPartner,
      partnerName: partnerName,
      role: 'caller',
      status: 'ringing',
      seconds: 0
    };

    el.activeCallName.textContent = partnerName;
    el.activeCallAvatar.textContent = partnerName.charAt(0).toUpperCase();
    el.activeCallStatus.textContent = 'Calling... Ringing...';
    el.activeCallStatus.style.color = 'rgba(255,255,255,0.7)';
    el.activeCallTimer.classList.add('hidden');
    openModal(el.modalActiveCall);

    const pc = setupPeerConnection();
    if (pc) {
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      sendCallSignal('offer', offer);
    }
  } catch (err) {
    showToast('Error calling classmate: ' + err.message, '❌');
    cleanupCall();
  }
}

async function respondToVoiceCall(action) {
  if (!state.activeCall || !state.activeCall.callId) return;
  const callId = state.activeCall.callId;

  if (action === 'accept') {
    // Ensure secure context before requesting microphone
    if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      showToast('Switching to secure HTTPS link to answer call...', '🔒');
      setTimeout(() => {
        location.replace(getAppPublicUrl() + location.pathname);
      }, 800);
      return;
    }

    // Cross-browser microphone access
    const getAudioStream2 = () => {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      }
      const legacyGUM = navigator.getUserMedia || navigator.webkitGetUserMedia ||
                        navigator.mozGetUserMedia || navigator.msGetUserMedia;
      if (legacyGUM) {
        return new Promise((resolve, reject) => legacyGUM.call(navigator, { audio: true }, resolve, reject));
      }
      return Promise.reject(new DOMException('getUserMedia not supported', 'NotSupportedError'));
    };

    try {
      const stream = await getAudioStream2();
      state.localCallStream = stream;
    } catch (err) {
      let msg = 'Microphone permission required to answer the call.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = 'Microphone blocked: Tap 🔒 in your browser address bar and enable Microphone.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        msg = 'No microphone found on this device.';
      } else if (err.name === 'NotSupportedError' || err.name === 'SecurityError' || !window.isSecureContext) {
        msg = 'Switching to secure HTTPS link for microphone...';
        showToast(msg, '🔒');
        setTimeout(() => {
          location.replace(getAppPublicUrl() + location.pathname);
        }, 800);
        return;
      } else if (err.name === 'NotReadableError') {
        msg = 'Microphone is in use by another app. Please close other audio apps and try again.';
      }
      showToast(msg, '🎤');
      return;
    }

    try {
      const res = await fetch('/api/calls/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callId: callId,
          responder: state.currentUser.username,
          action: 'accept'
        })
      });
      const data = await res.json();

      closeModal(el.modalIncomingCall);
      playCallConnectedSound();

      state.activeCall.status = 'connected';
      el.activeCallName.textContent = state.activeCall.partnerName || state.activeCall.partner;
      el.activeCallAvatar.textContent = (state.activeCall.partnerName || state.activeCall.partner).charAt(0).toUpperCase();
      el.activeCallStatus.textContent = 'Connected - Voice Call';
      el.activeCallStatus.style.color = '#34C759';
      el.activeCallTimer.classList.remove('hidden');
      openModal(el.modalActiveCall);
      startCallTimer();

      setupPeerConnection();

      const offerToUse = data.offer || state.pendingOffer;
      if (offerToUse) {
        await handleSignalOffer(offerToUse);
        state.pendingOffer = null;
      }
      if (data.callerCandidates && Array.isArray(data.callerCandidates)) {
        for (const c of data.callerCandidates) {
          try {
            if (state.peerConnection && state.peerConnection.remoteDescription) {
              await state.peerConnection.addIceCandidate(new RTCIceCandidate(c));
            } else {
              state.pendingCandidates = state.pendingCandidates || [];
              state.pendingCandidates.push(c);
            }
          } catch (_) {}
        }
      }

      startCallAudioRelay();
    } catch (err) {
      showToast('Error accepting call: ' + err.message, '❌');
      cleanupCall();
    }
  } else {
    try {
      await fetch('/api/calls/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callId: callId,
          responder: state.currentUser.username,
          action: 'decline'
        })
      });
    } catch (_) {}

    closeModal(el.modalIncomingCall);
    showToast('Call declined', '📞');
    cleanupCall();
    if (state.currentChatTarget) fetchAndRenderChatMessages(false);
    loadRecentChats();
  }
}

function startCallAudioRelay() {
  if (!state.localCallStream || !state.activeCall) return;
  if (state.activeCallRelay) return;

  try {
    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
    }

    const recorder = mimeType ? new MediaRecorder(state.localCallStream, { mimeType }) : new MediaRecorder(state.localCallStream);

    recorder.ondataavailable = async (e) => {
      if (!state.activeCall || state.activeCall.status !== 'connected') return;
      if (e.data && e.data.size > 0) {
        // If WebRTC direct P2P is connected, skip relay to avoid duplicate sound
        if (state.peerConnection && (state.peerConnection.iceConnectionState === 'connected' || state.peerConnection.iceConnectionState === 'completed')) {
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64Audio = reader.result;
          if (base64Audio && state.activeCall) {
            fetch('/api/calls/audio-chunk', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                callId: state.activeCall.callId,
                sender: state.currentUser.username,
                recipient: state.activeCall.partner,
                chunk: base64Audio
              })
            }).catch(() => {});
          }
        };
        reader.readAsDataURL(e.data);
      }
    };

    recorder.start(350); // 350ms chunks for smooth real-time voice
    state.activeCallRelay = recorder;
  } catch (err) {
    console.log('Audio relay start info:', err);
  }
}

function startCallTimer() {
  if (!state.activeCall) return;
  state.activeCall.seconds = 0;
  el.activeCallTimer.textContent = '00:00';
  clearInterval(state.activeCall.timerInterval);

  state.activeCall.timerInterval = setInterval(() => {
    if (!state.activeCall) return;
    state.activeCall.seconds++;
    const m = Math.floor(state.activeCall.seconds / 60);
    const s = state.activeCall.seconds % 60;
    el.activeCallTimer.textContent = `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  }, 1000);
}

async function endVoiceCall() {
  if (!state.activeCall) {
    cleanupCall();
    return;
  }
  const callId = state.activeCall.callId;
  const dur = state.activeCall.seconds || 0;
  cleanupCall();

  try {
    await fetch('/api/calls/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callId: callId,
        by: state.currentUser.username,
        duration: dur
      })
    });
  } catch (_) {}

  if (state.currentChatTarget) {
    fetchAndRenderChatMessages(false);
  }
  loadRecentChats();
}

function cleanupCall() {
  if (state.activeCall && state.activeCall.timerInterval) {
    clearInterval(state.activeCall.timerInterval);
  }
  if (state.peerConnection) {
    try { state.peerConnection.close(); } catch (_) {}
    state.peerConnection = null;
  }
  if (state.localCallStream) {
    try {
      state.localCallStream.getTracks().forEach(t => t.stop());
    } catch (_) {}
    state.localCallStream = null;
  }
  if (state.activeCallRelay) {
    try { state.activeCallRelay.stop(); } catch (_) {}
    state.activeCallRelay = null;
  }
  if (el.remoteCallAudio) {
    el.remoteCallAudio.srcObject = null;
  }
  state.pendingOffer = null;
  state.pendingCandidates = [];
  state.activeCall = null;
  closeModal(el.modalIncomingCall);
  closeModal(el.modalActiveCall);
}

function toggleMuteVoiceCall() {
  if (!state.activeCall) return;
  state.activeCall.isMuted = !state.activeCall.isMuted;
  if (state.localCallStream) {
    state.localCallStream.getAudioTracks().forEach(track => {
      track.enabled = !state.activeCall.isMuted;
    });
  }
  if (state.activeCall.isMuted) {
    el.btnToggleMute.classList.add('muted');
    el.muteLabel.textContent = 'Unmute';
    showToast('Microphone muted', '🔇');
  } else {
    el.btnToggleMute.classList.remove('muted');
    el.muteLabel.textContent = 'Mute';
    showToast('Microphone active', '🎙️');
  }
}

async function checkActiveCallFallback() {
  if (!state.currentUser) return;
  try {
    const res = await fetch(`/api/calls/active?me=${encodeURIComponent(state.currentUser.username)}`);
    const data = await res.json();
    if (data.call) {
      if (!state.activeCall && data.call.recipient === state.currentUser.username && data.call.status === 'ringing') {
        playRingtoneSound();
        state.activeCall = {
          callId: data.call.callId,
          partner: data.call.caller,
          partnerName: data.call.callerName || data.call.caller,
          role: 'callee',
          status: 'ringing',
          seconds: 0
        };
        if (data.offer) state.pendingOffer = data.offer;
        el.callerName.textContent = data.call.callerName || data.call.caller;
        el.callerAvatar.textContent = (data.call.callerName || data.call.caller).charAt(0).toUpperCase();
        if (data.call.callerAvatar) el.callerAvatar.style.backgroundColor = data.call.callerAvatar;
        openModal(el.modalIncomingCall);
      } else if (state.activeCall && state.activeCall.role === 'caller' && state.activeCall.status === 'ringing' && data.call.status === 'connected') {
        playCallConnectedSound();
        state.activeCall.status = 'connected';
        el.activeCallStatus.textContent = 'Connected - Voice Call';
        el.activeCallStatus.style.color = '#34C759';
        el.activeCallTimer.classList.remove('hidden');
        startCallTimer();
        startCallAudioRelay();
        if (data.answer && state.peerConnection && !state.peerConnection.remoteDescription) {
          try {
            await state.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
          } catch (_) {}
        }
      }
    } else {
      if (state.activeCall && state.activeCall.status === 'connected' && state.activeCall.seconds > 3) {
        cleanupCall();
        showToast('Call ended', '📞');
        if (state.currentChatTarget) fetchAndRenderChatMessages(false);
        loadRecentChats();
      }
    }
  } catch (_) {}
}

if (el.btnStartCall) el.btnStartCall.addEventListener('click', () => {
  if (el.remoteCallAudio) el.remoteCallAudio.play().catch(() => {});
  initiateVoiceCall();
});
if (el.btnAcceptCall) el.btnAcceptCall.addEventListener('click', () => {
  if (el.remoteCallAudio) el.remoteCallAudio.play().catch(() => {});
  respondToVoiceCall('accept');
});
if (el.btnDeclineCall) el.btnDeclineCall.addEventListener('click', () => respondToVoiceCall('decline'));
if (el.btnEndCall) el.btnEndCall.addEventListener('click', endVoiceCall);
if (el.btnToggleMute) el.btnToggleMute.addEventListener('click', toggleMuteVoiceCall);

// Toggle Verified Trusted Classmate (Twitter / X Blue Tick)
async function toggleTrust(target) {
  if (!target || state.isChannel) return;
  try {
    const res = await fetch('/api/users/trust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        me: state.currentUser.username,
        target: target
      })
    });
    const data = await res.json();
    if (data.isTrusted) {
      state.trustedUsersSet.add(target.toLowerCase());
      el.partnerBlueTick.classList.remove('hidden');
      showToast(`Verified @${target} as Trusted Classmate!`, '✓');
    } else {
      state.trustedUsersSet.delete(target.toLowerCase());
      el.partnerBlueTick.classList.add('hidden');
      showToast(`Removed trusted status from @${target}`, 'ℹ️');
    }
    loadRecentChats();
    loadFriendsList();
    loadCampusDirectory();
  } catch (err) {
    showToast('Failed to update trust status: ' + err.message, '❌');
  }
}

if (el.chatHeaderPartnerClick) {
  el.chatHeaderPartnerClick.addEventListener('click', () => {
    if (state.isGroup && state.currentGroupId) {
      openGroupInfoModal(state.currentGroupId);
    } else if (state.currentChatTarget && !state.isChannel) {
      openContactProfile(state.currentChatTarget);
    }
  });
}

if (el.partnerBlueTick) {
  el.partnerBlueTick.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.currentChatTarget && !state.isChannel) {
      toggleTrust(state.currentChatTarget);
    }
  });
}

// Contact Profile & Shared Media Drawer (WhatsApp Style)
async function openContactProfile(username) {
  if (!username) return;
  const cleanTarget = username.toLowerCase().replace(/^@/, '');

  let user = state.friends.find(f => f.username.toLowerCase() === cleanTarget);
  if (!user) {
    user = state.allStudents.find(s => s.username.toLowerCase() === cleanTarget);
  }

  const displayName = (user && user.displayName) || el.chatPartnerTitle.textContent || cleanTarget;
  const major = (user && user.major) || 'Computer Information Systems';
  const isOnline = user ? !!user.online : (el.chatPartnerSubtitle.textContent === 'online');
  const isTrusted = state.trustedUsersSet.has(cleanTarget) || (user && user.isTrusted);
  const avatarColor = (user && user.avatarColor) || '#075E54';

  el.profileModalName.textContent = displayName;
  el.profileModalHandle.textContent = `@${cleanTarget}`;
  el.profileModalAvatar.textContent = displayName.charAt(0).toUpperCase();
  el.profileModalAvatar.style.backgroundColor = avatarColor;

  el.profileModalStatus.textContent = isOnline ? '● Online now' : 'Last seen recently';
  el.profileModalStatus.style.color = isOnline ? 'var(--accent-green)' : 'var(--text-light)';

  if (isTrusted) {
    el.profileModalBadge.classList.remove('hidden');
    el.profileTrustLabel.textContent = 'Verified ✓';
    el.profileModalTrustStatus.textContent = 'Verified Trusted Classmate (Blue Tick)';
    el.profileModalTrustStatus.style.color = '#1D9BF0';
  } else {
    el.profileModalBadge.classList.add('hidden');
    el.profileTrustLabel.textContent = 'Verify Trust';
    el.profileModalTrustStatus.textContent = 'Verified Okanagan College Student';
    el.profileModalTrustStatus.style.color = 'var(--text-light)';
  }

  el.profileModalMajor.textContent = major;
  el.profileModalCampus.textContent = 'Kelowna Campus (KLO)';

  el.profileBtnMessage.onclick = () => {
    closeModal(el.modalContactProfile);
  };

  el.profileBtnCall.onclick = () => {
    closeModal(el.modalContactProfile);
    initiateVoiceCall(cleanTarget);
  };

  el.profileBtnToggleTrust.onclick = async () => {
    await toggleTrust(cleanTarget);
    const nowTrusted = state.trustedUsersSet.has(cleanTarget);
    if (nowTrusted) {
      el.profileModalBadge.classList.remove('hidden');
      el.profileTrustLabel.textContent = 'Verified ✓';
      el.profileModalTrustStatus.textContent = 'Verified Trusted Classmate (Blue Tick)';
      el.profileModalTrustStatus.style.color = '#1D9BF0';
    } else {
      el.profileModalBadge.classList.add('hidden');
      el.profileTrustLabel.textContent = 'Verify Trust';
      el.profileModalTrustStatus.textContent = 'Verified Okanagan College Student';
      el.profileModalTrustStatus.style.color = 'var(--text-light)';
    }
  };

  // Friendship & Block Options
  const isFriend = state.friends.some(f => f.username.toLowerCase() === cleanTarget);
  if (el.profileBtnUnfriend) {
    if (isFriend) {
      el.profileBtnUnfriend.classList.remove('hidden');
      el.profileBtnUnfriend.onclick = () => handleUnfriendClassmate(cleanTarget);
    } else {
      el.profileBtnUnfriend.classList.add('hidden');
    }
  }

  const isBlocked = await checkUserBlockedStatus(cleanTarget);
  if (el.profileBlockLabel) {
    el.profileBlockLabel.textContent = isBlocked ? 'Unblock Student' : 'Block Student';
  }
  if (el.profileBtnBlock) {
    el.profileBtnBlock.classList.toggle('is-blocked', isBlocked);
    el.profileBtnBlock.onclick = async () => {
      const currentlyBlocked = await checkUserBlockedStatus(cleanTarget);
      await handleToggleBlockClassmate(cleanTarget, currentlyBlocked);
    };
  }

  loadSharedMediaForProfile(cleanTarget);
  openModal(el.modalContactProfile);
}

// ===========================================================================
// FRIENDSHIP & SAFETY: UNFRIEND, BLOCK & UNBLOCK
// ===========================================================================

async function checkUserBlockedStatus(target) {
  if (!state.currentUser || !target) return false;
  try {
    const res = await fetch(`/api/friends/blocked?username=${encodeURIComponent(state.currentUser.username)}`);
    const data = await res.json();
    if (data.blocked && Array.isArray(data.blocked)) {
      return data.blocked.some(b => b.username.toLowerCase() === target.toLowerCase());
    }
  } catch (_) {}
  return false;
}

async function handleUnfriendClassmate(target) {
  if (!state.currentUser || !target) return;
  const cleanTarget = target.toLowerCase().replace(/^@/, '');
  if (!confirm(`Are you sure you want to remove @${cleanTarget} from your friends list?`)) return;

  try {
    const res = await fetch('/api/friends/unfriend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user1: state.currentUser.username,
        user2: cleanTarget
      })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`Removed @${cleanTarget} from friends.`, 'ℹ️');
      closeModal(el.modalContactProfile);
      loadFriendsList();
      loadRecentChats();
      loadCampusDirectory();
    } else {
      showToast(data.error || 'Could not unfriend classmate.', '⚠️');
    }
  } catch (err) {
    showToast('Unfriend error: ' + err.message, '❌');
  }
}

async function handleToggleBlockClassmate(target, currentBlockedState) {
  if (!state.currentUser || !target) return;
  const cleanTarget = target.toLowerCase().replace(/^@/, '');

  if (currentBlockedState) {
    // Unblock
    try {
      const res = await fetch('/api/friends/unblock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blocker: state.currentUser.username,
          blocked: cleanTarget
        })
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Unblocked @${cleanTarget}!`, '✅');
        if (el.profileBlockLabel) el.profileBlockLabel.textContent = 'Block Student';
        if (el.profileBtnBlock) el.profileBtnBlock.classList.remove('is-blocked');
        loadBlockedStudentsList();
        loadFriendsList();
        loadCampusDirectory();
      } else {
        showToast(data.error || 'Could not unblock student.', '⚠️');
      }
    } catch (err) {
      showToast('Unblock error: ' + err.message, '❌');
    }
  } else {
    // Block
    if (!confirm(`Block @${cleanTarget}? They will not be able to message you, call you, or send friend requests.`)) return;

    try {
      const res = await fetch('/api/friends/block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blocker: state.currentUser.username,
          blocked: cleanTarget
        })
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Blocked @${cleanTarget}.`, '🚫');
        if (el.profileBlockLabel) el.profileBlockLabel.textContent = 'Unblock Student';
        if (el.profileBtnBlock) el.profileBtnBlock.classList.add('is-blocked');
        closeModal(el.modalContactProfile);
        if (state.currentChatTarget && state.currentChatTarget.toLowerCase() === cleanTarget) {
          el.btnBackToHome.click();
        }
        loadBlockedStudentsList();
        loadFriendsList();
        loadRecentChats();
        loadCampusDirectory();
      } else {
        showToast(data.error || 'Could not block student.', '⚠️');
      }
    } catch (err) {
      showToast('Block error: ' + err.message, '❌');
    }
  }
}

async function loadBlockedStudentsList() {
  if (!state.currentUser || !el.settingsBlockedList) return;
  try {
    const res = await fetch(`/api/friends/blocked?username=${encodeURIComponent(state.currentUser.username)}`);
    const data = await res.json();
    const list = data.blocked || [];

    if (el.settingsBlockedCount) {
      el.settingsBlockedCount.textContent = `(${list.length})`;
    }

    if (list.length === 0) {
      el.settingsBlockedList.innerHTML = '<p class="settings-empty-hint">No blocked students</p>';
      return;
    }

    el.settingsBlockedList.innerHTML = list.map(b => `
      <div class="blocked-student-item">
        <div class="blocked-info">
          <strong>${escapeHtml(b.displayName || b.username)}</strong>
          <span class="blocked-handle">@${escapeHtml(b.username)}</span>
        </div>
        <button class="btn-unblock-pill" data-username="${escapeHtml(b.username)}">Unblock</button>
      </div>
    `).join('');

    el.settingsBlockedList.querySelectorAll('.btn-unblock-pill').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const unblockTarget = btn.dataset.username;
        await handleToggleBlockClassmate(unblockTarget, true);
      });
    });
  } catch (_) {}
}

function loadSharedMediaForProfile(cleanTarget) {
  const messages = state.chats[cleanTarget] || [];
  const photosAndVideos = [];
  const documents = [];

  messages.forEach(msg => {
    if (msg.image) {
      photosAndVideos.push({
        type: 'image',
        src: msg.image,
        timestamp: msg.timestamp
      });
    }
    if (msg.file) {
      const fType = msg.file.type || '';
      const fName = msg.file.name || 'Attachment';
      if (fType.startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(fName)) {
        photosAndVideos.push({
          type: 'image',
          src: msg.file.data,
          timestamp: msg.timestamp
        });
      } else if (fType.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(fName)) {
        photosAndVideos.push({
          type: 'video',
          src: msg.file.data,
          timestamp: msg.timestamp
        });
      } else {
        documents.push({
          type: 'file',
          name: fName,
          size: msg.file.size,
          data: msg.file.data,
          timestamp: msg.timestamp,
          msgId: msg.id
        });
      }
    }
  });

  const totalCount = photosAndVideos.length + documents.length;
  el.profileMediaCountBadge.textContent = totalCount;

  el.profileSharedMediaGrid.innerHTML = '';
  if (photosAndVideos.length > 0) {
    photosAndVideos.forEach(item => {
      const thumb = document.createElement('div');
      thumb.className = 'shared-media-thumb';
      if (item.type === 'image') {
        thumb.innerHTML = `<img src="${item.src}" alt="Shared image" loading="lazy" />`;
        thumb.addEventListener('click', () => openLightbox(item.src));
      } else if (item.type === 'video') {
        thumb.innerHTML = `
          <video src="${item.src}" preload="metadata"></video>
          <div class="video-play-overlay">▶</div>
        `;
        thumb.addEventListener('click', () => {
          const v = thumb.querySelector('video');
          if (v) {
            if (v.requestFullscreen) v.requestFullscreen();
            v.play();
          }
        });
      }
      el.profileSharedMediaGrid.appendChild(thumb);
    });
  }

  el.profileSharedFilesList.innerHTML = '';
  if (documents.length > 0) {
    documents.forEach(doc => {
      const row = document.createElement('div');
      row.className = 'shared-file-row file-card-clickable';
      row.innerHTML = `
        <div class="shared-file-icon">${getFileIcon(doc.name)}</div>
        <div class="shared-file-info">
          <div class="shared-file-name">${escapeHtml(doc.name)}</div>
          <div class="shared-file-meta">${formatBytes(doc.size)} • ${formatTime(doc.timestamp)}</div>
        </div>
        <div class="shared-file-dl btn-direct-download" title="Save file to device">⬇️</div>
      `;
      row.addEventListener('click', (e) => {
        if (e.target.closest('.btn-direct-download')) {
          e.stopPropagation();
          openOrDownloadAttachment(doc, doc.msgId, true);
          return;
        }
        openOrDownloadAttachment(doc, doc.msgId, false);
      });
      el.profileSharedFilesList.appendChild(row);
    });
  }

  updateSharedMediaTabVisibility();
}

function updateSharedMediaTabVisibility() {
  const isPhotos = state.sharedMediaFilter === 'photos';
  if (isPhotos) {
    el.profileSharedMediaGrid.classList.remove('hidden');
    el.profileSharedFilesList.classList.add('hidden');
    const count = el.profileSharedMediaGrid.children.length;
    if (count === 0) {
      el.profileNoMediaHint.textContent = 'No photos or videos shared yet in this chat.';
      el.profileNoMediaHint.classList.remove('hidden');
    } else {
      el.profileNoMediaHint.classList.add('hidden');
    }
  } else {
    el.profileSharedMediaGrid.classList.add('hidden');
    el.profileSharedFilesList.classList.remove('hidden');
    const count = el.profileSharedFilesList.children.length;
    if (count === 0) {
      el.profileNoMediaHint.textContent = 'No documents or files shared yet in this chat.';
      el.profileNoMediaHint.classList.remove('hidden');
    } else {
      el.profileNoMediaHint.classList.add('hidden');
    }
  }
}

// Fullscreen Image Lightbox
function openLightbox(src) {
  if (!src) return;
  el.lightboxImage.src = src;
  openModal(el.modalImageLightbox);
}

function closeLightbox() {
  closeModal(el.modalImageLightbox);
  el.lightboxImage.src = '';
}

if (el.btnCloseProfileModal) {
  el.btnCloseProfileModal.addEventListener('click', () => closeModal(el.modalContactProfile));
}

if (el.btnCloseDocViewer) {
  el.btnCloseDocViewer.addEventListener('click', () => closeModal(el.modalDocumentViewer));
}

if (el.btnCloseArticleReader) {
  el.btnCloseArticleReader.addEventListener('click', () => closeModal(el.modalArticleReader));
}

if (el.btnCloseLightbox) {
  el.btnCloseLightbox.addEventListener('click', closeLightbox);
}

// ===========================================================================
// WHATSAPP-STYLE GROUPS MANAGEMENT & MODALS SYSTEM
// ===========================================================================

async function openGroupInfoModal(groupId) {
  const cleanId = groupId || state.currentGroupId;
  if (!cleanId || !state.currentUser) return;

  try {
    const res = await fetch(`/api/groups/info?groupId=${encodeURIComponent(cleanId)}&username=${encodeURIComponent(state.currentUser.username)}`);
    const data = await res.json();
    if (!data.success) {
      showToast(data.error || 'Could not load group info', '⚠️');
      return;
    }

    state.currentGroupInfo = data;
    const { group, members, isAdmin, isMember } = data;

    // Set Hero Profile
    el.groupInfoName.textContent = group.name;
    el.groupInfoAvatarHero.style.backgroundColor = group.avatarColor || '#075E54';
    if (group.avatarImage) {
      el.groupInfoAvatarHero.innerHTML = `<img src="${group.avatarImage}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
    } else {
      el.groupInfoAvatarHero.textContent = group.name.charAt(0).toUpperCase() || '👥';
    }
    el.groupInfoMeta.textContent = `Group • ${members.length} participant${members.length === 1 ? '' : 's'}`;
    el.groupInfoCreatedBy.textContent = `Created by @${group.createdBy} • ${new Date(group.createdAt).toLocaleDateString()}`;

    // Description
    el.groupInfoDescText.textContent = group.description || 'No description added yet.';

    // Participant count & summary
    el.groupInfoParticipantsCount.textContent = members.length;
    const adminCount = members.filter(m => m.role === 'admin').length;
    el.groupInfoAdminBadgeCount.textContent = `${adminCount} Admin${adminCount === 1 ? '' : 's'}`;

    // Render Participant rows
    el.groupInfoParticipantsList.innerHTML = '';
    members.forEach(m => {
      const isMe = (m.username === state.currentUser.username);
      const isThisAdmin = (m.role === 'admin');

      const pRow = document.createElement('div');
      pRow.className = 'participant-item-row';
      pRow.innerHTML = `
        <div class="participant-avatar" style="background-color: ${m.avatarColor || '#075E54'}">
          ${m.avatarImage ? `<img src="${m.avatarImage}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />` : (m.displayName || m.username).charAt(0).toUpperCase()}
        </div>
        <div class="participant-info">
          <div class="participant-name-row">
            <span class="participant-name">${escapeHtml(m.displayName || m.username)} ${isMe ? '<small style="color:#007AFF">(You)</small>' : ''}</span>
            ${isThisAdmin ? '<span class="admin-badge">Group Admin</span>' : ''}
          </div>
          <div class="participant-major">${escapeHtml(m.major || `@${m.username}`)}</div>
        </div>
        ${(isAdmin && !isMe) ? `<button class="participant-action-btn btn-remove-member" data-username="${m.username}" title="Remove Participant">Remove</button>` : ''}
      `;

      const removeBtn = pRow.querySelector('.btn-remove-member');
      if (removeBtn) {
        removeBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm(`Remove @${m.username} from group "${group.name}"?`)) {
            await removeMemberFromGroup(cleanId, m.username);
            openGroupInfoModal(cleanId);
          }
        });
      }

      el.groupInfoParticipantsList.appendChild(pRow);
    });

    // Delete group button visibility (Admin Only)
    if (isAdmin) {
      el.btnDeleteGroup.classList.remove('hidden');
    } else {
      el.btnDeleteGroup.classList.add('hidden');
    }

    openModal(el.modalGroupInfo);
  } catch (err) {
    showToast('Failed to load group details: ' + err.message, '❌');
  }
}

function initCreateGroupModal() {
  if (!el.btnOpenCreateGroup) return;

  el.btnOpenCreateGroup.addEventListener('click', () => {
    state.selectedCreateGroupMembers.clear();
    state.selectedGroupThemeColor = '#075E54';
    state.newGroupAvatarDataUrl = null;

    if (el.newGroupNameInput) el.newGroupNameInput.value = '';
    if (el.newGroupDescInput) el.newGroupDescInput.value = '';
    if (el.groupNameCounter) el.groupNameCounter.textContent = '50';
    if (el.createGroupSearchInput) el.createGroupSearchInput.value = '';

    if (el.newGroupAvatarPreview) {
      el.newGroupAvatarPreview.style.backgroundColor = '#075E54';
      el.newGroupAvatarPreview.innerHTML = '<span id="new-group-avatar-icon">👥</span>';
    }

    // Reset color dots
    if (el.groupThemeColors) {
      el.groupThemeColors.querySelectorAll('.color-dot').forEach((dot, idx) => {
        dot.classList.toggle('active', idx === 0);
      });
    }

    renderSelectedCreateGroupChips();
    renderCreateGroupClassmatesList();
    openModal(el.modalCreateGroup);
  });

  if (el.btnCloseCreateGroup) {
    el.btnCloseCreateGroup.addEventListener('click', () => closeModal(el.modalCreateGroup));
  }

  // Character counter
  if (el.newGroupNameInput && el.groupNameCounter) {
    el.newGroupNameInput.addEventListener('input', () => {
      const remaining = 50 - el.newGroupNameInput.value.length;
      el.groupNameCounter.textContent = remaining;
    });
  }

  // Theme colors
  if (el.groupThemeColors) {
    el.groupThemeColors.querySelectorAll('.color-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        el.groupThemeColors.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        state.selectedGroupThemeColor = dot.dataset.color || '#075E54';
        if (el.newGroupAvatarPreview && !state.newGroupAvatarDataUrl) {
          el.newGroupAvatarPreview.style.backgroundColor = state.selectedGroupThemeColor;
        }
      });
    });
  }

  // Avatar upload
  if (el.newGroupAvatarFile) {
    el.newGroupAvatarFile.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        const compressed = await compressImage(file, 800, 0.85);
        state.newGroupAvatarDataUrl = compressed;
        if (el.newGroupAvatarPreview) {
          el.newGroupAvatarPreview.innerHTML = `<img src="${compressed}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
        }
      }
    });
  }

  // Search classmates in create group
  if (el.createGroupSearchInput) {
    el.createGroupSearchInput.addEventListener('input', () => {
      renderCreateGroupClassmatesList(el.createGroupSearchInput.value.trim().toLowerCase());
    });
  }

  // Create Confirm Button
  const submitCreateGroupAction = async () => {
    const name = el.newGroupNameInput.value.trim();
    const desc = el.newGroupDescInput.value.trim();

    if (!name) {
      showToast('Please enter a group subject / name', '⚠️');
      el.newGroupNameInput.focus();
      return;
    }

    try {
      showToast('Creating group...', '👥');
      const membersArray = Array.from(state.selectedCreateGroupMembers);

      const res = await fetch('/api/groups/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name,
          description: desc,
          avatarColor: state.selectedGroupThemeColor,
          avatarImage: state.newGroupAvatarDataUrl,
          createdBy: state.currentUser.username,
          members: membersArray
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.error || 'Failed to create group', '❌');
        return;
      }

      closeModal(el.modalCreateGroup);
      showToast(`Group "${data.group.name}" created!`, '🎉');
      playSentSound();
      loadRecentChats();
      openGroupChat(data.group.id, data.group.name, data.group.avatarColor, data.group.avatarImage);
    } catch (err) {
      showToast('Error creating group: ' + err.message, '❌');
    }
  };

  if (el.btnSubmitCreateGroup) el.btnSubmitCreateGroup.addEventListener('click', submitCreateGroupAction);
  if (el.btnCreateGroupConfirm) el.btnCreateGroupConfirm.addEventListener('click', submitCreateGroupAction);
}

function renderSelectedCreateGroupChips() {
  if (!el.createGroupChipsTray) return;
  el.createGroupChipsTray.innerHTML = '';
  const selectedCount = state.selectedCreateGroupMembers.size;
  if (el.createGroupSelectedCount) el.createGroupSelectedCount.textContent = selectedCount;

  if (selectedCount === 0) {
    el.createGroupChipsTray.innerHTML = '<span class="chips-empty-hint">Select classmates below to add to group</span>';
    return;
  }

  state.selectedCreateGroupMembers.forEach(username => {
    const student = state.friends.find(f => f.username === username) ||
                    state.allStudents.find(s => s.username === username) ||
                    { username, displayName: username, avatarColor: '#075E54' };

    const chip = document.createElement('div');
    chip.className = 'selected-member-chip';
    chip.innerHTML = `
      <div class="chip-avatar" style="background-color: ${student.avatarColor || '#075E54'}">
        ${(student.displayName || student.username).charAt(0).toUpperCase()}
      </div>
      <span>${escapeHtml(student.displayName || student.username)}</span>
      <button type="button" class="chip-remove-btn" title="Remove">×</button>
    `;

    chip.querySelector('.chip-remove-btn').addEventListener('click', () => {
      state.selectedCreateGroupMembers.delete(username);
      renderSelectedCreateGroupChips();
      renderCreateGroupClassmatesList(el.createGroupSearchInput ? el.createGroupSearchInput.value.trim().toLowerCase() : '');
    });

    el.createGroupChipsTray.appendChild(chip);
  });
}

function renderCreateGroupClassmatesList(query = '') {
  if (!el.createGroupClassmatesList) return;
  el.createGroupClassmatesList.innerHTML = '';

  const candidates = [...state.friends];
  state.allStudents.forEach(s => {
    if (!candidates.some(c => c.username === s.username) && s.username !== state.currentUser.username) {
      candidates.push(s);
    }
  });

  const filtered = candidates.filter(s => {
    if (s.username === state.currentUser.username) return false;
    if (!query) return true;
    return s.username.toLowerCase().includes(query) ||
           (s.displayName && s.displayName.toLowerCase().includes(query)) ||
           (s.major && s.major.toLowerCase().includes(query));
  });

  if (filtered.length === 0) {
    el.createGroupClassmatesList.innerHTML = '<div style="text-align:center;padding:16px;color:#8E8E93;font-size:12.5px;">No classmates found.</div>';
    return;
  }

  filtered.forEach(s => {
    const isSelected = state.selectedCreateGroupMembers.has(s.username);
    const row = document.createElement('div');
    row.className = `classmate-select-row ${isSelected ? 'selected' : ''}`;
    row.innerHTML = `
      <div class="select-row-avatar" style="background-color: ${s.avatarColor || '#075E54'}">
        ${(s.displayName || s.username).charAt(0).toUpperCase()}
      </div>
      <div class="select-row-info">
        <div class="select-row-name">${escapeHtml(s.displayName || s.username)} <small style="color:#8E8E93;font-weight:normal">@${s.username}</small></div>
        <div class="select-row-sub">${escapeHtml(s.major || 'Okanagan College')}</div>
      </div>
      <div class="select-checkbox-circle"></div>
    `;

    row.addEventListener('click', () => {
      if (state.selectedCreateGroupMembers.has(s.username)) {
        state.selectedCreateGroupMembers.delete(s.username);
      } else {
        state.selectedCreateGroupMembers.add(s.username);
      }
      renderSelectedCreateGroupChips();
      renderCreateGroupClassmatesList(query);
    });

    el.createGroupClassmatesList.appendChild(row);
  });
}

function initGroupInfoActions() {
  if (el.btnCloseGroupInfo) {
    el.btnCloseGroupInfo.addEventListener('click', () => closeModal(el.modalGroupInfo));
  }

  // Edit Group Subject / Description
  if (el.btnGroupInfoEdit) {
    el.btnGroupInfoEdit.addEventListener('click', async () => {
      if (!state.currentGroupInfo || !state.currentGroupInfo.group) return;
      const currentGrp = state.currentGroupInfo.group;
      const newName = prompt('Enter new Group Subject:', currentGrp.name);
      if (newName === null) return;
      const newCleanName = newName.trim();
      if (!newCleanName) {
        showToast('Group name cannot be empty', '⚠️');
        return;
      }
      const newDesc = prompt('Enter new Group Description:', currentGrp.description || '');
      if (newDesc === null) return;

      try {
        const res = await fetch('/api/groups/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            groupId: currentGrp.id,
            username: state.currentUser.username,
            name: newCleanName,
            description: newDesc.trim()
          })
        });
        const data = await res.json();
        if (data.success) {
          showToast('Group settings updated!', '✅');
          openGroupInfoModal(currentGrp.id);
          el.chatPartnerTitle.textContent = newCleanName;
          loadRecentChats();
        }
      } catch (err) {
        showToast('Failed to update group: ' + err.message, '❌');
      }
    });
  }

  // Open Add Participants Modal
  if (el.btnOpenAddParticipants) {
    el.btnOpenAddParticipants.addEventListener('click', () => {
      openAddGroupMembersModal(state.currentGroupId);
    });
  }

  // Copy Group Share Link
  if (el.btnCopyGroupLink) {
    el.btnCopyGroupLink.addEventListener('click', () => {
      if (!state.currentGroupId) return;
      const shareUrl = `${window.location.origin}/#group=${state.currentGroupId}`;
      navigator.clipboard.writeText(shareUrl).then(() => {
        showToast('Group link copied to clipboard! 📋', '🔗');
      }).catch(() => {
        showToast(`Group Link: ${shareUrl}`, '🔗');
      });
    });
  }

  // Exit Group Button
  if (el.btnExitGroup) {
    el.btnExitGroup.addEventListener('click', async () => {
      if (!state.currentGroupId) return;
      if (confirm('Are you sure you want to leave this group?')) {
        await removeMemberFromGroup(state.currentGroupId, state.currentUser.username);
        closeModal(el.modalGroupInfo);
        el.btnBackToHome.click();
        showToast('You have left the group', '🚪');
      }
    });
  }

  // Delete Group Button
  if (el.btnDeleteGroup) {
    el.btnDeleteGroup.addEventListener('click', async () => {
      if (!state.currentGroupId) return;
      if (confirm('Are you sure you want to delete this group permanently for everyone? This cannot be undone.')) {
        try {
          const res = await fetch('/api/groups/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              groupId: state.currentGroupId,
              username: state.currentUser.username
            })
          });
          const data = await res.json();
          if (data.success) {
            closeModal(el.modalGroupInfo);
            el.btnBackToHome.click();
            showToast('Group deleted', '🗑️');
            loadRecentChats();
          }
        } catch (err) {
          showToast('Failed to delete group: ' + err.message, '❌');
        }
      }
    });
  }
}

async function removeMemberFromGroup(groupId, memberUsername) {
  try {
    const res = await fetch('/api/groups/members/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupId,
        username: state.currentUser.username,
        targetUser: memberUsername
      })
    });
    const data = await res.json();
    return data.success;
  } catch (err) {
    showToast('Error removing member: ' + err.message, '❌');
    return false;
  }
}

function openAddGroupMembersModal(groupId) {
  if (!el.modalAddGroupMembers || !groupId) return;
  const currentMembers = (state.currentGroupInfo && state.currentGroupInfo.members) || [];
  const currentMemberUsernames = new Set(currentMembers.map(m => m.username));
  const selectedToAdd = new Set();

  const renderAddList = (query = '') => {
    el.addMembersClassmatesList.innerHTML = '';
    const candidates = [...state.friends];
    state.allStudents.forEach(s => {
      if (!candidates.some(c => c.username === s.username) && s.username !== state.currentUser.username) {
        candidates.push(s);
      }
    });

    const eligible = candidates.filter(s => {
      if (currentMemberUsernames.has(s.username)) return false;
      if (!query) return true;
      return s.username.toLowerCase().includes(query) ||
             (s.displayName && s.displayName.toLowerCase().includes(query)) ||
             (s.major && s.major.toLowerCase().includes(query));
    });

    if (eligible.length === 0) {
      el.addMembersClassmatesList.innerHTML = '<div style="text-align:center;padding:20px;color:#8E8E93;font-size:13px;">No more classmates available to add.</div>';
      return;
    }

    eligible.forEach(s => {
      const isSelected = selectedToAdd.has(s.username);
      const row = document.createElement('div');
      row.className = `classmate-select-row ${isSelected ? 'selected' : ''}`;
      row.innerHTML = `
        <div class="select-row-avatar" style="background-color: ${s.avatarColor || '#075E54'}">
          ${(s.displayName || s.username).charAt(0).toUpperCase()}
        </div>
        <div class="select-row-info">
          <div class="select-row-name">${escapeHtml(s.displayName || s.username)} <small style="color:#8E8E93;font-weight:normal">@${s.username}</small></div>
          <div class="select-row-sub">${escapeHtml(s.major || 'Okanagan College')}</div>
        </div>
        <div class="select-checkbox-circle"></div>
      `;

      row.addEventListener('click', () => {
        if (selectedToAdd.has(s.username)) {
          selectedToAdd.delete(s.username);
          row.classList.remove('selected');
        } else {
          selectedToAdd.add(s.username);
          row.classList.add('selected');
        }
      });

      el.addMembersClassmatesList.appendChild(row);
    });
  };

  if (el.addMembersSearchInput) {
    el.addMembersSearchInput.value = '';
    el.addMembersSearchInput.oninput = () => renderAddList(el.addMembersSearchInput.value.trim().toLowerCase());
  }

  if (el.btnCloseAddMembers) {
    el.btnCloseAddMembers.onclick = () => closeModal(el.modalAddGroupMembers);
  }

  if (el.btnSubmitAddMembers) {
    el.btnSubmitAddMembers.onclick = async () => {
      if (selectedToAdd.size === 0) {
        showToast('Select at least one classmate to add', '⚠️');
        return;
      }
      try {
        showToast('Adding participants...', '👥');
        const res = await fetch('/api/groups/members/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            groupId,
            username: state.currentUser.username,
            newMembers: Array.from(selectedToAdd)
          })
        });
        const data = await res.json();
        if (data.success) {
          closeModal(el.modalAddGroupMembers);
          showToast('Participants added! 🎉', '✅');
          openGroupInfoModal(groupId);
          updateGroupChatHeaderSubtitle(groupId);
          loadRecentChats();
        }
      } catch (err) {
        showToast('Failed to add members: ' + err.message, '❌');
      }
    };
  }

  renderAddList();
  openModal(el.modalAddGroupMembers);
}

if (el.modalImageLightbox) {
  el.modalImageLightbox.addEventListener('click', (e) => {
    if (e.target === el.modalImageLightbox || e.target.classList.contains('lightbox-container')) {
      closeLightbox();
    }
  });
}

document.querySelectorAll('.media-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.media-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.sharedMediaFilter = btn.dataset.mediaTab;
    updateSharedMediaTabVisibility();
  });
});

// Search & Add Friend Modal
async function openAddFriendModal() {
  openModal(el.modalAddFriend);
  el.addFriendInput.value = '';
  el.addFriendInput.focus();
  loadDirectoryInModal('');
}

async function loadDirectoryInModal(query = '') {
  if (!query) {
    el.searchResultsList.innerHTML = `
      <div style="text-align:center;padding:24px 16px;color:var(--text-light)">
        <div style="font-size:28px;margin-bottom:8px">🔒</div>
        <strong style="color:var(--text-dark);font-size:14px">Student Privacy Protected</strong>
        <p style="font-size:12px;margin-top:6px;line-height:1.5;max-width:320px;margin-left:auto;margin-right:auto">
          To protect student privacy, please enter a classmate's exact <strong>@username</strong> above to search and connect.
        </p>
      </div>
    `;
    return;
  }

  try {
    const res = await fetch(`/api/users/all?me=${encodeURIComponent(state.currentUser.username)}&query=${encodeURIComponent(query)}`);
    const data = await res.json();

    el.searchResultsList.innerHTML = '';
    if (data.students && data.students.length > 0) {
      data.students.forEach(u => {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        item.innerHTML = `
          <div>
            <strong>${u.displayName || u.username}</strong>
            <span style="color:var(--text-light);font-size:12px;margin-left:4px">@${u.username}</span>
            <div style="font-size:11px;color:${u.online ? 'var(--accent-green)' : 'var(--text-light)'}">
              ${u.online ? '● Online' : u.major}
            </div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn-chat-inline btn-modal-chat">💬 Chat</button>
            <button class="btn-add-inline btn-modal-add" data-username="${u.username}">
              ${u.isFriend ? '✓ Added' : (u.isRequested ? 'Requested' : '+ Add')}
            </button>
          </div>
        `;

        item.querySelector('.btn-modal-chat').addEventListener('click', () => {
          closeModal(el.modalAddFriend);
          openChat(u.username, u.displayName, false, u.online);
        });

        const addBtn = item.querySelector('.btn-modal-add');
        if (!u.isFriend && !u.isRequested) {
          addBtn.addEventListener('click', () => {
            sendFriendRequestAction(u.username);
            addBtn.textContent = 'Requested';
            addBtn.disabled = true;
          });
        } else {
          addBtn.disabled = true;
          addBtn.style.opacity = '0.6';
        }

        el.searchResultsList.appendChild(item);
      });
    } else {
      el.searchResultsList.innerHTML = `<div style="text-align:center;padding:12px;color:var(--text-light);font-size:13px">No registered classmates match "@${escapeHtml(query)}".</div>`;
    }
  } catch (_) {}
}

el.fabAddFriend.addEventListener('click', openAddFriendModal);
el.btnCloseAddModal.addEventListener('click', () => closeModal(el.modalAddFriend));

el.addFriendInput.addEventListener('input', () => {
  const q = el.addFriendInput.value.trim().toLowerCase().replace(/^@/, '');
  loadDirectoryInModal(q);
});

el.btnSubmitAddFriend.addEventListener('click', () => {
  const target = el.addFriendInput.value.trim().toLowerCase().replace(/^@/, '');
  if (target) sendFriendRequestAction(target);
});

// SOS & Walk Me Home Modal
el.fabSos.addEventListener('click', () => openModal(el.modalSos));
el.btnCloseSosModal.addEventListener('click', () => closeModal(el.modalSos));

el.btnTriggerSos.addEventListener('click', async () => {
  if (!confirm('Are you sure you want to broadcast an emergency SOS beacon to Campus Security & your friends?')) {
    return;
  }

  showToast('Broadcasting SOS Beacon...', '🚨');
  try {
    const res = await fetch('/api/sos/alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: state.currentUser.username,
        locationName: 'Okanagan College KLO Campus'
      })
    });
    const data = await res.json();
    if (res.ok) {
      showToast('🚨 SOS broadcasted! Campus Security notified.', '🚨');
      closeModal(el.modalSos);
    }
  } catch (err) {
    showToast('Failed to broadcast SOS: ' + err.message, '❌');
  }
});

el.btnWalkMeHome.addEventListener('click', async () => {
  showToast('Walk Me Home buddy active! Friends alerted to monitor safe arrival.', '🚶‍♀️');
  try {
    await fetch('/api/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: state.currentUser.username,
        channel: 'campus-safety',
        text: `🚶‍♀️ Walk Me Home initiated by @${state.currentUser.username} from KLO Campus Library (15m timer active).`
      })
    });
    closeModal(el.modalSos);
  } catch (_) {}
});

// Share App Modal
el.btnShareApp.addEventListener('click', () => {
  const secureUrl = getAppPublicUrl();
  el.shareLinkInput.value = secureUrl;
  openModal(el.modalShare);
});
el.btnCloseShareModal.addEventListener('click', () => closeModal(el.modalShare));

el.btnCopyShareLink.addEventListener('click', () => {
  el.shareLinkInput.select();
  navigator.clipboard.writeText(el.shareLinkInput.value).then(() => {
    showToast('Link copied to clipboard! Send to your classmates.', '📋');
  });
});

// Logout
el.btnLogout.addEventListener('click', async () => {
  if (confirm('Are you sure you want to log out of OC Connect?')) {
    const token = localStorage.getItem('oc_connect_auth_token');
    if (token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          }
        });
      } catch (_) {}
    }
    localStorage.removeItem('oc_connect_auth_token');
    localStorage.removeItem('oc_connect_user');
    if (state.chatSyncInterval) clearInterval(state.chatSyncInterval);
    if (state.homeSyncInterval) clearInterval(state.homeSyncInterval);
    if (state.eventSource) state.eventSource.close();
    location.reload();
  }
});

// Resume stream & sync instantly when user switches back to browser tab
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.currentUser) {
    if (!el.chatScreen.classList.contains('hidden') && state.currentChatTarget) {
      fetchAndRenderChatMessages(false);
    } else {
      loadRecentChats();
      loadFriendRequests();
      loadFriendsList();
    }
    if (!state.eventSource || state.eventSource.readyState === EventSource.CLOSED) {
      connectEventSource();
    }
  }
});

// ===========================================================================
// PROFILE PICTURE & AVATAR RENDERING HELPERS
// ===========================================================================

/**
 * Render an avatar into any element — either a profile image or letter initial.
 * @param {HTMLElement} el - The container element (.avatar-circle or .avatar-sm)
 * @param {string} letter - Fallback initial letter
 * @param {string} color - Background color
 * @param {string|null} imageUrl - Base64 data URL or null
 */
function renderAvatar(avatarEl, letter, color, imageUrl) {
  if (!avatarEl) return;
  if (imageUrl) {
    avatarEl.style.backgroundColor = color || '#128C7E';
    avatarEl.innerHTML = `<img src="${imageUrl}" alt="${letter}" draggable="false">`;
    avatarEl.classList.add('has-image');
  } else {
    avatarEl.style.backgroundColor = color || '#128C7E';
    avatarEl.textContent = letter || '?';
    avatarEl.classList.remove('has-image');
  }
}

/**
 * Compress an image File to a base64 data URL at the given max dimension / quality.
 */
function compressAvatarImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality || 0.85));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ===========================================================================
// SETTINGS MODAL
// ===========================================================================

const elSettings = {
  modal: document.getElementById('modal-settings'),
  btnClose: document.getElementById('btn-close-settings-modal'),
  avatarCircle: document.getElementById('settings-avatar-circle'),
  btnChangeAvatar: document.getElementById('btn-change-avatar'),
  removePhotoBtnWrap: document.getElementById('settings-remove-photo-btn-wrap'),
  btnRemoveAvatar: document.getElementById('btn-remove-avatar'),
  cardName: document.getElementById('settings-card-name'),
  cardHandle: document.getElementById('settings-card-handle'),
  displayNameInput: document.getElementById('settings-display-name-input'),
  btnSaveDisplayName: document.getElementById('btn-save-display-name'),
  usernameInput: document.getElementById('settings-username-input'),
  btnSaveUsername: document.getElementById('btn-save-username-change'),
  majorInput: document.getElementById('settings-major-input'),
  btnSaveMajor: document.getElementById('btn-save-major'),
  ocidVal: document.getElementById('settings-ocid-val'),
  btnLogout: document.getElementById('btn-settings-logout'),
  avatarFileInput: document.getElementById('avatar-file-input'),
  toggleDarkMode: document.getElementById('toggle-dark-mode')
};

function openSettingsModal() {
  if (!state.currentUser) return;
  const u = state.currentUser;

  // Pre-fill profile preview card
  if (elSettings.cardName) elSettings.cardName.textContent = u.displayName || u.username;
  if (elSettings.cardHandle) elSettings.cardHandle.textContent = `@${u.username}`;

  // Pre-fill fields
  if (elSettings.displayNameInput) elSettings.displayNameInput.value = u.displayName || u.username || '';
  if (elSettings.usernameInput) elSettings.usernameInput.value = '';
  if (elSettings.majorInput) elSettings.majorInput.value = u.major || 'Okanagan College';
  if (elSettings.ocidVal) elSettings.ocidVal.textContent = u.ocId ? `${u.ocId}` : '••••••••';

  // Render avatar
  renderAvatar(
    elSettings.avatarCircle,
    (u.displayName || u.username || 'U').charAt(0).toUpperCase(),
    u.avatarColor,
    u.avatarImage || null
  );

  // Show remove photo button only if there's a custom avatar
  if (elSettings.removePhotoBtnWrap) {
    elSettings.removePhotoBtnWrap.classList.toggle('hidden', !u.avatarImage);
  }

  // Load Notification settings & Blocked students list
  initNotificationSettings();
  loadBlockedStudentsList();

  // Sync Dark Mode Switch
  if (elSettings.toggleDarkMode) {
    elSettings.toggleDarkMode.checked = document.documentElement.getAttribute('data-theme') === 'dark';
  }

  openModal(elSettings.modal);
}

// Wire Sign Out inside Settings modal to main logout handler
if (elSettings.btnLogout) {
  elSettings.btnLogout.addEventListener('click', () => {
    closeModal(elSettings.modal);
    if (el.btnLogout) el.btnLogout.click();
  });
}

// Generate Avatar via DiceBear API
if (el.btnGenerateAvatar) {
  el.btnGenerateAvatar.addEventListener('click', async () => {
    if (!state.currentUser) return;
    el.btnGenerateAvatar.textContent = 'Generating... 🎲';
    el.btnGenerateAvatar.disabled = true;

    try {
      const styles = ['bottts', 'adventurer', 'fun-emoji', 'lorelei', 'notionists'];
      const randomStyle = styles[Math.floor(Math.random() * styles.length)];
      const seed = state.currentUser.username + '_' + Math.random().toString(36).substr(2, 6);
      const dicebearUrl = `https://api.dicebear.com/7.x/${randomStyle}/svg?seed=${encodeURIComponent(seed)}&backgroundColor=075E54,128C7E,007AFF,5856D6,FF9500`;

      const svgRes = await fetch(dicebearUrl);
      const svgText = await svgRes.text();
      const base64Svg = 'data:image/svg+xml;utf8,' + encodeURIComponent(svgText);

      const res = await fetch('/api/users/profile-picture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: state.currentUser.username, image: base64Svg })
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Could not save generated avatar.', '❌');
        return;
      }

      state.currentUser.avatarImage = data.avatarImage;
      localStorage.setItem('oc_connect_user', JSON.stringify(state.currentUser));
      updateAllMyAvatarInstances();

      renderAvatar(
        elSettings.avatarCircle,
        (state.currentUser.displayName || state.currentUser.username).charAt(0).toUpperCase(),
        state.currentUser.avatarColor,
        data.avatarImage
      );
      if (elSettings.removePhotoBtnWrap) elSettings.removePhotoBtnWrap.classList.remove('hidden');
      showToast('Generated fresh creative avatar! 🎲✨', '✅');
    } catch (err) {
      showToast('Error generating avatar: ' + err.message, '❌');
    } finally {
      el.btnGenerateAvatar.textContent = '🎲 Generate Cool Avatar';
      el.btnGenerateAvatar.disabled = false;
    }
  });
}

// Open settings when user chip is clicked
const userChipBtn = document.getElementById('user-chip-btn');
if (userChipBtn) {
  userChipBtn.addEventListener('click', openSettingsModal);
}

// Close button (Done) — auto-saves any un-submitted edits in input fields
if (elSettings.btnClose) {
  elSettings.btnClose.addEventListener('click', async () => {
    // If user edited display name without pressing save, auto-save now
    if (elSettings.displayNameInput && state.currentUser) {
      const currentVal = elSettings.displayNameInput.value.trim();
      if (currentVal && currentVal !== state.currentUser.displayName) {
        await saveDisplayNameAction();
      }
    }
    // If user edited program without pressing save, auto-save now
    if (elSettings.majorInput && state.currentUser) {
      const currentMajor = elSettings.majorInput.value.trim();
      if (currentMajor && currentMajor !== state.currentUser.major) {
        await saveMajorAction();
      }
    }
    closeModal(elSettings.modal);
  });
}

// Close on backdrop tap — auto-saves edits
if (elSettings.modal) {
  elSettings.modal.addEventListener('click', async (e) => {
    if (e.target === elSettings.modal) {
      if (elSettings.displayNameInput && state.currentUser) {
        const currentVal = elSettings.displayNameInput.value.trim();
        if (currentVal && currentVal !== state.currentUser.displayName) {
          await saveDisplayNameAction();
        }
      }
      if (elSettings.majorInput && state.currentUser) {
        const currentMajor = elSettings.majorInput.value.trim();
        if (currentMajor && currentMajor !== state.currentUser.major) {
          await saveMajorAction();
        }
      }
      closeModal(elSettings.modal);
    }
  });
}

// Open file picker for profile picture
if (elSettings.btnChangeAvatar) {
  elSettings.btnChangeAvatar.addEventListener('click', () => {
    elSettings.avatarFileInput && elSettings.avatarFileInput.click();
  });
}

// Handle file selection → compress → upload
if (elSettings.avatarFileInput) {
  elSettings.avatarFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    // Reset input so same file can be picked again
    elSettings.avatarFileInput.value = '';

    showToast('Uploading photo...', '⏳');
    try {
      // Compress to max 400px, 85% quality
      const dataUrl = await compressAvatarImage(file, 400, 0.85);

      const res = await fetch('/api/users/profile-picture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: state.currentUser.username, image: dataUrl })
      });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || 'Could not upload photo.', '❌');
        return;
      }

      // Update local state
      state.currentUser.avatarImage = data.avatarImage;
      localStorage.setItem('oc_connect_user', JSON.stringify(state.currentUser));

      // Update all avatar instances in the UI
      updateAllMyAvatarInstances();

      // Refresh settings modal avatar
      renderAvatar(
        elSettings.avatarCircle,
        (state.currentUser.displayName || state.currentUser.username).charAt(0).toUpperCase(),
        state.currentUser.avatarColor,
        data.avatarImage
      );
      if (elSettings.removePhotoBtnWrap) elSettings.removePhotoBtnWrap.classList.remove('hidden');

      showToast('Profile photo updated! ✅', '🖼️');
    } catch (err) {
      showToast('Error uploading photo: ' + err.message, '❌');
    }
  });
}

// Remove profile picture
if (elSettings.btnRemoveAvatar) {
  elSettings.btnRemoveAvatar.addEventListener('click', async () => {
    if (!confirm('Remove your profile photo?')) return;
    try {
      const res = await fetch('/api/users/profile-picture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: state.currentUser.username, image: null })
      });
      if (!res.ok) {
        showToast('Could not remove photo.', '❌');
        return;
      }

      state.currentUser.avatarImage = null;
      localStorage.setItem('oc_connect_user', JSON.stringify(state.currentUser));
      updateAllMyAvatarInstances();

      renderAvatar(
        elSettings.avatarCircle,
        (state.currentUser.displayName || state.currentUser.username).charAt(0).toUpperCase(),
        state.currentUser.avatarColor,
        null
      );
      if (elSettings.removePhotoBtnWrap) elSettings.removePhotoBtnWrap.classList.add('hidden');
      showToast('Profile photo removed.', '✅');
    } catch (err) {
      showToast('Error removing photo: ' + err.message, '❌');
    }
  });
}

// Helper to save display name
async function saveDisplayNameAction() {
  if (!state.currentUser || !elSettings.displayNameInput) return;
  const newName = (elSettings.displayNameInput.value || '').trim();
  if (!newName) { showToast('Display name cannot be empty.', '⚠️'); return; }
  if (newName === state.currentUser.displayName) return;

  if (elSettings.btnSaveDisplayName) {
    elSettings.btnSaveDisplayName.disabled = true;
    elSettings.btnSaveDisplayName.textContent = 'Saving...';
  }

  try {
    const res = await fetch('/api/users/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: state.currentUser.username,
        displayName: newName
      })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to update name.', '❌');
      return;
    }

    state.currentUser.displayName = newName;
    localStorage.setItem('oc_connect_user', JSON.stringify(state.currentUser));
    updateAllMyAvatarInstances();
    if (elSettings.cardName) elSettings.cardName.textContent = newName;
    if (el.currentUserHandle) el.currentUserHandle.textContent = `@${state.currentUser.username}`;
    showToast(`Display name saved: "${newName}" ✅`, '✏️');
  } catch (err) {
    showToast('Error saving display name: ' + err.message, '❌');
  } finally {
    if (elSettings.btnSaveDisplayName) {
      elSettings.btnSaveDisplayName.disabled = false;
      elSettings.btnSaveDisplayName.textContent = 'Save';
    }
  }
}

// Helper to save program / major
async function saveMajorAction() {
  if (!state.currentUser || !elSettings.majorInput) return;
  const newMajor = (elSettings.majorInput.value || '').trim();
  if (!newMajor) { showToast('Program cannot be empty.', '⚠️'); return; }
  if (newMajor === state.currentUser.major) return;

  if (elSettings.btnSaveMajor) {
    elSettings.btnSaveMajor.disabled = true;
    elSettings.btnSaveMajor.textContent = 'Saving...';
  }

  try {
    const res = await fetch('/api/users/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: state.currentUser.username,
        major: newMajor
      })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to update program.', '❌');
      return;
    }

    state.currentUser.major = newMajor;
    localStorage.setItem('oc_connect_user', JSON.stringify(state.currentUser));
    showToast(`Program updated: "${newMajor}" ✅`, '🎓');
  } catch (err) {
    showToast('Error saving program: ' + err.message, '❌');
  } finally {
    if (elSettings.btnSaveMajor) {
      elSettings.btnSaveMajor.disabled = false;
      elSettings.btnSaveMajor.textContent = 'Save';
    }
  }
}

// Save display name button & Enter key
if (elSettings.btnSaveDisplayName) {
  elSettings.btnSaveDisplayName.addEventListener('click', saveDisplayNameAction);
}
if (elSettings.displayNameInput) {
  elSettings.displayNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveDisplayNameAction();
    }
  });
}

// Save program/major button & Enter key
if (elSettings.btnSaveMajor) {
  elSettings.btnSaveMajor.addEventListener('click', saveMajorAction);
}
if (elSettings.majorInput) {
  elSettings.majorInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveMajorAction();
    }
  });
}

// Helper to change username
async function saveUsernameAction() {
  if (!state.currentUser || !elSettings.usernameInput) return;
  const newUsername = (elSettings.usernameInput.value || '').trim().toLowerCase().replace(/^@/, '');
  if (!newUsername) { showToast('Please enter a new username.', '⚠️'); return; }
  if (newUsername === state.currentUser.username) {
    showToast('That is already your username.', 'ℹ️'); return;
  }
  if (!/^[a-z0-9_]+$/.test(newUsername)) {
    showToast('Username may only contain letters, numbers, and underscores.', '⚠️'); return;
  }
  if (newUsername.length < 3 || newUsername.length > 20) {
    showToast('Username must be 3–20 characters.', '⚠️'); return;
  }
  if (!confirm(`Change your username from @${state.currentUser.username} to @${newUsername}? Your chat history and friends list will be migrated.`)) return;

  if (elSettings.btnSaveUsername) {
    elSettings.btnSaveUsername.textContent = 'Changing...';
    elSettings.btnSaveUsername.disabled = true;
  }

  try {
    const res = await fetch('/api/auth/change-username', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentUsername: state.currentUser.username,
        newUsername: newUsername
      })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Could not change username.', '❌');
      return;
    }

    // Update state and localStorage with new user object
    state.currentUser = data.user;
    localStorage.setItem('oc_connect_user', JSON.stringify(data.user));

    // Update UI
    if (el.currentUserHandle) el.currentUserHandle.textContent = `@${data.user.username}`;
    if (elSettings.cardHandle) elSettings.cardHandle.textContent = `@${data.user.username}`;
    if (elSettings.cardName) elSettings.cardName.textContent = data.user.displayName || data.user.username;
    updateAllMyAvatarInstances();

    // Reconnect SSE with new username
    connectEventSource();

    // Reload friends and directory
    loadFriendsList();
    loadCampusDirectory();
    loadRecentChats();

    elSettings.usernameInput.value = '';
    closeModal(elSettings.modal);
    showToast(`Username changed to @${data.user.username}! ✅`, '🎉');
  } catch (err) {
    showToast('Error changing username: ' + err.message, '❌');
  } finally {
    if (elSettings.btnSaveUsername) {
      elSettings.btnSaveUsername.textContent = 'Change';
      elSettings.btnSaveUsername.disabled = false;
    }
  }
}

// Change username button & Enter key
if (elSettings.btnSaveUsername) {
  elSettings.btnSaveUsername.addEventListener('click', saveUsernameAction);
}
if (elSettings.usernameInput) {
  elSettings.usernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveUsernameAction();
    }
  });
}

/**
 * Update all my avatar instances in the UI (header chip, chat headers, etc.)
 */
function updateAllMyAvatarInstances() {
  if (!state.currentUser) return;
  const u = state.currentUser;
  const letter = (u.displayName || u.username || 'U').charAt(0).toUpperCase();

  // App bar avatar
  renderAvatar(el.currentUserAvatar, letter, u.avatarColor, u.avatarImage || null);
  // Handle text
  if (el.currentUserHandle) el.currentUserHandle.textContent = `@${u.username}`;
}

// ===========================================================================
// ALSO APPLY avatarImage to /api/users/me restore on page load
// Patch showMainScreen to render avatar image if present
// ===========================================================================

const _origShowMainScreen = showMainScreen;
// Wrap showMainScreen to also render profile picture
const showMainScreenPatched = function() {
  _origShowMainScreen();
  // Apply profile image to header chip after base call
  if (state.currentUser && state.currentUser.avatarImage) {
    renderAvatar(
      el.currentUserAvatar,
      (state.currentUser.displayName || state.currentUser.username).charAt(0).toUpperCase(),
      state.currentUser.avatarColor,
      state.currentUser.avatarImage
    );
  }
};
// Override showMainScreen — we call updateAllMyAvatarInstances inside showMainScreen directly
// by patching the existing showMainScreen to call updateAllMyAvatarInstances at the end.
// Since we can't reassign after declaration, we hook via the existing DOMContentLoaded observer.
document.addEventListener('oc-connect-main-shown', updateAllMyAvatarInstances);

// ===========================================================================
// DARK MODE / THEME CONTROLLER
// ===========================================================================
function applyAppTheme(theme, save = true) {
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    if (metaTheme) metaTheme.setAttribute('content', '#000000');
    if (elSettings.toggleDarkMode) elSettings.toggleDarkMode.checked = true;
  } else {
    document.documentElement.removeAttribute('data-theme');
    if (metaTheme) metaTheme.setAttribute('content', '#075E54');
    if (elSettings.toggleDarkMode) elSettings.toggleDarkMode.checked = false;
  }
  if (save) {
    try {
      localStorage.setItem('oc_theme', theme);
    } catch (_) {}
  }
}

// Wire dark mode toggle checkbox
if (elSettings.toggleDarkMode) {
  elSettings.toggleDarkMode.addEventListener('change', (e) => {
    const isDark = e.target.checked;
    applyAppTheme(isDark ? 'dark' : 'light', true);
    showToast(isDark ? 'Dark mode enabled 🌙' : 'Light mode enabled ☀️', isDark ? '🌙' : '☀️');
  });
}

// System color scheme change listener if user has no stored preference
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (!localStorage.getItem('oc_theme')) {
    applyAppTheme(e.matches ? 'dark' : 'light', false);
  }
});

// Sync initial toggle state on page load
(function initThemeOnLoad() {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  if (elSettings.toggleDarkMode) {
    elSettings.toggleDarkMode.checked = current === 'dark';
  }
})();

// ===========================================================================
// PUBLIC FREE OPEN APIS INTEGRATION:
// 1. Open-Meteo Okanagan College Campus Weather
// 2. DummyJSON / Free Quotes Daily Student Motivation
// 3. DiceBear SVG Creative Avatar Generator
// 4. Wikimedia REST API Instant Academic Explainer
// 5. Open Library Free Book & Textbook Finder
// 6. Official Joke API College Study Break Humor
// ===========================================================================

// State for Weather
state.currentCampus = 'klo';
state.currentWeatherData = null;

const CAMPUS_COORDS = {
  'klo': { lat: 49.8625, lon: -119.4795, name: 'Kelowna Campus (KLO)' },
  'vernon': { lat: 50.2624, lon: -119.2734, name: 'Vernon Campus' },
  'penticton': { lat: 49.4928, lon: -119.5886, name: 'Penticton Campus' },
  'salmon-arm': { lat: 50.7022, lon: -119.2721, name: 'Salmon Arm Campus' }
};

/**
 * Fetch Campus Weather (Open-Meteo Free API)
 */
async function fetchCampusWeather(campus = 'klo') {
  const selected = CAMPUS_COORDS[campus] || CAMPUS_COORDS['klo'];
  try {
    const directUrl = `https://api.open-meteo.com/v1/forecast?latitude=${selected.lat}&longitude=${selected.lon}&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m`;
    const res = await fetch(directUrl);
    if (res.ok) {
      const raw = await res.json();
      const code = raw.current ? raw.current.weather_code : 0;
      const temp = raw.current ? Math.round(raw.current.temperature_2m) : 18;
      const humidity = raw.current ? raw.current.relative_humidity_2m : 45;
      const wind = raw.current ? Math.round(raw.current.wind_speed_10m) : 5;

      let condition = 'Clear & Sunny';
      let emoji = '☀️';
      let advice = 'Great weather for walking between KLO Student Center and Library!';
      if (code === 0) { condition = 'Clear & Sunny'; emoji = '☀️'; }
      else if (code >= 1 && code <= 3) { condition = 'Partly Cloudy'; emoji = '⛅'; advice = 'Mild weather across campus.'; }
      else if (code === 45 || code === 48) { condition = 'Foggy'; emoji = '🌫️'; advice = 'Careful driving to morning lectures.'; }
      else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) { condition = 'Rain Showers'; emoji = '🌧️'; advice = 'Grab an umbrella before heading to your next lecture!'; }
      else if (code >= 71 && code <= 77) { condition = 'Snowing'; emoji = '❄️'; advice = 'Dress warmly and watch for ice on campus walkways!'; }
      else if (code >= 95) { condition = 'Thunderstorm'; emoji = '⛈️'; advice = 'Stay indoors in the campus study lounges.'; }

      return {
        success: true,
        campus: selected.name,
        campusCode: campus,
        tempString: `${temp}°C`,
        condition,
        emoji,
        humidity: `${humidity}%`,
        wind: `${wind} km/h`,
        advice
      };
    }
  } catch (_) {}

  // Fallback to server proxy
  try {
    const res = await fetch(`/api/campus/weather?campus=${encodeURIComponent(campus)}`);
    return await res.json();
  } catch (_) {
    return {
      success: true,
      campus: selected.name,
      campusCode: campus,
      tempString: '18°C',
      condition: 'Clear & Sunny',
      emoji: '☀️',
      humidity: '45%',
      wind: '6 km/h',
      advice: 'Sunny day at Okanagan College!'
    };
  }
}

async function loadCampusWeather(campus = 'klo') {
  state.currentCampus = campus;
  const data = await fetchCampusWeather(campus);
  if (!data || !data.success) return;
  state.currentWeatherData = data;

  if (el.weatherIcon) el.weatherIcon.textContent = data.emoji || '🌤️';
  if (el.weatherTemp) el.weatherTemp.textContent = data.tempString || '18°C';

  if (el.weatherDetailEmoji) el.weatherDetailEmoji.textContent = data.emoji || '🌤️';
  if (el.weatherDetailTemp) el.weatherDetailTemp.textContent = data.tempString || '18°C';
  if (el.weatherDetailCondition) el.weatherDetailCondition.textContent = data.condition || 'Clear';
  if (el.weatherDetailCampus) el.weatherDetailCampus.textContent = data.campus || 'Kelowna Campus (KLO)';
  if (el.weatherDetailHumidity) el.weatherDetailHumidity.textContent = data.humidity || '45%';
  if (el.weatherDetailWind) el.weatherDetailWind.textContent = data.wind || '5 km/h';
  if (el.weatherDetailAdvice) el.weatherDetailAdvice.textContent = data.advice || 'Great weather for walking between classes!';
}

// Weather Pill Click -> Open Modal
if (el.btnCampusWeather) {
  el.btnCampusWeather.addEventListener('click', () => {
    openModal(el.modalCampusWeather);
    loadCampusWeather(state.currentCampus || 'klo');
  });
}

// Close Weather Modal
if (el.btnCloseWeatherModal) {
  el.btnCloseWeatherModal.addEventListener('click', () => {
    closeModal(el.modalCampusWeather);
  });
}

// Weather modal backdrop tap
if (el.modalCampusWeather) {
  el.modalCampusWeather.addEventListener('click', (e) => {
    if (e.target === el.modalCampusWeather) closeModal(el.modalCampusWeather);
  });
}

// Campus Selector Chips
document.querySelectorAll('.campus-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.campus-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    const campus = chip.dataset.campus || 'klo';
    loadCampusWeather(campus);
  });
});

// Share Weather to Chat Button
if (el.btnShareWeatherChat) {
  el.btnShareWeatherChat.addEventListener('click', async () => {
    if (!state.currentChatTarget) {
      showToast('Open a chat first to share campus weather!', '💬');
      closeModal(el.modalCampusWeather);
      return;
    }
    const w = state.currentWeatherData || await fetchCampusWeather(state.currentCampus || 'klo');
    closeModal(el.modalCampusWeather);
    await sendStudyCardMessage({
      type: 'weather',
      campus: w.campus,
      tempString: w.tempString,
      condition: w.condition,
      emoji: w.emoji,
      humidity: w.humidity,
      wind: w.wind,
      advice: w.advice
    });
    showToast(`Shared ${w.campus} weather in chat! 🌤️`, '✅');
  });
}

/**
 * 2. DiceBear Creative Avatar Generator (Open API)
 */
const btnGenerateAvatar = document.getElementById('btn-generate-avatar');
if (btnGenerateAvatar) {
  btnGenerateAvatar.addEventListener('click', async () => {
    if (!state.currentUser) return;
    const styles = ['bottts', 'fun-emoji', 'micah', 'lorelei', 'adventurer', 'avataaars'];
    const randomStyle = styles[Math.floor(Math.random() * styles.length)];
    const randomSeed = Math.random().toString(36).substring(2, 9);
    const dicebearUrl = `https://api.dicebear.com/7.x/${randomStyle}/svg?seed=${randomSeed}`;

    showToast('Generating creative avatar...', '🎲');
    try {
      const res = await fetch('/api/users/profile-picture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: state.currentUser.username,
          image: dicebearUrl
        })
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Could not save avatar.', '❌');
        return;
      }

      state.currentUser.avatarImage = dicebearUrl;
      localStorage.setItem('oc_connect_user', JSON.stringify(state.currentUser));
      updateAllMyAvatarInstances();

      const settingsAvatarCircle = document.getElementById('settings-avatar-circle');
      if (settingsAvatarCircle) {
        renderAvatar(
          settingsAvatarCircle,
          (state.currentUser.displayName || state.currentUser.username).charAt(0).toUpperCase(),
          state.currentUser.avatarColor,
          dicebearUrl
        );
      }
      const removePhotoWrap = document.getElementById('settings-remove-photo-btn-wrap');
      if (removePhotoWrap) removePhotoWrap.classList.remove('hidden');
      showToast(`New ${randomStyle} avatar set! 🎉`, '✨');
    } catch (err) {
      showToast('Error generating avatar: ' + err.message, '❌');
    }
  });
}

/**
 * 4. Helper: Wikipedia Topic Search
 */
async function fetchWikiSummary(q) {
  // 1. Direct Wikipedia REST summary
  try {
    const wikiRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q.replace(/\s+/g, '_'))}`);
    if (wikiRes.ok) {
      const data = await wikiRes.json();
      if (data && data.title && data.extract) {
        return {
          success: true,
          title: data.title,
          extract: data.extract,
          url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(q)}`
        };
      }
    }
  } catch (_) {}

  // 2. Wikipedia opensearch with origin=*
  try {
    const sRes = await fetch(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=1&namespace=0&format=json&origin=*`);
    if (sRes.ok) {
      const sData = await sRes.json();
      if (Array.isArray(sData) && sData[1] && sData[1][0]) {
        const title = sData[1][0];
        const snippet = sData[2] && sData[2][0] ? sData[2][0] : '';
        const url = sData[3] && sData[3][0] ? sData[3][0] : `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`;
        try {
          const sumRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/\s+/g, '_'))}`);
          if (sumRes.ok) {
            const sumData = await sumRes.json();
            if (sumData && sumData.extract) {
              return { success: true, title: sumData.title, extract: sumData.extract, url: sumData.content_urls?.desktop?.page || url };
            }
          }
        } catch (_) {}
        return { success: true, title, extract: snippet || 'Detailed topic overview available on Wikipedia.', url };
      }
    }
  } catch (_) {}

  // 3. Fallback to server endpoint
  try {
    const res = await fetch(`/api/study/wiki?q=${encodeURIComponent(q)}`);
    return await res.json();
  } catch (_) {
    return { success: false, error: 'Could not fetch Wikipedia article.' };
  }
}

/**
 * 5. Helper: Open Library Book Search
 */
async function fetchBookSearch(q) {
  // 1. Direct Open Library query
  try {
    const res = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=3`);
    if (res.ok) {
      const data = await res.json();
      const books = (data.docs || []).slice(0, 3).map(b => ({
        title: b.title,
        author: b.author_name ? b.author_name[0] : 'Unknown Author',
        year: b.first_publish_year || 'N/A',
        url: b.key ? `https://openlibrary.org${b.key}` : `https://openlibrary.org/search?q=${encodeURIComponent(q)}`
      }));
      if (books.length > 0) return { success: true, books };
    }
  } catch (_) {}

  // 2. Server proxy fallback
  try {
    const res = await fetch(`/api/study/books?q=${encodeURIComponent(q)}`);
    return await res.json();
  } catch (err) {
    return { success: false, books: [], error: err.message };
  }
}

/**
 * 6. Helper: Joke API
 */
async function fetchStudyJoke() {
  // 1. Direct Official Joke API
  try {
    const res = await fetch('https://official-joke-api.appspot.com/random_joke');
    if (res.ok) {
      const data = await res.json();
      if (data && data.setup && data.punchline) {
        return { success: true, setup: data.setup, punchline: data.punchline };
      }
    }
  } catch (_) {}

  // 2. Server fallback
  try {
    const res = await fetch('/api/study/joke');
    return await res.json();
  } catch (_) {
    return {
      success: true,
      setup: 'Why do computer science students prefer dark mode?',
      punchline: 'Because light attracts bugs!'
    };
  }
}

/**
 * Study & Academic Tools Modal (Wikipedia, Open Library, Joke API)
 */
// Open Study Tools
if (el.btnStudyTools) {
  el.btnStudyTools.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openModal(el.modalStudyTools);
  });
}

// Close Study Tools
if (el.btnCloseStudyModal) {
  el.btnCloseStudyModal.addEventListener('click', () => {
    closeModal(el.modalStudyTools);
  });
}

// Backdrop tap
if (el.modalStudyTools) {
  el.modalStudyTools.addEventListener('click', (e) => {
    if (e.target === el.modalStudyTools) closeModal(el.modalStudyTools);
  });
}

// Wikipedia Search
async function executeWikiSearch() {
  const q = (el.wikiSearchInput?.value || '').trim();
  if (!q) {
    showToast('Enter a topic to explain (e.g. Mitochondria, Binary Search)', '⚠️');
    return;
  }
  el.btnSubmitWiki.textContent = 'Searching...';
  el.btnSubmitWiki.disabled = true;

  try {
    const data = await fetchWikiSummary(q);
    if (data && data.success) {
      el.wikiResultPreview.classList.remove('hidden');
      el.wikiResultPreview.innerHTML = `
        <div class="study-preview-header">
          <span class="study-preview-title">${escapeHtml(data.title)}</span>
          <span class="study-preview-badge">Wikipedia</span>
        </div>
        <div class="study-preview-body">${escapeHtml(data.extract)}</div>
        <button id="btn-send-wiki-chat" class="study-btn-send">
          Send to Chat 💬
        </button>
      `;
      document.getElementById('btn-send-wiki-chat')?.addEventListener('click', async () => {
        if (!state.currentChatTarget) {
          showToast('Open a chat first to share this!', '💬'); return;
        }
        closeModal(el.modalStudyTools);
        await sendStudyCardMessage({
          type: 'wiki',
          title: data.title,
          extract: data.extract,
          url: data.url
        });
        showToast('Wikipedia card sent! 📖', '✅');
      });
    } else {
      showToast(data?.error || 'Topic not found on Wikipedia.', '⚠️');
    }
  } catch (err) {
    showToast('Search error: ' + err.message, '❌');
  } finally {
    el.btnSubmitWiki.textContent = 'Search';
    el.btnSubmitWiki.disabled = false;
  }
}

if (el.btnSubmitWiki) el.btnSubmitWiki.addEventListener('click', executeWikiSearch);
if (el.wikiSearchInput) {
  el.wikiSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      executeWikiSearch();
    }
  });
}

// Open Library Book Search
async function executeBookSearch() {
  const q = (el.bookSearchInput?.value || '').trim();
  if (!q) {
    showToast('Enter a book or topic (e.g. Calculus, Python)', '⚠️');
    return;
  }
  el.btnSubmitBook.textContent = 'Finding...';
  el.btnSubmitBook.disabled = true;

  try {
    const data = await fetchBookSearch(q);
    if (data && data.success && data.books && data.books.length > 0) {
      el.bookResultPreview.classList.remove('hidden');
      let booksHtml = data.books.map((b, idx) => `
        <div style="margin-bottom:8px;padding-bottom:8px;border-bottom:0.5px solid rgba(255,255,255,0.08)">
          <div style="font-weight:600;color:#fff">${escapeHtml(b.title)}</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.6)">By ${escapeHtml(b.author)} (${escapeHtml(String(b.year))})</div>
          <button class="study-btn-send send-book-btn" data-index="${idx}" style="margin-top:4px">
            Send to Chat 💬
          </button>
        </div>
      `).join('');

      el.bookResultPreview.innerHTML = `
        <div class="study-preview-header">
          <span class="study-preview-title">Found ${data.books.length} Books</span>
          <span class="study-preview-badge">Open Library</span>
        </div>
        ${booksHtml}
      `;

      el.bookResultPreview.querySelectorAll('.send-book-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!state.currentChatTarget) {
            showToast('Open a chat first to share this book!', '💬'); return;
          }
          const idx = parseInt(btn.dataset.index, 10);
          const b = data.books[idx];
          closeModal(el.modalStudyTools);
          await sendStudyCardMessage({
            type: 'book',
            title: b.title,
            author: b.author,
            year: b.year,
            url: b.url
          });
          showToast('Book card sent! 📚', '✅');
        });
      });
    } else {
      showToast('No books found for this topic.', '⚠️');
    }
  } catch (err) {
    showToast('Search error: ' + err.message, '❌');
  } finally {
    el.btnSubmitBook.textContent = 'Find';
    el.btnSubmitBook.disabled = false;
  }
}

if (el.btnSubmitBook) el.btnSubmitBook.addEventListener('click', executeBookSearch);
if (el.bookSearchInput) {
  el.bookSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      executeBookSearch();
    }
  });
}

// Official Joke API
if (el.btnGetJoke) {
  el.btnGetJoke.addEventListener('click', async () => {
    el.btnGetJoke.textContent = 'Finding joke...';
    try {
      const data = await fetchStudyJoke();
      if (data && data.success) {
        el.jokeResultPreview.classList.remove('hidden');
        el.jokeResultPreview.innerHTML = `
          <div class="joke-setup">😂 ${escapeHtml(data.setup)}</div>
          <div class="joke-punchline">${escapeHtml(data.punchline)}</div>
          <button id="btn-send-joke-chat" class="study-btn-send">
            Send Joke to Chat 💬
          </button>
        `;
        document.getElementById('btn-send-joke-chat')?.addEventListener('click', async () => {
          if (!state.currentChatTarget) {
            showToast('Open a chat first to share this joke!', '💬'); return;
          }
          closeModal(el.modalStudyTools);
          await sendStudyCardMessage({
            type: 'joke',
            setup: data.setup,
            punchline: data.punchline
          });
          showToast('Joke sent! 😂', '✅');
        });
      }
    } catch (err) {
      showToast('Could not fetch joke: ' + err.message, '⚠️');
    } finally {
      el.btnGetJoke.textContent = 'Tell Another Joke';
    }
  });
}

/**
 * 7. Helper: Free Dictionary & Vocabulary API
 */
async function fetchWordDefinition(word) {
  try {
    const directUrl = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
    const res = await fetch(directUrl);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const entry = data[0];
        let phonetic = entry.phonetic || (entry.phonetics && entry.phonetics.find(p => p.text)?.text) || '';
        let partOfSpeech = entry.meanings && entry.meanings[0] ? entry.meanings[0].partOfSpeech : 'noun';
        let definition = entry.meanings && entry.meanings[0] && entry.meanings[0].definitions[0] ? entry.meanings[0].definitions[0].definition : '';
        let example = entry.meanings && entry.meanings[0] && entry.meanings[0].definitions[0] ? entry.meanings[0].definitions[0].example : '';
        return {
          success: true,
          word: entry.word || word,
          phonetic,
          partOfSpeech,
          definition,
          example,
          sourceUrl: entry.sourceUrls ? entry.sourceUrls[0] : `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`
        };
      }
    }
  } catch (_) {}

  // Server proxy fallback
  try {
    const res = await fetch(`/api/study/define?q=${encodeURIComponent(word)}`);
    return await res.json();
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Dictionary UI Submit
async function executeDictSearch() {
  const q = (el.dictSearchInput?.value || '').trim();
  if (!q) {
    showToast('Enter a word or term (e.g. algorithm, recursion)', '⚠️');
    return;
  }
  el.btnSubmitDict.textContent = 'Searching...';
  el.btnSubmitDict.disabled = true;

  try {
    const data = await fetchWordDefinition(q);
    if (data && data.success) {
      el.dictResultPreview.classList.remove('hidden');
      el.dictResultPreview.innerHTML = `
        <div class="study-preview-header">
          <span class="study-preview-title">${escapeHtml(data.word)} <small style="font-weight:normal;opacity:0.7">${escapeHtml(data.phonetic || '')}</small></span>
          <span class="study-preview-badge">${escapeHtml(data.partOfSpeech || 'noun')}</span>
        </div>
        <div class="study-preview-body">
          ${escapeHtml(data.definition || '')}
          ${data.example ? `<div style="margin-top:6px;font-style:italic;opacity:0.85;">"${escapeHtml(data.example)}"</div>` : ''}
        </div>
        <button id="btn-send-dict-chat" class="study-btn-send">
          Send to Chat 💬
        </button>
      `;
      document.getElementById('btn-send-dict-chat')?.addEventListener('click', async () => {
        if (!state.currentChatTarget) {
          showToast('Open a chat first to share this definition!', '💬'); return;
        }
        closeModal(el.modalStudyTools);
        await sendStudyCardMessage({
          type: 'define',
          word: data.word,
          phonetic: data.phonetic,
          partOfSpeech: data.partOfSpeech,
          definition: data.definition,
          example: data.example,
          sourceUrl: data.sourceUrl
        });
        showToast('Dictionary card sent! 📖', '✅');
      });
    } else {
      showToast(data?.error || 'Definition not found.', '⚠️');
    }
  } catch (err) {
    showToast('Dictionary error: ' + err.message, '❌');
  } finally {
    el.btnSubmitDict.textContent = 'Define';
    el.btnSubmitDict.disabled = false;
  }
}

if (el.btnSubmitDict) el.btnSubmitDict.addEventListener('click', executeDictSearch);
if (el.dictSearchInput) {
  el.dictSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      executeDictSearch();
    }
  });
}

/**
 * 8. Helper: Currency Converter API
 */
async function fetchCurrencyConversion(amount, from, to) {
  try {
    const directUrl = `https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`;
    const res = await fetch(directUrl);
    if (res.ok) {
      const data = await res.json();
      if (data && data.rates && data.rates[to]) {
        const rate = data.rates[to];
        return {
          success: true,
          amount: parseFloat(amount),
          from,
          to,
          rate,
          result: parseFloat((amount * rate).toFixed(2))
        };
      }
    }
  } catch (_) {}

  try {
    const res = await fetch(`/api/study/convert?amount=${encodeURIComponent(amount)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    return await res.json();
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Currency UI Submit
if (el.btnSubmitConvert) {
  el.btnSubmitConvert.addEventListener('click', async () => {
    const amt = parseFloat(el.currAmountInput?.value || '100') || 100;
    const from = el.currFromSelect?.value || 'CAD';
    const to = el.currToSelect?.value || 'INR';

    el.btnSubmitConvert.textContent = 'Converting...';
    el.btnSubmitConvert.disabled = true;

    try {
      const data = await fetchCurrencyConversion(amt, from, to);
      if (data && data.success) {
        el.currResultPreview.classList.remove('hidden');
        el.currResultPreview.innerHTML = `
          <div class="study-preview-header">
            <span class="study-preview-title">${escapeHtml(String(data.amount))} ${escapeHtml(data.from)} = ${escapeHtml(String(data.result))} ${escapeHtml(data.to)}</span>
            <span class="study-preview-badge">Live Rate</span>
          </div>
          <div class="study-preview-body">
            1 ${escapeHtml(data.from)} = ${escapeHtml(String(data.rate))} ${escapeHtml(data.to)}
          </div>
          <button id="btn-send-curr-chat" class="study-btn-send">
            Send to Chat 💬
          </button>
        `;
        document.getElementById('btn-send-curr-chat')?.addEventListener('click', async () => {
          if (!state.currentChatTarget) {
            showToast('Open a chat first to share currency rates!', '💬'); return;
          }
          closeModal(el.modalStudyTools);
          await sendStudyCardMessage({
            type: 'convert',
            amount: data.amount,
            from: data.from,
            to: data.to,
            rate: data.rate,
            result: data.result
          });
          showToast('Currency card sent! 💱', '✅');
        });
      }
    } catch (err) {
      showToast('Conversion error: ' + err.message, '❌');
    } finally {
      el.btnSubmitConvert.textContent = 'Convert Live Rates';
      el.btnSubmitConvert.disabled = false;
    }
  });
}

/**
 * 9. Helper: Campus Locations & Meeting Pins
 */
async function fetchCampusLocations() {
  try {
    const res = await fetch('/api/campus/locations');
    const data = await res.json();
    return data.locations || [];
  } catch (_) {
    return [
      { id: 'klo-library', name: 'KLO Campus Library', campus: 'Kelowna Campus', building: 'Building C', details: 'Quiet study tables and group study rooms.', mapUrl: 'https://maps.google.com/?q=49.8631,-119.4837' },
      { id: 'klo-cafeteria', name: 'KLO Student Cafeteria', campus: 'Kelowna Campus', building: 'Student Center (A)', details: 'Central food court and Tim Hortons meetup spot.', mapUrl: 'https://maps.google.com/?q=49.8624,-119.4842' },
      { id: 'klo-cfl', name: 'Centre for Learning Atrium', campus: 'Kelowna Campus', building: 'CFL Building', details: 'Glass atrium and tech support booth.', mapUrl: 'https://maps.google.com/?q=49.8635,-119.4832' }
    ];
  }
}

async function renderCampusPinsList() {
  if (!el.campusPinsList) return;
  const locs = await fetchCampusLocations();
  el.campusPinsList.innerHTML = locs.map((loc, idx) => `
    <div class="campus-pin-card">
      <div class="campus-pin-info">
        <h5>📍 ${escapeHtml(loc.name)}</h5>
        <p>${escapeHtml(loc.building)} • ${escapeHtml(loc.campus)}</p>
      </div>
      <button class="btn-pin-share" data-index="${idx}">Share Pin 💬</button>
    </div>
  `).join('');

  el.campusPinsList.querySelectorAll('.btn-pin-share').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!state.currentChatTarget) {
        showToast('Open a chat first to share a campus meeting pin!', '💬'); return;
      }
      const idx = parseInt(btn.dataset.index, 10);
      const loc = locs[idx];
      closeModal(el.modalStudyTools);
      await sendStudyCardMessage({
        type: 'location',
        name: loc.name,
        campus: loc.campus,
        building: loc.building,
        details: loc.details,
        mapUrl: loc.mapUrl
      });
      showToast(`Shared "${loc.name}" pin in chat! 📍`, '✅');
    });
  });
}

/**
 * 10. Helper: Daily Student Advice (Advice Slip API)
 */
async function fetchStudentAdvice() {
  try {
    const directUrl = 'https://api.adviceslip.com/advice';
    const res = await fetch(directUrl);
    if (res.ok) {
      const data = await res.json();
      if (data && data.slip && data.slip.advice) {
        return { success: true, advice: data.slip.advice, id: data.slip.id };
      }
    }
  } catch (_) {}

  try {
    const res = await fetch('/api/study/advice');
    return await res.json();
  } catch (err) {
    return { success: true, advice: 'Take frequent short breaks while studying to keep your focus sharp.' };
  }
}

if (el.btnGetAdvice) {
  el.btnGetAdvice.addEventListener('click', async () => {
    el.btnGetAdvice.textContent = 'Fetching advice...';
    try {
      const data = await fetchStudentAdvice();
      if (data && data.success) {
        el.adviceResultPreview.classList.remove('hidden');
        el.adviceResultPreview.innerHTML = `
          <div class="joke-setup">💡 Student Tip</div>
          <div class="joke-punchline" style="color:#0369A1;font-style:normal;">"${escapeHtml(data.advice)}"</div>
          <button id="btn-send-advice-chat" class="study-btn-send">
            Send Advice to Chat 💬
          </button>
        `;
        document.getElementById('btn-send-advice-chat')?.addEventListener('click', async () => {
          if (!state.currentChatTarget) {
            showToast('Open a chat first to share this tip!', '💬'); return;
          }
          closeModal(el.modalStudyTools);
          await sendStudyCardMessage({
            type: 'advice',
            advice: data.advice
          });
          showToast('Advice sent! 💡', '✅');
        });
      }
    } catch (err) {
      showToast('Could not fetch advice: ' + err.message, '⚠️');
    } finally {
      el.btnGetAdvice.textContent = 'Get Another Tip';
    }
  });
}

/**
 * Study Tools Tabs Switching
 */
document.querySelectorAll('.study-tab-btn').forEach(tabBtn => {
  tabBtn.addEventListener('click', () => {
    document.querySelectorAll('.study-tab-btn').forEach(b => b.classList.remove('active'));
    tabBtn.classList.add('active');

    const view = tabBtn.dataset.studyView;
    document.querySelectorAll('.study-panel').forEach(p => p.classList.add('hidden'));

    const activePanel = document.getElementById(`study-panel-${view}`);
    if (activePanel) activePanel.classList.remove('hidden');

    if (view === 'places') {
      renderCampusPinsList();
    }
  });
});

/**
 * 11. Classmate QR Code Connect (QR Server API)
 */
function openCampusQrModal() {
  if (!state.currentUser) return;
  const username = state.currentUser.username;
  const displayName = state.currentUser.displayName || username;

  if (el.qrDisplayName) el.qrDisplayName.textContent = displayName;
  if (el.qrHandle) el.qrHandle.textContent = `@${username}`;

  const connectUrl = `${window.location.origin}/#connect=${encodeURIComponent(username)}`;
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(connectUrl)}&color=007AFF&bgcolor=FFFFFF`;

  if (el.myQrImage) {
    el.myQrImage.src = qrApiUrl;
  }

  openModal(el.modalQrCode);
}

if (el.btnMyQr) {
  el.btnMyQr.addEventListener('click', openCampusQrModal);
}

if (el.btnCloseQrModal) {
  el.btnCloseQrModal.addEventListener('click', () => {
    closeModal(el.modalQrCode);
  });
}

if (el.modalQrCode) {
  el.modalQrCode.addEventListener('click', (e) => {
    if (e.target === el.modalQrCode) closeModal(el.modalQrCode);
  });
}

if (el.btnCopyQrLink) {
  el.btnCopyQrLink.addEventListener('click', () => {
    if (!state.currentUser) return;
    const connectUrl = `${window.location.origin}/#connect=${encodeURIComponent(state.currentUser.username)}`;
    navigator.clipboard.writeText(connectUrl).then(() => {
      showToast('Connect link copied to clipboard! 📋', '✅');
    }).catch(() => {
      showToast(connectUrl, '🔗');
    });
  });
}

// Auto-handle QR scan link on load (#connect=username)
window.addEventListener('load', () => {
  const hash = window.location.hash || '';
  if (hash.startsWith('#connect=')) {
    const friendUsername = decodeURIComponent(hash.replace('#connect=', '')).trim().toLowerCase();
    if (friendUsername && state.currentUser && friendUsername !== state.currentUser.username) {
      setTimeout(() => {
        openModal(el.modalAddFriend);
        if (el.addFriendInput) {
          el.addFriendInput.value = `@${friendUsername}`;
          searchClassmates(friendUsername);
        }
      }, 500);
    }
  }
});

// ===========================================================================
// PWA & MOBILE APP INSTALLATION SYSTEM (Android & iOS)
// ===========================================================================

// 1. Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then((reg) => {
        console.log('[PWA] Service Worker registered with scope:', reg.scope);
      })
      .catch((err) => {
        console.log('[PWA] Service Worker registration failed:', err);
      });
  });
}

// 2. Android / Desktop Native Installation Prompt Capture
let deferredPwaPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPwaPrompt = e;
  console.log('[PWA] beforeinstallprompt event captured');

  const androidBtn = document.getElementById('btn-trigger-android-pwa');
  if (androidBtn) {
    androidBtn.style.display = 'block';
  }
});

// Helper: Check if app is already running in standalone mode or installed
function checkIsAppInstalled() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                       window.navigator.standalone === true ||
                       document.referrer.includes('android-app://') ||
                       localStorage.getItem('oc_app_installed') === 'true';
  return isStandalone;
}

function updateInstallUi() {
  const isInstalled = checkIsAppInstalled();
  if (isInstalled) {
    if (el.btnInstallApp) {
      el.btnInstallApp.classList.add('hidden');
    }
    if (el.btnSettingsInstallApp) {
      el.btnSettingsInstallApp.innerHTML = '<span>App Installed on Device ✓</span>';
      el.btnSettingsInstallApp.style.background = 'rgba(52, 199, 89, 0.12)';
      el.btnSettingsInstallApp.style.color = '#34C759';
      el.btnSettingsInstallApp.style.borderColor = 'rgba(52, 199, 89, 0.3)';
      el.btnSettingsInstallApp.onclick = () => {
        showToast('OC Connect is running installed on your device! 📲', '✅');
      };
    }
  } else {
    if (el.btnInstallApp) {
      el.btnInstallApp.classList.remove('hidden');
    }
  }
}

// Check on boot and when display-mode media query changes
window.addEventListener('DOMContentLoaded', updateInstallUi);
setTimeout(updateInstallUi, 500);
try {
  window.matchMedia('(display-mode: standalone)').addEventListener('change', updateInstallUi);
} catch (_) {}

window.addEventListener('appinstalled', () => {
  deferredPwaPrompt = null;
  localStorage.setItem('oc_app_installed', 'true');
  updateInstallUi();
  showToast('OC Connect is now installed on your device! 📲🎉', '✅');
  closeModal(el.modalInstallApp);
});

// 3. Open Install Modal with Device Auto-Detection
function openInstallModal() {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /android/i.test(navigator.userAgent);

  let defaultPlatform = 'desktop';
  if (isIos) defaultPlatform = 'ios';
  else if (isAndroid) defaultPlatform = 'android';

  switchInstallTab(defaultPlatform);
  openModal(el.modalInstallApp);
}

function switchInstallTab(platform) {
  document.querySelectorAll('.install-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.platform === platform);
  });

  document.querySelectorAll('.install-panel').forEach(panel => {
    panel.classList.add('hidden');
  });

  const activePanel = document.getElementById(`install-panel-${platform}`);
  if (activePanel) {
    activePanel.classList.remove('hidden');
  }
}

// Platform Tabs Event Listeners
document.querySelectorAll('.install-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    switchInstallTab(btn.dataset.platform);
  });
});

// 1-Tap Native Android Install Trigger
if (el.btnTriggerAndroidPwa) {
  el.btnTriggerAndroidPwa.addEventListener('click', async () => {
    if (deferredPwaPrompt) {
      deferredPwaPrompt.prompt();
      const { outcome } = await deferredPwaPrompt.userChoice;
      console.log('[PWA] User choice outcome:', outcome);
      if (outcome === 'accepted') {
        showToast('Installing OC Connect...', '📲');
      }
      deferredPwaPrompt = null;
    } else {
      showToast('Tap the 3 dots (⋮) in Chrome and select "Install app" or "Add to Home screen"', 'ℹ️');
    }
  });
}

// Open modal triggers
if (el.btnInstallApp) {
  el.btnInstallApp.addEventListener('click', openInstallModal);
}

if (el.btnSettingsInstallApp) {
  el.btnSettingsInstallApp.addEventListener('click', () => {
    closeModal(el.modalSettings);
    openInstallModal();
  });
}

if (el.btnCloseInstallModal) {
  el.btnCloseInstallModal.addEventListener('click', () => closeModal(el.modalInstallApp));
}

if (el.modalInstallApp) {
  el.modalInstallApp.addEventListener('click', (e) => {
    if (e.target === el.modalInstallApp) closeModal(el.modalInstallApp);
  });
}

if (el.btnCopyInstallLink) {
  el.btnCopyInstallLink.addEventListener('click', () => {
    const installUrl = window.location.origin;
    navigator.clipboard.writeText(installUrl).then(() => {
      showToast('App link copied to clipboard! 📋', '✅');
    }).catch(() => {
      showToast(installUrl, '🔗');
    });
  });
}

// ===========================================================================
// GOOGLE MESSAGES: INBOX CATEGORIES & CONVERSATION PINNING
// ===========================================================================

// 1. Category Chips Selector
if (el.inboxCategoriesBar) {
  el.inboxCategoriesBar.querySelectorAll('.inbox-cat-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      el.inboxCategoriesBar.querySelectorAll('.inbox-cat-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.inboxCategory = chip.dataset.inboxCat || 'all';
      loadRecentChats();
    });
  });
}

// 2. Chats Search Input
if (el.chatsSearchInput) {
  let searchTimer;
  el.chatsSearchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.chatsSearchQuery = el.chatsSearchInput.value.trim().toLowerCase();
      loadRecentChats();
    }, 200);
  });
}

// 3. Pin / Unpin Conversation Toggle
async function togglePinChat(chatKey) {
  if (!state.currentUser || !chatKey) return;
  try {
    const res = await fetch('/api/chats/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: state.currentUser.username,
        chatKey: chatKey
      })
    });
    const data = await res.json();
    if (data.success) {
      if (data.pinned) {
        state.pinnedChatKeys.add(chatKey);
        showToast('Chat pinned to top 📌', '📌');
      } else {
        state.pinnedChatKeys.delete(chatKey);
        showToast('Chat unpinned', 'ℹ️');
      }
      loadRecentChats();
    }
  } catch (err) {
    showToast('Failed to toggle pin: ' + err.message, '❌');
  }
}

// ===========================================================================
// GOOGLE MESSAGES: STARRED MESSAGES SYSTEM
// ===========================================================================

// 1. Toggle Star on a Message
async function toggleStarMessage(messageId, starBtn) {
  if (!state.currentUser || !messageId) return;
  try {
    const res = await fetch('/api/messages/star', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: state.currentUser.username,
        messageId: messageId
      })
    });
    const data = await res.json();
    if (data.success) {
      if (data.starred) {
        state.starredMessageIds.add(messageId);
        if (starBtn) {
          starBtn.classList.add('starred');
          starBtn.textContent = '⭐';
          starBtn.title = 'Unstar message';
        }
        showToast('Message starred ⭐', '⭐');
      } else {
        state.starredMessageIds.delete(messageId);
        if (starBtn) {
          starBtn.classList.remove('starred');
          starBtn.textContent = '☆';
          starBtn.title = 'Star message';
        }
        showToast('Message unstarred', 'ℹ️');
      }
    }
  } catch (err) {
    showToast('Failed to star message: ' + err.message, '❌');
  }
}

// 2. Open Starred Messages Drawer
async function openStarredMessagesModal() {
  if (!state.currentUser) return;
  openModal(el.modalStarredMessages);
  if (el.starredMessagesList) {
    el.starredMessagesList.innerHTML = '<div style="text-align:center;padding:24px;color:#8E8E93;">Loading starred messages...</div>';
  }

  try {
    const res = await fetch(`/api/messages/starred?username=${encodeURIComponent(state.currentUser.username)}`);
    const data = await res.json();
    const messages = data.messages || [];
    renderStarredMessagesList(messages);
  } catch (err) {
    if (el.starredMessagesList) {
      el.starredMessagesList.innerHTML = `<div class="empty-inline-hint">Error loading starred messages: ${escapeHtml(err.message)}</div>`;
    }
  }
}

function renderStarredMessagesList(messages) {
  if (!el.starredMessagesList) return;
  el.starredMessagesList.innerHTML = '';

  if (!messages || messages.length === 0) {
    if (el.noStarredPlaceholder) el.noStarredPlaceholder.classList.remove('hidden');
    return;
  }
  if (el.noStarredPlaceholder) el.noStarredPlaceholder.classList.add('hidden');

  messages.forEach(m => {
    const card = document.createElement('div');
    card.className = 'starred-msg-card';

    let contentText = m.text || '';
    if (m.voice) contentText = '🎤 Voice Note';
    else if (m.file) contentText = `📎 File: ${m.file.name || 'Attachment'}`;
    else if (m.image) contentText = '📷 Photo';
    else if (m.studyCard) contentText = `📚 ${m.studyCard.title || 'Study Card'}`;

    card.innerHTML = `
      <div class="starred-card-top">
        <span class="starred-card-author">${escapeHtml(m.displayName || m.sender)}</span>
        <span class="starred-card-time">${formatTime(m.timestamp)}</span>
      </div>
      <div class="starred-card-body">${escapeHtml(contentText)}</div>
      <div class="starred-card-actions">
        <button type="button" class="btn-unstar-pill" data-msg-id="${m.id}">Unstar</button>
      </div>
    `;

    card.querySelector('.btn-unstar-pill').addEventListener('click', async (e) => {
      e.stopPropagation();
      await toggleStarMessage(m.id);
      card.remove();
      if (el.starredMessagesList.children.length === 0 && el.noStarredPlaceholder) {
        el.noStarredPlaceholder.classList.remove('hidden');
      }
    });

    el.starredMessagesList.appendChild(card);
  });
}

// Starred Modals Triggers
if (el.btnOpenStarredInbox) {
  el.btnOpenStarredInbox.addEventListener('click', openStarredMessagesModal);
}
if (el.btnChatStarred) {
  el.btnChatStarred.addEventListener('click', openStarredMessagesModal);
}
if (el.btnCloseStarredModal) {
  el.btnCloseStarredModal.addEventListener('click', () => closeModal(el.modalStarredMessages));
}
if (el.modalStarredMessages) {
  el.modalStarredMessages.addEventListener('click', (e) => {
    if (e.target === el.modalStarredMessages) closeModal(el.modalStarredMessages);
  });
}
if (el.starredSearchInput) {
  el.starredSearchInput.addEventListener('input', () => {
    const q = el.starredSearchInput.value.trim().toLowerCase();
    document.querySelectorAll('.starred-msg-card').forEach(card => {
      const text = card.textContent.toLowerCase();
      card.style.display = text.includes(q) ? 'block' : 'none';
    });
  });
}

// ===========================================================================
// GOOGLE MESSAGES: MAGIC COMPOSE AI ASSISTANT
// ===========================================================================

function openMagicComposeModal() {
  const currentText = (el.messageTextInput ? el.messageTextInput.value : '').trim();
  if (el.magicComposeInput) {
    el.magicComposeInput.value = currentText;
  }
  openModal(el.modalMagicCompose);
  generateMagicComposeRewrite(state.magicComposeStyle || 'formal');
}

async function generateMagicComposeRewrite(style) {
  const text = el.magicComposeInput ? el.magicComposeInput.value.trim() : '';
  if (!text) {
    if (el.magicComposeOutput) el.magicComposeOutput.textContent = 'Type or paste draft text above to generate AI rewrite options.';
    return;
  }

  state.magicComposeStyle = style;
  if (el.magicComposeOutput) el.magicComposeOutput.textContent = 'Generating AI transformation...';
  if (el.magicOutputBadge) {
    const styleLabels = {
      formal: '🎓 Formal',
      concise: '⚡ Concise',
      excited: '🔥 Excited',
      chill: '🤙 Chill',
      shakespeare: '📜 Shakespeare',
      proofread: '✨ Fix Grammar'
    };
    el.magicOutputBadge.textContent = styleLabels[style] || style;
  }

  try {
    const res = await fetch('/api/ai/magic-compose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, style })
    });
    const data = await res.json();
    if (data.success && el.magicComposeOutput) {
      el.magicComposeOutput.textContent = data.rewritten;
    }
  } catch (err) {
    if (el.magicComposeOutput) {
      el.magicComposeOutput.textContent = 'Error generating rewrite: ' + err.message;
    }
  }
}

// Magic Compose Tone Buttons
document.querySelectorAll('.tone-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tone-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const style = btn.dataset.style;
    generateMagicComposeRewrite(style);
  });
});

if (el.magicComposeInput) {
  let composeDebounce;
  el.magicComposeInput.addEventListener('input', () => {
    clearTimeout(composeDebounce);
    composeDebounce = setTimeout(() => {
      generateMagicComposeRewrite(state.magicComposeStyle || 'formal');
    }, 400);
  });
}

// Insert / Apply rewritten text
if (el.btnApplyMagicCompose) {
  el.btnApplyMagicCompose.addEventListener('click', () => {
    const output = el.magicComposeOutput ? el.magicComposeOutput.textContent.trim() : '';
    if (output && output !== 'Generating AI transformation...' && output !== 'Type or paste draft text above to generate AI rewrite options.') {
      if (el.messageTextInput) el.messageTextInput.value = output;
      closeModal(el.modalMagicCompose);
      showToast('Inserted Magic Compose rewrite ✨', '✨');
      if (el.messageTextInput) el.messageTextInput.focus();
    }
  });
}

// Send rewritten text directly
if (el.btnSendMagicNow) {
  el.btnSendMagicNow.addEventListener('click', () => {
    const output = el.magicComposeOutput ? el.magicComposeOutput.textContent.trim() : '';
    if (output && output !== 'Generating AI transformation...') {
      if (el.messageTextInput) el.messageTextInput.value = output;
      closeModal(el.modalMagicCompose);
      sendMessage();
    }
  });
}

if (el.btnCopyMagicCompose) {
  el.btnCopyMagicCompose.addEventListener('click', () => {
    const output = el.magicComposeOutput ? el.magicComposeOutput.textContent.trim() : '';
    if (output) {
      navigator.clipboard.writeText(output).then(() => {
        showToast('Copied to clipboard! 📋', '✅');
      });
    }
  });
}

if (el.btnMagicCompose) {
  el.btnMagicCompose.addEventListener('click', openMagicComposeModal);
}
if (el.attachOptMagicCompose) {
  el.attachOptMagicCompose.addEventListener('click', () => {
    hideAttachmentSheet();
    openMagicComposeModal();
  });
}
if (el.btnCloseMagicCompose) {
  el.btnCloseMagicCompose.addEventListener('click', () => closeModal(el.modalMagicCompose));
}
if (el.modalMagicCompose) {
  el.modalMagicCompose.addEventListener('click', (e) => {
    if (e.target === el.modalMagicCompose) closeModal(el.modalMagicCompose);
  });
}

// ===========================================================================
// GOOGLE MESSAGES: SCHEDULED SEND (SEND LATER)
// ===========================================================================

function openScheduleModal() {
  const currentText = (el.messageTextInput ? el.messageTextInput.value : '').trim();
  if (!currentText) {
    showToast('Please type a message before scheduling ⏰', '⚠️');
    return;
  }

  if (el.scheduleDraftPreview) {
    el.scheduleDraftPreview.textContent = currentText;
  }

  // Pre-fill custom datetime picker with tomorrow 9:00 AM
  if (el.customScheduleDatetime) {
    const tomorrow = new Date(Date.now() + 86400000);
    tomorrow.setHours(9, 0, 0, 0);
    const isoString = new Date(tomorrow.getTime() - (tomorrow.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
    el.customScheduleDatetime.value = isoString;
  }

  openModal(el.modalScheduleMessage);
}

async function submitScheduledMessage(dueTimestamp) {
  const text = (el.messageTextInput ? el.messageTextInput.value : '').trim();
  if (!text || !state.currentUser) return;

  try {
    const payload = {
      sender: state.currentUser.username,
      recipient: state.isGroup ? null : (state.isChannel ? null : state.currentChatTarget),
      groupId: state.isGroup ? state.currentGroupId : null,
      channel: state.isChannel ? state.currentChatTarget : null,
      text: text,
      scheduledFor: dueTimestamp
    };

    const res = await fetch('/api/messages/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.success) {
      if (el.messageTextInput) el.messageTextInput.value = '';
      closeModal(el.modalScheduleMessage);
      showToast(`⏰ Message scheduled for ${new Date(dueTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, '⏰');
      loadChatScheduledMessages();
    } else {
      showToast(data.error || 'Failed to schedule message', '❌');
    }
  } catch (err) {
    showToast('Error scheduling message: ' + err.message, '❌');
  }
}

// Presets
if (el.presetLaterToday) {
  el.presetLaterToday.addEventListener('click', () => {
    const target = new Date();
    target.setHours(18, 0, 0, 0);
    if (target.getTime() <= Date.now()) {
      target.setTime(Date.now() + 3600000 * 2); // 2 hours from now
    }
    submitScheduledMessage(target.getTime());
  });
}

if (el.presetTomorrowMorning) {
  el.presetTomorrowMorning.addEventListener('click', () => {
    const target = new Date(Date.now() + 86400000);
    target.setHours(8, 0, 0, 0);
    submitScheduledMessage(target.getTime());
  });
}

if (el.presetTomorrowAfternoon) {
  el.presetTomorrowAfternoon.addEventListener('click', () => {
    const target = new Date(Date.now() + 86400000);
    target.setHours(13, 0, 0, 0);
    submitScheduledMessage(target.getTime());
  });
}

if (el.btnSubmitCustomSchedule) {
  el.btnSubmitCustomSchedule.addEventListener('click', () => {
    if (!el.customScheduleDatetime || !el.customScheduleDatetime.value) {
      showToast('Please select a date and time', '⚠️');
      return;
    }
    const chosenTime = new Date(el.customScheduleDatetime.value).getTime();
    if (chosenTime <= Date.now()) {
      showToast('Scheduled time must be in the future', '⚠️');
      return;
    }
    submitScheduledMessage(chosenTime);
  });
}

// Long-Press on Send Button to trigger Scheduled Send
let sendButtonPressTimer;
if (el.btnSendMessage) {
  el.btnSendMessage.addEventListener('mousedown', () => {
    sendButtonPressTimer = setTimeout(() => {
      openScheduleModal();
    }, 600);
  });

  el.btnSendMessage.addEventListener('touchstart', () => {
    sendButtonPressTimer = setTimeout(() => {
      openScheduleModal();
    }, 600);
  }, { passive: true });

  el.btnSendMessage.addEventListener('mouseup', () => clearTimeout(sendButtonPressTimer));
  el.btnSendMessage.addEventListener('mouseleave', () => clearTimeout(sendButtonPressTimer));
  el.btnSendMessage.addEventListener('touchend', () => clearTimeout(sendButtonPressTimer));
}

if (el.attachOptSchedule) {
  el.attachOptSchedule.addEventListener('click', () => {
    hideAttachmentSheet();
    openScheduleModal();
  });
}

if (el.btnCloseScheduleModal) {
  el.btnCloseScheduleModal.addEventListener('click', () => closeModal(el.modalScheduleMessage));
}
if (el.modalScheduleMessage) {
  el.modalScheduleMessage.addEventListener('click', (e) => {
    if (e.target === el.modalScheduleMessage) closeModal(el.modalScheduleMessage);
  });
}

// Load Pending Scheduled Messages for Current Chat
async function loadChatScheduledMessages() {
  if (!state.currentUser || !state.currentChatTarget) {
    if (el.scheduledMessagesBanner) el.scheduledMessagesBanner.classList.add('hidden');
    return;
  }

  try {
    const params = new URLSearchParams({
      sender: state.currentUser.username
    });
    if (state.isGroup) params.append('groupId', state.currentGroupId);
    else if (state.isChannel) params.append('channel', state.currentChatTarget);
    else params.append('recipient', state.currentChatTarget);

    const res = await fetch(`/api/messages/scheduled?${params.toString()}`);
    const data = await res.json();
    const list = data.scheduled || [];
    state.scheduledMessages = list;

    if (list.length > 0) {
      if (el.scheduledMessagesBanner) el.scheduledMessagesBanner.classList.remove('hidden');
      if (el.scheduledBannerText) {
        el.scheduledBannerText.textContent = `${list.length} scheduled message${list.length > 1 ? 's' : ''}`;
      }
    } else {
      if (el.scheduledMessagesBanner) el.scheduledMessagesBanner.classList.add('hidden');
    }
  } catch (_) {}
}

if (el.btnViewScheduledMessages) {
  el.btnViewScheduledMessages.addEventListener('click', () => {
    openModal(el.modalViewScheduled);
    if (!el.viewScheduledList) return;
    el.viewScheduledList.innerHTML = '';

    if (state.scheduledMessages.length === 0) {
      el.viewScheduledList.innerHTML = '<div class="empty-inline-hint">No pending scheduled messages for this chat.</div>';
      return;
    }

    state.scheduledMessages.forEach(s => {
      const item = document.createElement('div');
      item.className = 'starred-msg-card';
      item.innerHTML = `
        <div class="starred-card-top">
          <span style="font-size:12px;color:#FF9500;font-weight:600">⏰ Scheduled for ${new Date(s.scheduledFor).toLocaleString()}</span>
        </div>
        <div class="starred-card-body">${escapeHtml(s.text || 'Attachment')}</div>
        <div class="starred-card-actions">
          <button type="button" class="btn-unstar-pill" data-sched-id="${s.id}">Cancel & Delete</button>
        </div>
      `;

      item.querySelector('.btn-unstar-pill').addEventListener('click', async () => {
        try {
          await fetch('/api/messages/scheduled/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sender: state.currentUser.username, id: s.id })
          });
          showToast('Scheduled message cancelled', '🗑️');
          item.remove();
          loadChatScheduledMessages();
          if (el.viewScheduledList.children.length === 0) {
            closeModal(el.modalViewScheduled);
          }
        } catch (_) {}
      });

      el.viewScheduledList.appendChild(item);
    });
  });
}

if (el.btnCloseViewScheduled) {
  el.btnCloseViewScheduled.addEventListener('click', () => closeModal(el.modalViewScheduled));
}
if (el.modalViewScheduled) {
  el.modalViewScheduled.addEventListener('click', (e) => {
    if (e.target === el.modalViewScheduled) closeModal(el.modalViewScheduled);
  });
}

// ===========================================================================
// GOOGLE MESSAGES: AI SMART REPLIES ENGINE
// ===========================================================================

async function fetchSmartReplies(lastMessageText) {
  if (!lastMessageText || !el.smartRepliesBar || !el.smartRepliesChips) return;
  try {
    const res = await fetch('/api/ai/smart-replies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: lastMessageText,
        sender: state.currentChatTarget,
        isGroup: state.isGroup
      })
    });
    const data = await res.json();
    if (data.success && Array.isArray(data.suggestions) && data.suggestions.length > 0) {
      renderSmartReplies(data.suggestions);
    }
  } catch (_) {}
}

function renderSmartReplies(suggestions) {
  if (!el.smartRepliesBar || !el.smartRepliesChips) return;
  el.smartRepliesChips.innerHTML = '';

  suggestions.forEach(text => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'smart-reply-chip';
    chip.textContent = text;

    chip.addEventListener('click', () => {
      if (el.messageTextInput) {
        el.messageTextInput.value = text;
        sendMessage();
        el.smartRepliesBar.classList.add('hidden');
      }
    });

    el.smartRepliesChips.appendChild(chip);
  });

  el.smartRepliesBar.classList.remove('hidden');
}

// ===========================================================================
// GOOGLE MESSAGES: RCS-STYLE REAL-TIME TYPING STATUS & BUBBLE
// ===========================================================================

let rcsTypingBubbleEl = null;

function showRcsTypingBubble(senderName) {
  if (!el.messagesContainer) return;
  if (!rcsTypingBubbleEl) {
    rcsTypingBubbleEl = document.createElement('div');
    rcsTypingBubbleEl.className = 'typing-bubble-wrapper';
    rcsTypingBubbleEl.innerHTML = `
      <div class="typing-bubble">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </div>
    `;
  }
  if (!rcsTypingBubbleEl.parentElement) {
    el.messagesContainer.appendChild(rcsTypingBubbleEl);
    scrollToBottom();
  }
}

function hideRcsTypingBubble() {
  if (rcsTypingBubbleEl && rcsTypingBubbleEl.parentElement) {
    rcsTypingBubbleEl.remove();
  }
}

// Broadcast typing to backend
async function sendTypingStatus(isTyping) {
  if (!state.currentUser || !state.currentChatTarget) return;
  try {
    await fetch('/api/messages/typing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: state.currentUser.username,
        recipient: state.isGroup ? null : (state.isChannel ? null : state.currentChatTarget),
        groupId: state.isGroup ? state.currentGroupId : null,
        channel: state.isChannel ? state.currentChatTarget : null,
        isTyping: isTyping
      })
    });
  } catch (_) {}
}

// Typing listener on textarea
if (el.messageTextInput) {
  let typingDebounceTimer;
  el.messageTextInput.addEventListener('input', () => {
    if (!state.isTypingActive) {
      state.isTypingActive = true;
      sendTypingStatus(true);
    }
    clearTimeout(typingDebounceTimer);
    typingDebounceTimer = setTimeout(() => {
      state.isTypingActive = false;
      sendTypingStatus(false);
    }, 2500);
  });
}

// SSE typing listener expansion
if (state.eventSource) {
  state.eventSource.addEventListener('user_typing', (e) => {
    try {
      const data = JSON.parse(e.data);
      const from = (data.from || '').toLowerCase();
      const cleanTarget = (state.currentChatTarget || '').toLowerCase();

      const isCurrentConversation = (
        (state.isGroup && data.groupId === state.currentGroupId) ||
        (state.isChannel && data.channel === cleanTarget) ||
        (!state.isGroup && !state.isChannel && from === cleanTarget)
      );

      if (isCurrentConversation) {
        if (data.isTyping) {
          showRcsTypingBubble(data.from);
          if (el.chatPartnerSubtitle) {
            el.chatPartnerSubtitle.textContent = `${data.from} is typing...`;
            el.chatPartnerSubtitle.style.color = '#34C759';
          }
        } else {
          hideRcsTypingBubble();
          if (el.chatPartnerSubtitle) {
            updateGroupChatHeaderSubtitle ? updateGroupChatHeaderSubtitle(state.currentGroupId) : (el.chatPartnerSubtitle.textContent = 'online');
            el.chatPartnerSubtitle.style.color = '';
          }
        }
      }
    } catch (_) {}
  });

  state.eventSource.addEventListener('scheduled_message_sent', () => {
    loadChatScheduledMessages();
    loadRecentChats();
  });
}

// Online / Offline Connectivity Event Listeners
window.addEventListener('online', () => {
  if (el.offlineChatBanner) el.offlineChatBanner.classList.add('hidden');
  showToast('Back online • Synced', '🟢');
  if (state.currentChatTarget) fetchAndRenderChatMessages(false);
  loadRecentChats();
});

window.addEventListener('offline', () => {
  if (el.offlineChatBanner && !el.chatScreen.classList.contains('hidden')) {
    el.offlineChatBanner.classList.remove('hidden');
  }
  showToast('Offline Mode • Saved chats available', '📡');
});

// ===========================================================================
// RICH LINK PREVIEW FETCHER & OPENGRAPH RENDERING
// ===========================================================================
const linkPreviewCache = new Map();

async function fetchLinkPreview(url, slotEl) {
  if (!url || !slotEl) return;
  if (linkPreviewCache.has(url)) {
    renderLinkCard(linkPreviewCache.get(url), slotEl, url);
    return;
  }
  try {
    const res = await fetch(`/api/utils/link-preview?url=${encodeURIComponent(url)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.success && data.title) {
      linkPreviewCache.set(url, data);
      renderLinkCard(data, slotEl, url);
    }
  } catch (_) {}
}

function renderLinkCard(data, slotEl, targetUrl) {
  if (!slotEl || !data) return;
  const href = data.url || targetUrl;
  const imgHtml = data.image ? `<img src="${escapeHtml(data.image)}" class="rich-link-img" alt="Link Preview" loading="lazy" />` : '';
  const descHtml = data.description ? `<div class="rich-link-desc">${escapeHtml(data.description)}</div>` : '';
  slotEl.innerHTML = `
    <a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="rich-link-card">
      ${imgHtml}
      <div class="rich-link-meta">
        <div class="rich-link-domain">${escapeHtml(data.domain || '')}</div>
        <div class="rich-link-title">${escapeHtml(data.title || '')}</div>
        ${descHtml}
      </div>
    </a>
  `;
}

// ===========================================================================
// PINNED MESSAGES CONTROLLER
// ===========================================================================
async function loadPinnedMessages() {
  if (!el.pinnedMessagesBanner || !state.currentChatTarget) return;
  try {
    const isChan = Boolean(state.isChannel);
    const target = state.currentChatTarget;
    const me = state.currentUser ? state.currentUser.username : '';
    const res = await fetch(`/api/messages/pinned?target=${encodeURIComponent(target)}&me=${encodeURIComponent(me)}&isChannel=${isChan ? 'true' : 'false'}`);
    const data = await res.json();
    if (data && data.success && Array.isArray(data.pinned) && data.pinned.length > 0) {
      state.pinnedMessages = data.pinned;
      const latest = data.pinned[0];
      el.pinnedMessagesBanner.classList.remove('hidden');
      el.pinnedBannerSender.textContent = latest.displayName || `@${latest.sender}`;
      const snippet = latest.text || (latest.file ? `📎 ${latest.file.name}` : (latest.voice ? '🎤 Voice note' : 'Shared media'));
      el.pinnedBannerText.textContent = snippet.length > 60 ? snippet.substring(0, 60) + '…' : snippet;
      el.pinnedMessagesBanner.dataset.msgId = latest.id;
    } else {
      state.pinnedMessages = [];
      el.pinnedMessagesBanner.classList.add('hidden');
    }
  } catch (_) {
    if (el.pinnedMessagesBanner) el.pinnedMessagesBanner.classList.add('hidden');
  }
}

async function togglePinMessage(messageId, isPinned) {
  if (!messageId || !state.currentChatTarget) return;
  try {
    const res = await fetch('/api/messages/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messageId: messageId,
        isPinned: isPinned,
        target: state.currentChatTarget,
        isChannel: Boolean(state.isChannel)
      })
    });
    const data = await res.json();
    if (data && data.success) {
      showToast(isPinned ? 'Message pinned to top 📌' : 'Message unpinned', '📌');
      triggerHapticFeedback([18]);
      loadPinnedMessages();
    } else {
      showToast('Could not update pinned message', '⚠️');
    }
  } catch (_) {
    showToast('Network error while pinning', '⚠️');
  }
}

if (el.pinnedMessagesBanner) {
  el.pinnedMessagesBanner.addEventListener('click', (e) => {
    if (e.target.closest('#btn-unpin-current-msg')) return;
    const targetId = el.pinnedMessagesBanner.dataset.msgId;
    if (targetId) {
      const bubble = document.querySelector(`.message-bubble[data-msg-id="${targetId}"]`);
      if (bubble) {
        bubble.scrollIntoView({ behavior: 'smooth', block: 'center' });
        bubble.classList.remove('flash-highlight');
        void bubble.offsetWidth;
        bubble.classList.add('flash-highlight');
        triggerHapticFeedback([12]);
      } else {
        showToast('Pinned message earlier in conversation history', '📜');
      }
    }
  });
}

if (el.btnUnpinCurrentMsg) {
  el.btnUnpinCurrentMsg.addEventListener('click', async (e) => {
    e.stopPropagation();
    const targetId = el.pinnedMessagesBanner.dataset.msgId;
    if (targetId) {
      await togglePinMessage(targetId, false);
    }
  });
}

// SSE listener for pinned updates
if (state.eventSource) {
  state.eventSource.addEventListener('message_pinned_updated', (e) => {
    try {
      const data = JSON.parse(e.data);
      const curTarget = (state.currentChatTarget || '').toLowerCase();
      if ((data.target || '').toLowerCase() === curTarget) {
        loadPinnedMessages();
      }
    } catch (_) {}
  });
}

// ===========================================================================
// IN-CHAT MESSAGE SEARCH CONTROLLER
// ===========================================================================
let chatSearchMatches = [];
let chatSearchIndex = 0;

function clearChatSearchHighlights() {
  document.querySelectorAll('.search-highlight-current').forEach(el => el.classList.remove('search-highlight-current'));
  chatSearchMatches = [];
  chatSearchIndex = 0;
  if (el.chatSearchCount) el.chatSearchCount.textContent = '0 found';
}

function performInChatSearch() {
  clearChatSearchHighlights();
  const query = (el.inChatSearchInput ? el.inChatSearchInput.value : '').trim().toLowerCase();
  if (!query) return;

  const bubbles = Array.from(el.messagesContainer.querySelectorAll('.message-bubble'));
  chatSearchMatches = bubbles.filter(b => {
    const textEl = b.querySelector('.message-text');
    const text = textEl ? textEl.textContent.toLowerCase() : b.textContent.toLowerCase();
    return text.includes(query);
  });

  if (chatSearchMatches.length > 0) {
    chatSearchIndex = 0;
    updateSearchMatchDisplay();
  } else {
    if (el.chatSearchCount) el.chatSearchCount.textContent = '0 matches';
  }
}

function updateSearchMatchDisplay() {
  if (chatSearchMatches.length === 0) {
    if (el.chatSearchCount) el.chatSearchCount.textContent = '0 matches';
    return;
  }
  if (el.chatSearchCount) {
    el.chatSearchCount.textContent = `${chatSearchIndex + 1} of ${chatSearchMatches.length}`;
  }
  document.querySelectorAll('.search-highlight-current').forEach(b => b.classList.remove('search-highlight-current'));
  const currentBubble = chatSearchMatches[chatSearchIndex];
  if (currentBubble) {
    currentBubble.classList.add('search-highlight-current');
    currentBubble.scrollIntoView({ behavior: 'smooth', block: 'center' });
    triggerHapticFeedback([10]);
  }
}

if (el.btnToggleChatSearch) {
  el.btnToggleChatSearch.addEventListener('click', () => {
    if (!el.inChatSearchBar) return;
    const isHidden = el.inChatSearchBar.classList.toggle('hidden');
    if (!isHidden) {
      if (el.inChatSearchInput) {
        el.inChatSearchInput.value = '';
        el.inChatSearchInput.focus();
      }
      clearChatSearchHighlights();
    } else {
      clearChatSearchHighlights();
    }
  });
}

if (el.btnCloseChatSearch) {
  el.btnCloseChatSearch.addEventListener('click', () => {
    if (el.inChatSearchBar) el.inChatSearchBar.classList.add('hidden');
    clearChatSearchHighlights();
  });
}

if (el.inChatSearchInput) {
  el.inChatSearchInput.addEventListener('input', () => {
    performInChatSearch();
  });
  el.inChatSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        navigateChatSearch(-1);
      } else {
        navigateChatSearch(1);
      }
    } else if (e.key === 'Escape') {
      if (el.inChatSearchBar) el.inChatSearchBar.classList.add('hidden');
      clearChatSearchHighlights();
    }
  });
}

function navigateChatSearch(dir) {
  if (chatSearchMatches.length === 0) return;
  chatSearchIndex = (chatSearchIndex + dir + chatSearchMatches.length) % chatSearchMatches.length;
  updateSearchMatchDisplay();
}

if (el.btnChatSearchPrev) {
  el.btnChatSearchPrev.addEventListener('click', () => navigateChatSearch(-1));
}

if (el.btnChatSearchNext) {
  el.btnChatSearchNext.addEventListener('click', () => navigateChatSearch(1));
}

// ===========================================================================
// SHARED MEDIA & ATTACHMENTS GALLERY HUB
// ===========================================================================
let currentMediaCache = { photos: [], docs: [], voice: [] };

async function openChatMediaHub() {
  if (!el.modalChatMediaHub || !state.currentChatTarget) return;
  el.modalChatMediaHub.classList.remove('hidden');

  const photosGrid = document.getElementById('media-grid-photos');
  const docsList = document.getElementById('media-list-docs');
  const voiceList = document.getElementById('media-list-voice');
  const countPhotos = document.getElementById('media-count-photos');
  const countDocs = document.getElementById('media-count-docs');
  const countVoice = document.getElementById('media-count-voice');

  if (photosGrid) photosGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-secondary);">Loading photos...</div>';
  if (docsList) docsList.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Loading files...</div>';
  if (voiceList) voiceList.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Loading recordings...</div>';

  try {
    const isChan = Boolean(state.isChannel);
    const target = state.currentChatTarget;
    const me = state.currentUser ? state.currentUser.username : '';
    const res = await fetch(`/api/messages/media?target=${encodeURIComponent(target)}&me=${encodeURIComponent(me)}&isChannel=${isChan ? 'true' : 'false'}`);
    const data = await res.json();
    if (data && data.success) {
      currentMediaCache = data.media || { photos: [], docs: [], voice: [] };
    } else {
      currentMediaCache = { photos: [], docs: [], voice: [] };
    }
  } catch (_) {
    currentMediaCache = { photos: [], docs: [], voice: [] };
  }

  const { photos, docs, voice } = currentMediaCache;
  if (countPhotos) countPhotos.textContent = photos.length;
  if (countDocs) countDocs.textContent = docs.length;
  if (countVoice) countVoice.textContent = voice.length;

  renderMediaHubTab(state.sharedMediaFilter || 'photos');
}

function renderMediaHubTab(tabName) {
  state.sharedMediaFilter = tabName;
  document.querySelectorAll('.media-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mediaFilter === tabName);
  });

  const photosGrid = document.getElementById('media-grid-photos');
  const docsList = document.getElementById('media-list-docs');
  const voiceList = document.getElementById('media-list-voice');

  if (photosGrid) photosGrid.classList.toggle('hidden', tabName !== 'photos');
  if (docsList) docsList.classList.toggle('hidden', tabName !== 'docs');
  if (voiceList) voiceList.classList.toggle('hidden', tabName !== 'voice');

  const { photos, docs, voice } = currentMediaCache;

  if (tabName === 'photos' && photosGrid) {
    if (photos.length === 0) {
      photosGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:36px;color:var(--text-secondary);">No photos shared yet 🖼️</div>';
    } else {
      photosGrid.innerHTML = photos.map(p => `
        <div class="media-photo-item" style="cursor:pointer;position:relative;border-radius:10px;overflow:hidden;aspect-ratio:1;background:rgba(0,0,0,0.05);" data-src="${escapeHtml(p.src)}">
          <img src="${escapeHtml(p.src)}" alt="Shared Photo" loading="lazy" style="width:100%;height:100%;object-fit:cover;" />
        </div>
      `).join('');
      photosGrid.querySelectorAll('.media-photo-item').forEach(item => {
        item.addEventListener('click', () => openLightbox(item.dataset.src));
      });
    }
  } else if (tabName === 'docs' && docsList) {
    if (docs.length === 0) {
      docsList.innerHTML = '<div style="text-align:center;padding:36px;color:var(--text-secondary);">No documents shared yet 📄</div>';
    } else {
      docsList.innerHTML = docs.map(d => `
        <div class="media-list-item" style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:10px;background:rgba(0,0,0,0.03);margin-bottom:8px;">
          <span style="font-size:24px;">${getFileIcon(d.name)}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:13.5px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(d.name)}</div>
            <div style="font-size:11.5px;color:var(--text-secondary);">${formatBytes(d.size)} • ${formatTime(d.timestamp)}</div>
          </div>
          <button type="button" class="btn-direct-download btn-secondary" data-file-data="${escapeHtml(d.data || '')}" data-file-name="${escapeHtml(d.name)}" style="padding:6px 10px;font-size:12px;border-radius:8px;">Open</button>
        </div>
      `).join('');
      docsList.querySelectorAll('.btn-direct-download').forEach(btn => {
        btn.addEventListener('click', () => {
          openOrDownloadAttachment({ name: btn.dataset.fileName, data: btn.dataset.fileData }, null, false);
        });
      });
    }
  } else if (tabName === 'voice' && voiceList) {
    if (voice.length === 0) {
      voiceList.innerHTML = '<div style="text-align:center;padding:36px;color:var(--text-secondary);">No voice notes in this chat 🎙️</div>';
    } else {
      voiceList.innerHTML = voice.map((v, i) => `
        <div class="media-list-item" style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:10px;background:rgba(0,0,0,0.03);margin-bottom:8px;">
          <button type="button" class="btn-play-voice-hub" data-idx="${i}" style="width:36px;height:36px;border-radius:50%;background:#007AFF;color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;">▶</button>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:13.5px;color:var(--text-primary);">${formatAudioDuration(v.duration || 0)} Voice Note</div>
            <div style="font-size:11.5px;color:var(--text-secondary);">From @${escapeHtml(v.sender)} • ${formatTime(v.timestamp)}</div>
          </div>
          <audio src="${v.data}" preload="metadata" class="hidden"></audio>
        </div>
      `).join('');
      voiceList.querySelectorAll('.media-list-item').forEach(row => {
        const pBtn = row.querySelector('.btn-play-voice-hub');
        const aEl = row.querySelector('audio');
        if (pBtn && aEl) {
          pBtn.addEventListener('click', () => {
            if (aEl.paused) {
              if (state.currentlyPlayingAudio && state.currentlyPlayingAudio !== aEl) {
                state.currentlyPlayingAudio.pause();
                document.querySelectorAll('.btn-play-voice-hub').forEach(b => b.textContent = '▶');
              }
              aEl.play().then(() => {
                pBtn.textContent = '⏸';
                state.currentlyPlayingAudio = aEl;
              }).catch(() => {});
            } else {
              aEl.pause();
              pBtn.textContent = '▶';
            }
          });
          aEl.addEventListener('ended', () => {
            pBtn.textContent = '▶';
            state.currentlyPlayingAudio = null;
          });
        }
      });
    }
  }
}

if (el.btnChatMediaHub) {
  el.btnChatMediaHub.addEventListener('click', openChatMediaHub);
}

if (el.btnCloseMediaHub) {
  el.btnCloseMediaHub.addEventListener('click', () => {
    if (el.modalChatMediaHub) el.modalChatMediaHub.classList.add('hidden');
    if (state.currentlyPlayingAudio) {
      state.currentlyPlayingAudio.pause();
      state.currentlyPlayingAudio = null;
    }
  });
}

document.querySelectorAll('.media-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const filter = btn.dataset.mediaFilter;
    if (filter) renderMediaHubTab(filter);
  });
});

