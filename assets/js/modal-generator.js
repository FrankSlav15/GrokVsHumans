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

function getYouTubeEmbed(url) {
  if (!url) return '';
  const regExp = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  const videoId = (match && match[2].length === 11) ? match[2] : null;
  return videoId ? `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&controls=1&modestbranding=1` : '';
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
  if (descEl) descEl.textContent = data.description || data.context || '';

  const xLinkEl = document.getElementById('base-x-link');
  if (xLinkEl) xLinkEl.href = data.xLink || '#';
}

/* FIXED: genre now always shows when present, and modal buttons are fully restored */
window.openMemeModal = function(id) {
  window.currentMemeIndex = id;
  const data = window.allMemes[id];
  if (!data) return;
  window.currentMemeId = id;
  renderCommonModalParts(data);
  renderGenreNav(id);                     // ← ensures genre section appears
  document.getElementById('meme-modal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  attachGlobalSwipeHandler('memes');
};

window.closeMemeModal = function() {
  document.getElementById('meme-modal').style.display = 'none';
  document.body.style.overflow = 'visible';
};

/* FIXED: right arrow = higher ID, left arrow = lower ID */
window.nextMeme = function() {
  const keys = window.getMemeKeys();
  let pos = keys.indexOf(window.currentMemeIndex);
  if (pos === -1) pos = 0;
  const nextPos = (pos + 1) % keys.length;
  window.currentMemeIndex = keys[nextPos];
  closeMemeModal();
  setTimeout(() => openMemeModal(window.currentMemeIndex), 280);
};

window.prevMeme = function() {
  const keys = window.getMemeKeys();
  let pos = keys.indexOf(window.currentMemeIndex);
  if (pos === -1) pos = 0;
  const prevPos = (pos - 1 + keys.length) % keys.length;
  window.currentMemeIndex = keys[prevPos];
  closeMemeModal();
  setTimeout(() => openMemeModal(window.currentMemeIndex), 280);
};

window.renderGenreNav = function(currentId) {
  const section = document.getElementById('genre-section');
  if (!section) return;
  const current = window.allMemes[currentId];
  if (!current || !current.genre || current.genre.trim() === '') {
    section.classList.add('hidden');
    return;
  }
  window.currentGenreList = Object.keys(window.allMemes)
    .filter(id => {
      const g = window.allMemes[id].genre;
      return g && g.trim() === current.genre.trim();
    })
    .sort((a, b) => (window.allMemes[b].order || 0) - (window.allMemes[a].order || 0));
  if (window.currentGenreList.length <= 1) {
    section.classList.add('hidden');
    return;
  }
  window.currentGenreIndex = window.currentGenreList.indexOf(currentId);
  document.querySelector('.genre-header').textContent = `SEE OTHER VARIATIONS OF`;
  document.getElementById('genre-name').textContent = `"${current.genre.toUpperCase()}"`;
  section.classList.remove('hidden');
};

window.switchGenreMeme = function(newId) {
  const data = window.allMemes[newId];
  if (!data) return;
  document.getElementById('modal-title').textContent = data.title;
  document.getElementById('modal-desc').innerHTML = 
    (data.description || data.context || '') + 
    (data.xLink ? `<br><a href="${data.xLink}" target="_blank" class="text-purple-400 text-xs mt-2 inline-block">View original on X →</a>` : '');
  const mediaContainer = document.getElementById('modal-image');
  mediaContainer.innerHTML = createModalMediaHTML(data);
  document.getElementById('base-x-link').href = data.xLink || '#';
  window.currentMemeId = newId;
  window.currentMemeIndex = newId;
  renderGenreNav(newId);
};

window.prevGenreMeme = function() {
  if (!window.currentGenreList || window.currentGenreList.length === 0) return;
  window.currentGenreIndex = (window.currentGenreIndex - 1 + window.currentGenreList.length) % window.currentGenreList.length;
  switchGenreMeme(window.currentGenreList[window.currentGenreIndex]);
};

window.nextGenreMeme = function() {
  if (!window.currentGenreList || window.currentGenreList.length === 0) return;
  window.currentGenreIndex = (window.currentGenreIndex + 1) % window.currentGenreList.length;
  switchGenreMeme(window.currentGenreList[window.currentGenreIndex]);
};

window.getMemeKeys = function() {
  return Object.keys(window.allMemes).map(Number).sort((a,b) => a - b);
};

window.showContextPanel = function() {
  if (!window.currentMemeId) return;
  const data = window.allMemes[window.currentMemeId];
  document.getElementById('context-text').textContent = data.context || '';
  document.getElementById('context-panel').style.display = 'block';
  document.getElementById('modal-buttons').style.display = 'none';
};

window.hideContextPanel = function() {
  document.getElementById('context-panel').style.display = 'none';
  document.getElementById('modal-buttons').style.display = 'flex';
};

window.searchMemeImage = function() {
  if (!window.currentMemeId) return;
  const data = window.allMemes[window.currentMemeId];
  window.open(`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(data.image)}`, '_blank');
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

window.closeMemeShareMenu = function() {
  const overlay = document.getElementById('share-overlay');
  if (overlay) overlay.remove();
};

window.copyMemeDeepLink = function(url) {
  navigator.clipboard.writeText(url).then(() => {
    window.showToast('✅ Link to this meme copied!');
    closeMemeShareMenu();
  });
};

window.copyToClipboard = function(url) {
  navigator.clipboard.writeText(url).then(() => {
    window.showToast('✅ Link copied to clipboard!');
    closeMemeShareMenu();
  });
};

function createModalMediaHTML(data) {
  const isVideo = data.image.toLowerCase().match(/\.(mp4|webm|mov)$/i);
  return isVideo
    ? `<video id="modal-video" src="${data.image}" class="modal__image" autoplay loop muted playsinline preload="metadata" controls></video>`
    : `<img src="${data.image}" class="modal__image" alt="${data.title}">`;
}

function attachGlobalSwipeHandler(pageType) {
  const modalId = pageType === 'memes' ? 'meme-modal' : pageType === 'battles' ? 'battle-modal' : 'category-modal';
  const modal = document.getElementById(modalId);
  if (!modal) return;
  let touchStartX = 0;
  modal._swipeStart = (e) => { touchStartX = e.changedTouches[0].screenX; };
  modal._swipeEnd = (e) => {
    const diff = touchStartX - e.changedTouches[0].screenX;
    if (Math.abs(diff) < 55) return;
    if (diff > 0) window[`prev${pageType.charAt(0).toUpperCase() + pageType.slice(1)}`]?.();
    else window[`next${pageType.charAt(0).toUpperCase() + pageType.slice(1)}`]?.();
  };
  modal.addEventListener('touchstart', modal._swipeStart, { passive: true });
  modal.addEventListener('touchend', modal._swipeEnd, { passive: true });
}

/* Rest of the battle/category functions unchanged */
window.getBattleKeys = function() {
  return Object.keys(window.allBattles || {}).map(Number).sort((a,b) => a - b);
};

window.nextBattle = function() {
  const keys = window.getBattleKeys();
  let pos = keys.indexOf(window.currentBattleIndex);
  if (pos === -1) pos = 0;
  const nextPos = (pos + 1) % keys.length;
  window.currentBattleIndex = keys[nextPos];
  closeModal();
  setTimeout(() => openBattleModal(window.currentBattleIndex), 280);
};

window.prevBattle = function() {
  const keys = window.getBattleKeys();
  let pos = keys.indexOf(window.currentBattleIndex);
  if (pos === -1) pos = 0;
  const prevPos = (pos - 1 + keys.length) % keys.length;
  window.currentBattleIndex = keys[prevPos];
  closeModal();
  setTimeout(() => openBattleModal(window.currentBattleIndex), 280);
};

window.getSortedCategoryIds = function() {
  return Object.keys(window.allCategories || {})
    .sort((a, b) => (window.allCategories[b].order || 0) - (window.allCategories[a].order || 0));
};

window.nextCategory = function() {
  const keys = window.getSortedCategoryIds();
  let pos = keys.indexOf(window.currentCategoryIndex);
  if (pos === -1) pos = 0;
  const nextPos = (pos + 1) % keys.length;
  window.currentCategoryIndex = keys[nextPos];
  closeCategoryModal();
  setTimeout(() => openCategoryModal(window.currentCategoryIndex), 280);
};

window.prevCategory = function() {
  const keys = window.getSortedCategoryIds();
  let pos = keys.indexOf(window.currentCategoryIndex);
  if (pos === -1) pos = 0;
  const prevPos = (pos - 1 + keys.length) % keys.length;
  window.currentCategoryIndex = keys[prevPos];
  closeCategoryModal();
  setTimeout(() => openCategoryModal(window.currentCategoryIndex), 280);
};

window.checkDeepLink = function() {
  const hash = window.location.hash.replace('#', '');
  if (!hash || isNaN(hash)) return;
  const id = parseInt(hash);
  if (window.allBattles && window.allBattles[id]) openBattleModal(id);
  else if (window.allCategories && window.allCategories[id]) openCategoryModal(id);
  else if (window.allMemes && window.allMemes[id]) openMemeModal(id);
};

document.addEventListener('keydown', e => {
  const memeModal = document.getElementById('meme-modal');
  if (memeModal && memeModal.style.display === 'flex' && window.currentMemeId) {
    if (e.key === 'Escape') closeMemeModal();
    else if (e.key === 'ArrowLeft') prevMeme();
    else if (e.key === 'ArrowRight') nextMeme();
    else if (e.key === 'ArrowUp') prevGenreMeme?.();
    else if (e.key === 'ArrowDown') nextGenreMeme?.();
  }
});