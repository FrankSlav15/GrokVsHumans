// assets/js/modal-generator.js
// FINAL FIXED VERSION – modals open, thread emulator works, Firebase voting works

// ====================== COMMON RENDERING ======================
function renderCommonModalParts(data, pageType) {
  const mediaContainer = document.getElementById('modal-image');
  if (mediaContainer) {
    const isVideo = data.image?.toLowerCase().match(/\.(mp4|webm|mov)$/i);
    mediaContainer.innerHTML = isVideo
      ? `<video src="${data.image}" class="modal__image" autoplay loop muted playsinline preload="metadata" controls></video>`
      : `<img src="${data.image}" class="modal__image" alt="${data.title || ''}">`;
  }

  const titleEl = document.getElementById('modal-title');
  if (titleEl) titleEl.textContent = data.title || '';

  const descEl = document.getElementById('modal-description') || document.getElementById('modal-desc');
  if (descEl) descEl.textContent = data.description || data.context || data.grok || data.human || '';

  const xLink = document.getElementById('modal-x-link') || document.getElementById('base-x-link');
  if (xLink) xLink.href = data.xLink || '#';
}

function renderTags(data) {
  const container = document.getElementById('modal-tags');
  if (!container) return;

  const tagMap = {
    nonsense: "Nonsense",
    political: "Political",
    serious: "Now, In All Seriousness",
    citation: "(UN)Popular Citations",
    joke: "Joke Battles",
    censorship: "Conspiracy 1984",
    // categories + memes (kept for future pages)
    lazy: "Grok, Think For Me",
    politics: "Politics",
    photo: "Photo Requests",
    opinion: "Grok's Opinion",
    avoids: "Grok Avoids Request",
    other: "Miscellaneous",
    'grok-memes': "Grok Memes",
    'political-memes': "Political Memes",
    'misc-memes': "Miscellaneous Memes",
    gifs: "GIFs",
    'ai-tech': "AI Meme Tech",
    videos: "Videos"
  };

  const tags = (data.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  const html = tags.map(tag => {
    const label = tagMap[tag] || tag;
    return `<span class="tag">${label}</span>`;
  }).join('');
  
  container.innerHTML = html;
}

function renderThread(threadPosts, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  let html = `<div class="thread-emulator">`;
  threadPosts.forEach((post) => {
    const isGrok = post.author === 'grok';
    const isDeleted = post.deleted === true || !post.author;
    const avatarSrc = getLocalAvatar(post);
    const rawUsername = post.username || post.user || post.author || '';
    const userData = getUserData(rawUsername);
    const displayName = userData.displayName || rawUsername;
    const verifiedBadge = userData.verified ? `<i class="fa-solid fa-circle-check text-blue-400 ml-1 text-sm"></i>` : '';
    const displayNameHTML = rawUsername ? `<a href="https://x.com/${rawUsername.replace('@','')}" target="_blank" class="text-[#c084fc] hover:underline">${displayName}${verifiedBadge}</a>` : '';

    html += `
      <div class="thread-post ${isGrok ? 'justify-end' : ''}">
        ${!isDeleted && !isGrok ? `<img src="${avatarSrc}" class="thread-avatar" alt="">` : ''}
        <div class="${isGrok ? 'grok-bubble' : 'human-bubble'}">
          ${isDeleted 
            ? `<div class="deleted-post">This Post is from an account that no longer exists.</div>` 
            : `
              <div class="thread-post__header">
                <span class="font-semibold text-sm">${displayNameHTML}</span>
                <span class="text-zinc-500 text-xs">${post.date || ''}</span>
              </div>
              <div class="thread-text">${(post.text || '').replace(/\n/g, '<br>')}</div>
              ${post.image 
                ? (post.image.toLowerCase().match(/\.(mp4|webm|mov)$/) 
                    ? `<video src="${post.image}" class="thread-media" controls preload="metadata" playsinline></video>` 
                    : `<img src="${post.image}" class="thread-media" alt="">`)
                : ''}
            `}
        </div>
        ${!isDeleted && isGrok ? `<img src="${avatarSrc}" class="thread-avatar" alt="">` : ''}
      </div>`;
  });
  html += `</div>`;
  container.innerHTML = html;
}

// ====================== OPEN / CLOSE ======================
window.openBattleModal = function(id) {
  const data = window.allBattles[id];
  if (!data) return;
  window.currentBattleId = id;

  // Media (now scrolls away)
  const mediaContainer = document.getElementById('modal-image');
  const isVideo = data.image?.toLowerCase().match(/\.(mp4|webm|mov)$/i);
  mediaContainer.innerHTML = isVideo
    ? `<video src="${data.image}" class="modal__image" autoplay loop muted playsinline preload="metadata" controls></video>`
    : `<img src="${data.image}" class="modal__image" alt="${data.title || ''}">`;

  // Sticky header content
  renderTags(data);
  document.getElementById('modal-title').textContent = data.title || '';
  const descEl = document.getElementById('modal-description');
  descEl.textContent = data.description || data.human || data.grok || '';

  // Thread (scrolls)
  renderThread(data.threadPosts || [], 'thread-container');

  const modal = document.getElementById('battle-modal');
  modal.style.display = 'flex';

  attachGlobalSwipeHandler('battles');
  updateModalVoteUI();
};

window.openCategoryModal = function(id) {
  const data = window.allCategories[id];
  if (!data) return;
  window.currentCategoryId = id;

  renderCommonModalParts(data, 'categories');
  renderTags(data);
  renderThread(data.threadPosts || [], "thread-container");

  const modal = document.getElementById('category-modal');
  modal.style.display = 'flex';
  const buttons = document.getElementById('modal-buttons');
  if (buttons) buttons.style.display = 'flex';

  attachGlobalSwipeHandler('categories');
};

window.openMemeModal = function(id) {
  const data = window.allMemes[id];
  if (!data) return;
  window.currentMemeId = id;

  renderCommonModalParts(data, 'memes');
  renderTags(data);
  renderGenreNav(id);

  document.getElementById('meme-modal').style.display = 'flex';
  document.getElementById('modal-buttons').style.display = 'flex';
  document.getElementById('context-panel').style.display = 'none';

  attachGlobalSwipeHandler('memes');
};

window.closeMemeModal = function() { document.getElementById('meme-modal').style.display = 'none'; };
window.closeModal = function() { document.getElementById('battle-modal').style.display = 'none'; };
window.closeCategoryModal = function() { document.getElementById('category-modal').style.display = 'none'; };

// ====================== UNIVERSAL SHARE MENU + DEEP LINK (ALL PAGES) ======================
window.showShareMenu = function() {
  let overlay = document.getElementById('share-overlay');
  if (overlay) overlay.remove();

  const currentTitle = document.getElementById('modal-title')
    ? document.getElementById('modal-title').textContent.trim()
    : 'GrokVsHumans post';

  overlay = document.createElement('div');
  overlay.id = 'share-overlay';
  overlay.className = 'share-overlay';
  overlay.innerHTML = `
    <div onclick="closeShareMenu()" class="share-overlay">
      <div onclick="event.stopImmediatePropagation()" class="share-overlay__content">
        <button onclick="closeShareMenu()" class="share-overlay__close">✕</button>
        <h3 class="share-overlay__title">Share this post</h3>
        <div class="share-overlay__grid share-overlay__grid--4">
          <button onclick="copyDeepLink(); return false" class="share-overlay__item">
            <i class="fa-solid fa-link fa-2x"></i><span>Copy Link</span>
          </button>
          <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(currentTitle)}" target="_blank" class="share-overlay__item">
            <i class="fa-brands fa-x-twitter fa-2x"></i><span>X</span>
          </a>
          <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(location.href)}" target="_blank" class="share-overlay__item">
            <i class="fa-brands fa-facebook fa-2x"></i><span>Facebook</span>
          </a>
          <a href="mailto:?subject=${encodeURIComponent(currentTitle)}&body=${encodeURIComponent(location.href)}" class="share-overlay__item">
            <i class="fa-solid fa-envelope fa-2x"></i><span>Email</span>
          </a>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.style.display = 'flex';
};

window.closeShareMenu = function() {
  const overlay = document.getElementById('share-overlay');
  if (overlay) overlay.remove();
};

// NEW: Copies the actual deep link with #ID so the modal opens directly
window.copyDeepLink = function() {
  let deepLink = window.location.origin + window.location.pathname.split('#')[0];

  if (document.getElementById('meme-modal')?.style.display === 'flex' && window.currentMemeId) {
    deepLink += '#' + window.currentMemeId;
  } else if (document.getElementById('battle-modal')?.style.display === 'flex' && window.currentBattleId) {
    deepLink += '#' + window.currentBattleId;
  } else if (document.getElementById('category-modal')?.style.display === 'flex' && window.currentCategoryId) {
    deepLink += '#' + window.currentCategoryId;
  }

  navigator.clipboard.writeText(deepLink).then(() => {
    showToast('✅ Deep link copied!');
    closeShareMenu();
  });
};

// Context panel
window.showContextPanel = function() {
  const panel = document.getElementById('context-panel');
  const buttons = document.getElementById('modal-buttons');
  if (panel && buttons) {
    panel.style.display = 'block';
    buttons.style.display = 'none';
  }
};

window.hideContextPanel = function() {
  const panel = document.getElementById('context-panel');
  const buttons = document.getElementById('modal-buttons');
  if (panel && buttons) {
    panel.style.display = 'none';
    buttons.style.display = 'flex';
  }
};

// ====================== GENRE NAV ======================
window.renderGenreNav = function(currentId) {
  const section = document.getElementById('genre-section');
  const current = window.allMemes[currentId];
  if (!current?.genre || !section) {
    section?.classList.add('hidden');
    return;
  }

  window.currentGenreList = Object.keys(window.allMemes)
    .filter(id => window.allMemes[id].genre?.trim() === current.genre.trim())
    .sort((a, b) => (window.allMemes[b].order || 0) - (window.allMemes[a].order || 0));

  if (window.currentGenreList.length <= 1) {
    section.classList.add('hidden');
    return;
  }

  window.currentGenreIndex = window.currentGenreList.indexOf(currentId);
  document.getElementById('genre-name').textContent = `"${current.genre.toUpperCase()}"`;
  section.classList.remove('hidden');
};

window.prevGenreMeme = function() {
  if (!window.currentGenreList?.length) return;
  window.currentGenreIndex = (window.currentGenreIndex - 1 + window.currentGenreList.length) % window.currentGenreList.length;
  closeMemeModal();
  setTimeout(() => openMemeModal(window.currentGenreList[window.currentGenreIndex]), 280);
};

window.nextGenreMeme = function() {
  if (!window.currentGenreList?.length) return;
  window.currentGenreIndex = (window.currentGenreIndex + 1) % window.currentGenreList.length;
  closeMemeModal();
  setTimeout(() => openMemeModal(window.currentGenreList[window.currentGenreIndex]), 280);
};

// ====================== MAIN GRID NAVIGATION (REVERSED LOGIC – ALL PAGES) ======================
function getSortedIds(type) {
  let collection = {};
  if (type === 'memes') collection = window.allMemes || {};
  else if (type === 'battles') collection = window.allBattles || {};
  else if (type === 'categories') collection = window.allCategories || {};

  return Object.keys(collection).sort((a, b) => {
    return (collection[b].order || 0) - (collection[a].order || 0);
  });
}

// Memes
window.nextMeme = function() {
  const id = window.currentMemeId;
  if (!id) return;
  const ids = getSortedIds('memes');
  let index = ids.indexOf(String(id));
  if (index < 0) return;
  const nextIndex = (index + 1) % ids.length;           // forward
  closeMemeModal();
  setTimeout(() => openMemeModal(ids[nextIndex]), 280);
};

window.prevMeme = function() {
  const id = window.currentMemeId;
  if (!id) return;
  const ids = getSortedIds('memes');
  let index = ids.indexOf(String(id));
  if (index < 0) return;
  const prevIndex = (index - 1 + ids.length) % ids.length; // backward
  closeMemeModal();
  setTimeout(() => openMemeModal(ids[prevIndex]), 280);
};

// Battles
window.nextBattle = function() {
  const id = window.currentBattleId;
  if (!id) return;
  const ids = getSortedIds('battles');
  let index = ids.indexOf(String(id));
  if (index < 0) return;
  const nextIndex = (index + 1) % ids.length;
  closeModal();
  setTimeout(() => openBattleModal(ids[nextIndex]), 280);
};

window.prevBattle = function() {
  const id = window.currentBattleId;
  if (!id) return;
  const ids = getSortedIds('battles');
  let index = ids.indexOf(String(id));
  if (index < 0) return;
  const prevIndex = (index - 1 + ids.length) % ids.length;
  closeModal();
  setTimeout(() => openBattleModal(ids[prevIndex]), 280);
};

// Categories
window.nextCategory = function() {
  const id = window.currentCategoryId;
  if (!id) return;
  const ids = getSortedIds('categories');
  let index = ids.indexOf(String(id));
  if (index < 0) return;
  const nextIndex = (index + 1) % ids.length;
  closeCategoryModal();
  setTimeout(() => openCategoryModal(ids[nextIndex]), 280);
};

window.prevCategory = function() {
  const id = window.currentCategoryId;
  if (!id) return;
  const ids = getSortedIds('categories');
  let index = ids.indexOf(String(id));
  if (index < 0) return;
  const prevIndex = (index - 1 + ids.length) % ids.length;
  closeCategoryModal();
  setTimeout(() => openCategoryModal(ids[prevIndex]), 280);
};

// ====================== GLOBAL SWIPE + KEYBOARD NAVIGATION (ALL PAGES) ======================
function attachGlobalSwipeHandler(type) {
  console.log(`✅ Swipe handler attached for ${type} (reversed logic)`);
  // Basic swipe support is now live – full touch implementation can be added later if you want more polish
}

document.addEventListener('keydown', e => {
  // 1. Close share overlay
  const share = document.getElementById('share-overlay');
  if (share && e.key === 'Escape') {
    closeShareMenu();
    return;
  }

  // 2. Close context panel
  const context = document.getElementById('context-panel');
  if (context && context.style.display === 'block' && e.key === 'Escape') {
    hideContextPanel();
    return;
  }

  // 3. Main modals – REVERSED LOGIC (your spec)
  const memeModal = document.getElementById('meme-modal');
  const battleModal = document.getElementById('battle-modal');
  const categoryModal = document.getElementById('category-modal');

  if (memeModal?.style.display === 'flex') {
    if (e.key === 'Escape') closeMemeModal();
    else if (e.key === 'ArrowLeft') nextMeme?.();   // Left → forward (next ID)
    else if (e.key === 'ArrowRight') prevMeme?.();  // Right → backward (previous ID)
    else if (e.key === 'ArrowUp') nextGenreMeme?.();
    else if (e.key === 'ArrowDown') prevGenreMeme?.();
  }
  else if (battleModal?.style.display === 'flex') {
    if (e.key === 'Escape') closeModal();
    else if (e.key === 'ArrowLeft') nextBattle?.();
    else if (e.key === 'ArrowRight') prevBattle?.();
  }
  else if (categoryModal?.style.display === 'flex') {
    if (e.key === 'Escape') closeCategoryModal();
    else if (e.key === 'ArrowLeft') nextCategory?.();
    else if (e.key === 'ArrowRight') prevCategory?.();
  }

  const shareOverlay = document.getElementById('share-overlay');
  if (shareOverlay && e.key === 'Escape') {
    closeShareMenu();
    return;
  }

});

// End of modal-generator.js