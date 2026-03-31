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

function getUserData(username) {
  if (!username || !allUsers) return {};
  const clean = username.replace('@', '').trim();
  return allUsers[clean] || {};
}

function getLocalAvatar(post) {
  let username = post.username || post.user || post.avatar || post.author || '';
  if (!username) return '/assets/images/users/@unknown.webp';
  const clean = username.replace('@', '').trim();
  return `/assets/images/users/@${clean}.webp`;
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

window.checkDeepLink = function() {
  const hash = window.location.hash.replace('#', '').trim();
  if (!hash || isNaN(hash)) return;
  const id = parseInt(hash);

  if (window.allMemes && window.allMemes[id]) openMemeModal(id);
  else if (window.allBattles && window.allBattles[id]) openBattleModal(id);
  else if (window.allCategories && window.allCategories[id]) openCategoryModal(id);
};

// ====================== DEEP LINK (ROBUST RETRY VERSION) ======================
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

  // Safe deep link (no retry loop that can break anything)
  console.log('🚀 initPage complete for', pageType);
  setTimeout(() => {
    if (typeof window.checkDeepLink === 'function') window.checkDeepLink();
  }, 150);
};

// ====================== BATTLES VOTING SYSTEM – SCOREBOARD STYLE ======================
window.vote = function(event, winner, id) {
  event.stopImmediatePropagation();
  event.preventDefault();

  const votedKey = `voted_battle_${id}`;
  if (localStorage.getItem(votedKey)) {
    window.showToast("You've already voted on this battle! 🏆");
    return;
  }

  const ref = database.ref('battles/' + id);
  ref.transaction(current => {
    if (current === null) current = { grok: 0, human: 0 };
    if (winner === 'grok') current.grok = (current.grok || 0) + 1;
    else current.human = (current.human || 0) + 1;
    return current;
  });

  localStorage.setItem(votedKey, 'true');
  window.showToast(`You voted for ${winner.toUpperCase()}! 🏆`);

  updateGridVoteUI(id);
  if (window.currentBattleId === id) updateModalVoteUI();
};

function updateGridVoteUI(id) {
  const grokBtn = document.getElementById(`grok-btn-${id}`);
  const humanBtn = document.getElementById(`human-btn-${id}`);
  if (!grokBtn || !humanBtn) return;

  const hasVoted = !!localStorage.getItem(`voted_battle_${id}`);

  database.ref('battles/' + id).once('value', snapshot => {
    const data = snapshot.val() || { grok: 0, human: 0 };

    if (hasVoted) {
      // SCOREBOARD STYLE – exactly like your screenshot
      grokBtn.innerHTML = `Grok ${data.grok}`;
      humanBtn.innerHTML = `${data.human} Human`;
    } else {
      grokBtn.textContent = 'Grok Won';
      humanBtn.textContent = 'Human Won';
    }
  });
}

window.updateModalVoteUI = function() {
  if (!window.currentBattleId) return;
  const id = window.currentBattleId;
  const hasVoted = !!localStorage.getItem(`voted_battle_${id}`);
  const grokBtn = document.getElementById('modal-grok-btn');
  const humanBtn = document.getElementById('modal-human-btn');

  if (!grokBtn || !humanBtn) return;

  if (hasVoted) {
    database.ref('battles/' + id).once('value', snapshot => {
      const data = snapshot.val() || { grok: 0, human: 0 };
      grokBtn.innerHTML = `Grok ${data.grok}`;
      humanBtn.innerHTML = `${data.human} Human`;
      grokBtn.disabled = true;
      humanBtn.disabled = true;
    });
  } else {
    grokBtn.innerHTML = 'Grok Won';
    humanBtn.innerHTML = 'Human Won';
    grokBtn.disabled = false;
    humanBtn.disabled = false;
  }
};

window.voteFromModal = function(event, winner) {
  if (window.currentBattleId) vote(event, winner, window.currentBattleId);
};

// ====================== DOM CONTENT LOADED ======================
document.addEventListener('DOMContentLoaded', async () => {
  setRandomBackground();
  await loadLayout();                    // header + footer (already async)

  // ── NEW: Automatic page init based on <body data-page="..."> ──
  // This is the single source of truth for ALL pages
  const pageType = document.body.getAttribute('data-page');
  if (pageType) {
    await window.initPage(pageType);     // loads JSON + renders grid + deep-link
    console.log(`✅ Auto-initialized ${pageType} page (modals + grids now live)`);
  }
});
// End of common.js