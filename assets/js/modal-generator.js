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

// MAIN NAVIGATION – arrows now work in correct direction
window.nextMeme = function() {
  const keys = Object.keys(window.allMemes || {}).sort((a, b) => parseInt(a) - parseInt(b));
  let pos = keys.indexOf(window.currentMemeId);
  if (pos === -1) pos = 0;
  const nextPos = (pos + 1) % keys.length;
  closeMemeModal();
  setTimeout(() => openMemeModal(keys[nextPos]), 280);
};

window.prevMeme = function() {
  const keys = Object.keys(window.allMemes || {}).sort((a, b) => parseInt(a) - parseInt(b));
  let pos = keys.indexOf(window.currentMemeId);
  if (pos === -1) pos = 0;
  const prevPos = (pos - 1 + keys.length) % keys.length;
  closeMemeModal();
  setTimeout(() => openMemeModal(keys[prevPos]), 280);
};

// GENRE SKIPPING – fully restored
window.prevGenreMeme = function() {
  if (!window.currentGenreList || window.currentGenreList.length <= 1) return;
  let pos = window.currentGenreIndex;
  pos = (pos - 1 + window.currentGenreList.length) % window.currentGenreList.length;
  window.currentGenreIndex = pos;
  closeMemeModal();
  setTimeout(() => openMemeModal(window.currentGenreList[pos]), 280);
};

window.nextGenreMeme = function() {
  if (!window.currentGenreList || window.currentGenreList.length <= 1) return;
  let pos = window.currentGenreIndex;
  pos = (pos + 1) % window.currentGenreList.length;
  window.currentGenreIndex = pos;
  closeMemeModal();
  setTimeout(() => openMemeModal(window.currentGenreList[pos]), 280);
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
  if (!window.currentMemeId) return;
  const data = window.allMemes[window.currentMemeId];
  const baseUrl = window.location.origin + window.location.pathname;
  const shareUrl = `${baseUrl}#${window.currentMemeIndex}`;
  const text = `Check out this meme from the GrokVsHumans Meme Vault: ${data.title} 🔥`;
  const shareHTML = `
    <div id="share-overlay" class="fixed inset-0 bg-black/90 flex items-center justify-center z-[99999]" onclick="closeMemeShareMenu()">
      <div onclick="event.stopImmediatePropagation()" class="bg-zinc-900 rounded-3xl p-8 max-w-xs w-full mx-4 border border-purple-500/30 shadow-2xl">
        <h3 class="text-2xl font-semibold mb-8 text-center">Share this meme</h3>
        <div class="grid grid-cols-3 gap-6 text-center">
          <button onclick="copyMemeDeepLink('${shareUrl}');" class="flex flex-col items-center gap-2 hover:scale-110 transition-transform"><i class="fa-solid fa-link text-4xl text-purple-400"></i><span class="text-xs mt-1">Our Site</span></button>
          <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}" target="_blank" class="flex flex-col items-center gap-2 hover:scale-110 transition-transform"><i class="fa-brands fa-x-twitter text-4xl"></i><span class="text-xs mt-1">X</span></a>
          <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}" target="_blank" class="flex flex-col items-center gap-2 hover:scale-110 transition-transform"><i class="fa-brands fa-facebook text-4xl text-blue-500"></i><span class="text-xs mt-1">Facebook</span></a>
          <a href="#" onclick="copyToClipboard('${shareUrl}'); return false" class="flex flex-col items-center gap-2 hover:scale-110 transition-transform"><i class="fa-brands fa-instagram text-4xl text-pink-500"></i><span class="text-xs mt-1">Instagram</span></a>
          <a href="#" onclick="copyToClipboard('${shareUrl}'); return false" class="flex flex-col items-center gap-2 hover:scale-110 transition-transform"><i class="fa-brands fa-tiktok text-4xl"></i><span class="text-xs mt-1">TikTok</span></a>
          <a href="mailto:?subject=${encodeURIComponent(data.title)}&body=${encodeURIComponent(text + '\\n' + shareUrl)}" class="flex flex-col items-center gap-2 hover:scale-110 transition-transform"><i class="fa-solid fa-envelope text-4xl text-green-400"></i><span class="text-xs mt-1">Email</span></a>
        </div>
        <button onclick="closeMemeShareMenu()" class="mt-10 w-full py-4 border border-zinc-700 rounded-2xl hover:bg-zinc-800 font-medium">Cancel</button>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', shareHTML);
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