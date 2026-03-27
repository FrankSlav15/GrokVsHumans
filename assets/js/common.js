// assets/js/common.js
// MODERNIZATION: Background + header/footer + nav highlight only

// Replace the entire top section (Firebase init) with this safe version:
const firebaseConfig = {
  apiKey: "AIzaSyB00xfM91Dc1oqy37uFt34M_0VcL0xA8sE",
  authDomain: "grokvshumans.firebaseapp.com",
  databaseURL: "https://grokvshumans-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "grokvshumans",
  storageBucket: "grokvshumans.firebasestorage.app",
  messagingSenderId: "483683492125",
  appId: "1:483683492125:web:37d5dad0e8e8471b0b81f4"
};

// Safe Firebase init – never breaks index or submit pages
let database = null;
try {
  firebase.initializeApp(firebaseConfig);
  database = firebase.database();
} catch (e) {
  console.warn("Firebase not available on this page (normal for index/submit)");
}

document.addEventListener('DOMContentLoaded', () => {
    // 1. RANDOM BACKGROUND ROTATOR
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
    const randomBg = bgs[Math.floor(Math.random() * bgs.length)];
    document.body.style.backgroundImage = `url('/${randomBg}')`;
    document.body.style.backgroundPosition = '50% 35%';
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundRepeat = 'no-repeat';
    document.body.style.backgroundAttachment = 'fixed';

    // FORCE header + footer on EVERY page (including index and submit)
    loadLayout();
});

async function loadLayout() {
  try {
    // Header
    const headerRes = await fetch('assets/partials/header.html');
    if (!headerRes.ok) throw new Error('Header 404');
    const headerHTML = await headerRes.text();
    document.body.insertAdjacentHTML('afterbegin', headerHTML);

    // Footer
    const footerRes = await fetch('assets/partials/footer.html');
    if (!footerRes.ok) throw new Error('Footer 404');
    const footerHTML = await footerRes.text();
    document.body.insertAdjacentHTML('beforeend', footerHTML);

    // Force nav highlight immediately after header is inserted
    highlightActiveNav();

    console.log('✅ Header + Footer loaded on index.html');
  } catch (e) {
    console.error('❌ Layout load failed:', e);
    // Minimal fallback so index never appears broken
    document.body.insertAdjacentHTML('afterbegin', 
      `<nav class="fixed top-0 w-full bg-black/90 p-4 text-center z-50 border-b border-red-500">GrokVsHumans <span class="text-red-400">(header failed — refresh?)</span></nav>`
    );
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

window.showToast = function(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  const text = document.getElementById('toast-text');
  text.textContent = message;
  toast.classList.remove('hidden');
  toast.style.transform = 'translate(-50%, 0)';
  setTimeout(() => { toast.style.transform = 'translate(-50%, 80px)'; setTimeout(() => toast.classList.add('hidden'), 400); }, 2800);
};

window.initPage = async function(pageType) {
  await loadUsers();
  if (pageType === 'memes') {
    const snapshot = await database.ref('content/memes').once('value');
    window.allMemes = snapshot.val() || {};
    if (typeof renderMemeGrid === 'function') renderMemeGrid();
  } else if (pageType === 'battles') {
    const snapshot = await database.ref('content/battles').once('value');
    window.allBattles = snapshot.val() || {};
    if (typeof renderBattleGrid === 'function') renderBattleGrid();
  } else if (pageType === 'categories') {
    const snapshot = await database.ref('content/categories').once('value');
    window.allCategories = snapshot.val() || {};
    if (typeof renderCategoryGrid === 'function') renderCategoryGrid();
  }
};