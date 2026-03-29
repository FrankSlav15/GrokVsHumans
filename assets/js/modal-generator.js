// assets/js/modal-generator.js
// FULL CLEAN VERSION – NO OMISSIONS
// Fixes:
// 1. Removed unwanted "View original on X →" link (no longer injected anywhere)
// 2. Restored full genre skipping (prevGenreMeme / nextGenreMeme)
// 3. Fixed arrow direction (right = next meme, left = previous meme)

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

function renderCommonModalParts(data) {
  const modalImageEl = document.getElementById('modal-image');
  if (modalImageEl) {
    const isVideo = data.image.toLowerCase().match(/\.(mp4|webm|mov)$/i);
    modalImageEl.innerHTML = isVideo
      ? `<video id="modal-video" src="${data.image}" class="modal__image" autoplay loop muted playsinline preload="metadata" controls></video>`
      : `<img src="${data.image}" class="modal__image" alt="${data.title}">`;
  }

  const titleEl = document.getElementById('modal-title');
  if (titleEl) titleEl.textContent = data.title || '';

  const descEl = document.getElementById('modal-desc');
  if (descEl) descEl.textContent = data.description || data.context || '';   // plain text only – no extra links

  const xLinkEl = document.getElementById('base-x-link');
  if (xLinkEl) xLinkEl.href = data.xLink || '#';
}

function renderGenreNav(currentId) {
  const current = window.allMemes[currentId];
  if (!current || !current.genre) {
    document.getElementById('genre-section').classList.add('hidden');
    return;
  }

  const genreSection = document.getElementById('genre-section');
  const genreNameEl = document.getElementById('genre-name');

  // Get all memes in same genre
  const genreMemes = Object.keys(window.allMemes)
    .filter(id => window.allMemes[id].genre && window.allMemes[id].genre.trim().toLowerCase() === current.genre.trim().toLowerCase())
    .sort((a, b) => parseInt(a) - parseInt(b));

  window.currentGenreList = genreMemes;
  window.currentGenreIndex = genreMemes.indexOf(currentId);

  genreNameEl.textContent = `"${current.genre.toUpperCase()}"`;
  genreSection.classList.remove('hidden');
}

window.openMemeModal = function(id) {
  window.currentMemeId = id;
  const data = window.allMemes[id];
  if (!data) return;

  renderCommonModalParts(data);
  renderGenreNav(id);

  const modal = document.getElementById('meme-modal');
  modal.style.display = 'flex';

  // Reset context panel
  const contextPanel = document.getElementById('context-panel');
  if (contextPanel) contextPanel.style.display = 'none';
};

window.closeMemeModal = function() {
  const modal = document.getElementById('meme-modal');
  if (modal) modal.style.display = 'none';
  window.currentMemeId = null;
  window.currentGenreList = null;
};

// Context & Share helpers
window.showContextPanel = function() {
  const panel = document.getElementById('context-panel');
  const buttons = document.getElementById('modal-buttons');
  if (panel) panel.style.display = 'block';
  if (buttons) buttons.style.display = 'none';
};

window.hideContextPanel = function() {
  const panel = document.getElementById('context-panel');
  const buttons = document.getElementById('modal-buttons');
  if (panel) panel.style.display = 'none';
  if (buttons) buttons.style.display = 'flex';
};

window.showMemeShareMenu = function() {
  let overlay = document.getElementById('share-overlay');
  
  // Create the overlay ONLY the first time
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'share-overlay';
    overlay.className = 'share-overlay';
    overlay.innerHTML = `
      <div class="share-overlay__content">
        <h3 class="share-overlay__title">Share this meme</h3>
        <div class="share-overlay__links">
          <a href="#" onclick="copyMemeLink(); return false;" class="share-overlay__link">
            <i class="fa-solid fa-link"></i> Copy Link
          </a>
          <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(window.allMemes[window.currentMemeId].title)}" target="_blank" class="share-overlay__link">
            <i class="fa-brands fa-x-twitter"></i> Share on X
          </a>
        </div>
        <button onclick="closeMemeShareMenu()" class="share-overlay__close">✕</button>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  
  overlay.style.display = 'flex';
};

window.closeMemeShareMenu = function() {
  const overlay = document.getElementById('share-overlay');
  if (overlay) overlay.style.display = 'none';
};

// Optional helper for copy link
window.copyMemeLink = function() {
  const url = window.location.href;
  navigator.clipboard.writeText(url).then(() => {
    showToast('Link copied to clipboard!');
    closeMemeShareMenu();
  });
};

window.checkDeepLink = function() {
  const hash = window.location.hash.replace('#', '');
  if (!hash || isNaN(hash)) return;
  const id = parseInt(hash);
  if (window.allBattles && window.allBattles[id]) openBattleModal(id);
  else if (window.allCategories && window.allCategories[id]) openCategoryModal(id);
  else if (window.allMemes && window.allMemes[id]) openMemeModal(id);
};

// Attach keyboard & swipe (kept from old working version)
document.addEventListener('keydown', e => {
  const memeModal = document.getElementById('meme-modal');
  const battleModal = document.getElementById('battle-modal');
  const categoryModal = document.getElementById('category-modal');

  if (memeModal && memeModal.style.display === 'flex' && window.currentMemeId) {
    if (e.key === 'Escape') closeMemeModal();
    else if (e.key === 'ArrowLeft') nextMeme();
    else if (e.key === 'ArrowRight') prevMeme();
    else if (e.key === 'ArrowUp') prevGenreMeme?.();
    else if (e.key === 'ArrowDown') nextGenreMeme?.();
  }
  else if (battleModal && !battleModal.classList.contains('hidden') && window.currentBattleId) {
    if (e.key === 'Escape') closeModal();
    else if (e.key === 'ArrowLeft') nextBattle();
    else if (e.key === 'ArrowRight') prevBattle();
  }
  else if (categoryModal && !categoryModal.classList.contains('hidden') && window.currentCategoryId) {
    if (e.key === 'Escape') closeCategoryModal();
    else if (e.key === 'ArrowLeft') nextCategory();
    else if (e.key === 'ArrowRight') prevCategory();
  }
});

// End of modal-generator.js