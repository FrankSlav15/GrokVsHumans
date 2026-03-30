// assets/js/common.js - Firebase re-enabled for live voting + FINAL ROBUST DEEP LINK

const firebaseConfig = {
  apiKey: "AIzaSyB00xfM91Dc1oqy37uFt34M_0VcL0xA8sE",
  authDomain: "grokvshumans.firebaseapp.com",
  databaseURL: "https://grokvshumans-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "grokvshumans",
  storageBucket: "grokvshumans.firebasestorage.app",
  messagingSenderId: "483683492125",
  appId: "1:483683492125:web:37d5dad0e8e8471b0b81f4"
};

let database = null;
try {
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  database = firebase.database();
} catch (e) {
  console.warn("Firebase init failed (normal on some pages)", e);
}

// ====================== LIVE VOTING HELPERS ======================
window.vote = async function(e, side, id) {
  e.stopImmediatePropagation();
  e.preventDefault();
  if (!database || !window.allBattles || !window.allBattles[id]) return;

  const ref = database.ref(`content/battles/${id}`);
  const snapshot = await ref.once('value');
  const current = snapshot.val() || { grokVotes: 0, humanVotes: 0 };

  if (side === 'grok') current.grokVotes = (current.grokVotes || 0) + 1;
  else current.humanVotes = (current.humanVotes || 0) + 1;

  await ref.update(current);
  showToast(side === 'grok' ? 'Grok Won!' : 'Human Won!');
  updateGridVoteUI(id);
};

window.updateGridVoteUI = function(id) {
  const grokBtn = document.getElementById(`grok-btn-${id}`);
  const humanBtn = document.getElementById(`human-btn-${id}`);
  if (!grokBtn || !humanBtn || !window.allBattles[id]) return;

  const grokVotes = window.allBattles[id].grokVotes || 0;
  const humanVotes = window.allBattles[id].humanVotes || 0;
  const total = grokVotes + humanVotes;

  if (total === 0) return;

  const grokPct = Math.round((grokVotes / total) * 100);
  const humanPct = 100 - grokPct;

  grokBtn.innerHTML = `Grok Won <span class="vote-tally">${grokPct}%</span>`;
  humanBtn.innerHTML = `Human Won <span class="vote-tally">${humanPct}%</span>`;
};

// ====================== USERS + BACKGROUND ======================
let allUsers = null;
async function loadUsers() {
  if (allUsers) return allUsers;
  try {
    const res = await fetch('/data/users.json');
    allUsers = await res.json();
  } catch (e) {
    allUsers = {};
  }
  return allUsers;
}

const bgs = [
  'assets/images/backgrounds/bg1.webp','assets/images/backgrounds/bg2.webp',
  'assets/images/backgrounds/bg3.webp','assets/images/backgrounds/bg4.webp',
  'assets/images/backgrounds/bg5.webp','assets/images/backgrounds/bg6.webp',
  'assets/images/backgrounds/bg7.webp','assets/images/backgrounds/bg8.webp',
  'assets/images/backgrounds/bg9.webp','assets/images/backgrounds/bg10.webp',
  'assets/images/backgrounds/bg11.webp','assets/images/backgrounds/bg12.webp',
  'assets/images/backgrounds/bg13.webp','assets/images/backgrounds/bg14.webp',
  'assets/images/backgrounds/bg15.webp','assets/images/backgrounds/bg16.webp',
  'assets/images/backgrounds/bg17.webp','assets/images/backgrounds/bg18.webp',
  'assets/images/backgrounds/bg19.webp','assets/images/backgrounds/bg20.webp'
];

function setRandomBackground() {
  const randomBg = bgs[Math.floor(Math.random() * bgs.length)];
  document.body.style.backgroundImage = `url('/${randomBg}')`;
  document.body.style.backgroundPosition = '50% 35%';
  document.body.style.backgroundSize = 'cover';
  document.body.style.backgroundRepeat = 'no-repeat';
  document.body.style.backgroundAttachment = 'fixed';
}

