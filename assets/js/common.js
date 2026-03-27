// assets/js/common.js
// MODERNIZATION: Unified header/footer + background + nav highlight + Firebase + FULL navigation
// DIRECTION INVERTED AGAIN (swipe left = previous, swipe right = next) – works identically on Battles / Categories / Memes

const firebaseConfig = {
  apiKey: "AIzaSyB00xfM91Dc1oqy37uFt34M_0VcL0xA8sE",
  authDomain: "grokvshumans.firebaseapp.com",
  databaseURL: "https://grokvshumans-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "grokvshumans",
  storageBucket: "grokvshumans.firebasestorage.app",
  messagingSenderId: "483683492125",
  appId: "1:483683492125:web:37d5dad0e8e8471b0b81f4"
};

firebase.initializeApp(firebaseConfig);
const database = firebase.database();

document.addEventListener('DOMContentLoaded', () => {

    // 1. RANDOM BACKGROUND ROTATOR
    const bgs = ['assets/images/backgrounds/bg1.webp','assets/images/backgrounds/bg2.webp','assets/images/backgrounds/bg3.webp','assets/images/backgrounds/bg4.webp','assets/images/backgrounds/bg5.webp','assets/images/backgrounds/bg6.webp','assets/images/backgrounds/bg7.webp','assets/images/backgrounds/bg8.webp','assets/images/backgrounds/bg9.webp','assets/images/backgrounds/bg10.webp','assets/images/backgrounds/bg11.webp','assets/images/backgrounds/bg12.webp','assets/images/backgrounds/bg13.webp','assets/images/backgrounds/bg14.webp','assets/images/backgrounds/bg15.webp','assets/images/backgrounds/bg16.webp','assets/images/backgrounds/bg17.webp','assets/images/backgrounds/bg18.webp','assets/images/backgrounds/bg19.webp','assets/images/backgrounds/bg20.webp'];
    const randomBg = bgs[Math.floor(Math.random() * bgs.length)];
    document.body.style.backgroundImage = `url('/${randomBg}')`;
    document.body.style.backgroundPosition = '50% 35%';
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundRepeat = 'no-repeat';
    document.body.style.backgroundAttachment = 'fixed';

    // 2. LOAD HEADER + FOOTER
    loadLayout();

    // 3. NAV HIGHLIGHT
    const observer = new MutationObserver(() => {
        const navLinks = document.querySelectorAll('.nav-link');
        if (navLinks.length > 0) {
            const currentPage = document.body.getAttribute('data-page') || '';
            if (currentPage) {
                navLinks.forEach(link => {
                    link.classList.remove('active');
                    const href = link.getAttribute('href').replace('.html', '').toLowerCase();
                    if (href === currentPage.toLowerCase()) link.classList.add('active');
                });
            }
            observer.disconnect();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // 4. GLOBAL KEYBOARD NAVIGATION – INVERTED DIRECTION
    document.addEventListener('keydown', e => {
        const memeModal = document.getElementById('meme-modal');
        const battleModal = document.getElementById('battle-modal');
        const categoryModal = document.getElementById('category-modal');

        if (memeModal && memeModal.style.display === 'flex' && window.currentMemeId) {
            if (e.key === 'Escape') closeMemeModal();
            else if (e.key === 'ArrowLeft') prevMeme();      // ← INVERTED
            else if (e.key === 'ArrowRight') nextMeme();     // ← INVERTED
            else if (e.key === 'ArrowUp') prevGenreMeme?.(); // ← INVERTED
            else if (e.key === 'ArrowDown') nextGenreMeme?.(); // ← INVERTED
        }
        else if (battleModal && !battleModal.classList.contains('hidden') && window.currentBattleId) {
            if (e.key === 'Escape') closeModal();
            else if (e.key === 'ArrowLeft') prevBattle();   // ← INVERTED
            else if (e.key === 'ArrowRight') nextBattle();  // ← INVERTED
        }
        else if (categoryModal && !categoryModal.classList.contains('hidden') && window.currentCategoryId) {
            if (e.key === 'Escape') closeCategoryModal();
            else if (e.key === 'ArrowLeft') prevCategory(); // ← INVERTED
            else if (e.key === 'ArrowRight') nextCategory(); // ← INVERTED
        }
    });
});

async function loadLayout() {
    try {
        const headerRes = await fetch('assets/partials/header.html');
        const headerHTML = await headerRes.text();
        document.body.insertAdjacentHTML('afterbegin', headerHTML);

        const footerRes = await fetch('assets/partials/footer.html');
        const footerHTML = await footerRes.text();
        document.body.insertAdjacentHTML('beforeend', footerHTML);

        console.log('✅ Header + Footer loaded from common.js');
    } catch (e) {
        console.error('❌ Layout load failed:', e);
    }
}

// ====================== GLOBAL UTILITIES ======================
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
  attachGlobalSwipeHandler(pageType);
};

function attachGlobalSwipeHandler(pageType) {
  const modalId = pageType === 'memes' ? 'meme-modal' : pageType === 'battles' ? 'battle-modal' : 'category-modal';
  const modal = document.getElementById(modalId);
  if (!modal) return;

  let touchStartX = 0;
  modal.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; });
  modal.addEventListener('touchend', e => {
    const diff = touchStartX - e.changedTouches[0].screenX;
    if (Math.abs(diff) < 50) return;
    // INVERTED DIRECTION: swipe left (diff > 0) = PREVIOUS card
    if (diff > 0) window[`prev${pageType.charAt(0).toUpperCase() + pageType.slice(1)}`]?.();
    else window[`next${pageType.charAt(0).toUpperCase() + pageType.slice(1)}`]?.();
  });
}

// ====================== MEMES GENRE VERTICAL SWIPE – INVERTED ======================
function attachGenreVerticalSwipe() {
  const modalImage = document.getElementById('modal-image');
  if (!modalImage) return;
  let touchStartX = 0, touchStartY = 0;

  modalImage.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
  });

  modalImage.addEventListener('touchend', e => {
    if (!window.currentMemeId) return;
    const touchEndX = e.changedTouches[0].screenX;
    const touchEndY = e.changedTouches[0].screenY;
    const diffX = touchStartX - touchEndX;
    const diffY = touchStartY - touchEndY;

    if (Math.abs(diffY) > 50 && Math.abs(diffY) > Math.abs(diffX)) {
      if (window.currentGenreList && window.currentGenreList.length) {
        // INVERTED: swipe up (diffY > 0) = PREVIOUS genre variation
        if (diffY > 0) prevGenreMeme();
        else nextGenreMeme();
      }
    }
  });
}

const originalOpenMemeModal = window.openMemeModal;
window.openMemeModal = function(id) {
  if (typeof originalOpenMemeModal === 'function') originalOpenMemeModal(id);
  setTimeout(attachGenreVerticalSwipe, 100);
};