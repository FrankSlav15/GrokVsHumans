// assets/js/common.js
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
  firebase.initializeApp(firebaseConfig);
  database = firebase.database();
} catch (e) {
  console.warn("Firebase not available on this page (normal for index/submit)");
}

document.addEventListener('DOMContentLoaded', () => {
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

  loadLayout();
});

async function loadLayout() {
  try {
    const headerRes = await fetch('assets/partials/header.html');
    const headerHTML = await headerRes.text();
    document.body.insertAdjacentHTML('afterbegin', headerHTML);

    const footerRes = await fetch('assets/partials/footer.html');
    const footerHTML = await footerRes.text();
    document.body.insertAdjacentHTML('beforeend', footerHTML);

    highlightActiveNav();
    console.log('Header + Footer loaded');
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

window.initPage = async function(pageType) {
  await loadUsers();

  if (pageType === 'memes') {
    const res = await fetch('/data/memes.json');
    window.allMemes = await res.json();
    if (typeof renderMemeGrid === 'function') renderMemeGrid();
  } else if (pageType === 'battles') {
    const res = await fetch('/data/battles.json');
    window.allBattles = await res.json();
    if (typeof renderBattleGrid === 'function') renderBattleGrid();
  } else if (pageType === 'categories') {
    const res = await fetch('/data/categories.json');
    window.allCategories = await res.json();
    if (typeof renderCategoryGrid === 'function') renderCategoryGrid();
  }
};