// ====================== LAYOUT (partials) ======================
async function loadLayout() {
  try {
    const headerRes = await fetch('assets/partials/header.html');
    const headerHTML = await headerRes.text();
    document.body.insertAdjacentHTML('afterbegin', headerHTML);

    const footerRes = await fetch('assets/partials/footer.html');
    const footerHTML = await footerRes.text();
    document.body.insertAdjacentHTML('beforeend', footerHTML);

    highlightActiveNav();
    console.log('✅ Header + Footer loaded');
  } catch (e) {
    console.error('Layout load failed:', e);
  }
}

function highlightActiveNav() {
  const navLinks = document.querySelectorAll('.nav-link');
  if (navLinks.length === 0) return;
  const currentPage = document.body.getAttribute('data-page') || '';
  navLinks.forEach(link => {
    link.classList.remove('active');
    const href = link.getAttribute('href').replace('.html', '').toLowerCase();
    if (href === currentPage.toLowerCase()) link.classList.add('active');
  });
}

// ====================== TOAST ======================
window.showToast = function(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  const text = document.getElementById('toast-text');
  text.textContent = message;
  toast.classList.remove('hidden');
  toast.style.transform = 'translate(-50%, 0)';
  setTimeout(() => {
    toast.style.transform = 'translate(-50%, 80px)';
    setTimeout(() => toast.classList.add('hidden'), 400);
  }, 2800);
};

// ====================== INIT PAGE ======================
window.initPage = async function(pageType) {
  await loadUsers();

  if (pageType === 'memes') {
    const res = await fetch('/data/memes.json');
    window.allMemes = await res.json();
    if (typeof renderMemeGrid === 'function') renderMemeGrid();
  } 
  else if (pageType === 'battles') {
    const res = await fetch('/data/battles.json');
    window.allBattles = await res.json();
    if (typeof renderBattleGrid === 'function') renderBattleGrid();
  } 
  else if (pageType === 'categories') {
    const res = await fetch('/data/categories.json');
    window.allCategories = await res.json();
    if (typeof renderCategoryGrid === 'function') renderCategoryGrid();
  }

  // 🔥 Deep link check AFTER data is loaded
  console.log('🚀 initPage complete for', pageType, '— checking deep link...');
  setTimeout(window.checkDeepLink, 200);
};

// ====================== DEEP LINK (ROBUST RETRY VERSION) ======================
window.checkDeepLink = function(attempt = 0) {
  const hash = window.location.hash.replace('#', '').trim();
  console.log(`🔍 checkDeepLink attempt ${attempt} — hash =`, hash);

  if (!hash || isNaN(hash)) {
    console.log('❌ No valid #ID in URL');
    return;
  }

  const id = parseInt(hash);
  console.log('📌 Parsed ID =', id);

  // Safety check: modal functions must exist
  if (typeof openMemeModal !== 'function' || typeof openBattleModal !== 'function' || typeof openCategoryModal !== 'function') {
    if (attempt < 8) {
      console.log('⏳ Modal functions not ready yet — retrying in 80ms');
      setTimeout(() => window.checkDeepLink(attempt + 1), 80);
      return;
    }
    console.log('❌ Gave up after 8 attempts');
    return;
  }

  if (window.allMemes && window.allMemes[id]) {
    console.log('✅ Opening MEME modal #', id);
    openMemeModal(id);
  } else if (window.allBattles && window.allBattles[id]) {
    console.log('✅ Opening BATTLE modal #', id);
    openBattleModal(id);
  } else if (window.allCategories && window.allCategories[id]) {
    console.log('✅ Opening CATEGORY modal #', id);
    openCategoryModal(id);
  } else {
    console.log('❌ No data found for ID', id);
  }
};

// ====================== DOM CONTENT LOADED ======================
document.addEventListener('DOMContentLoaded', () => {
  setRandomBackground();
  loadLayout();
});

// End of common.js