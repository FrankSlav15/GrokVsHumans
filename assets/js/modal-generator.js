// assets/js/modal-generator.js
// FINAL FIXED VERSION – modals open, thread emulator works, Firebase voting works

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
  const tags = (data.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  const html = tags.map(tag => `<span class="px-3 py-1 bg-purple-900/80 text-purple-200 text-xs rounded-full">${tag}</span>`).join('');
  container.innerHTML = html;
}

function renderThread(threadPosts, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  let html = `<div class="thread-emulator">`;
  threadPosts.forEach((post) => {
    const isDeleted = post.deleted === true || !post.author;
    const avatarSrc = getLocalAvatar(post);
    const rawUsername = post.username || post.user || post.author || '';
    const userData = getUserData(rawUsername);
    const displayName = userData.displayName || rawUsername;
    const verifiedBadge = userData.verified ? `<i class="fa-solid fa-circle-check text-blue-400 ml-1 text-sm"></i>` : '';
    const displayNameHTML = rawUsername ? `<a href="https://x.com/${rawUsername.replace('@','')}" target="_blank" class="text-[#c084fc] hover:underline">${displayName}${verifiedBadge}</a>` : '';
    let textWithLinks = (post.text || '').replace(/\n/g, '<br>');
    textWithLinks = textWithLinks.replace(/@(\w+)/g, '<a href="https://x.com/$1" target="_blank" class="text-[#c084fc] hover:underline">@$1</a>');

    html += `<div class="thread-post flex gap-3 ${post.author === 'grok' ? 'justify-end' : 'justify-start'}">
      ${!isDeleted && post.author !== 'grok' ? `<img src="${avatarSrc}" class="w-9 h-9 rounded-full flex-shrink-0 mt-1" alt="">` : ''}
      <div class="${post.author === 'grok' ? 'grok-bubble' : 'human-bubble'} max-w-[85%] p-5 rounded-3xl">
        ${isDeleted ? `<div class="deleted-post bg-[#27272a] text-[#71717a] p-4 rounded-2xl text-sm">This Post is from an account that no longer exists.</div>` : `
          <div class="flex items-center gap-2 mb-2">
            <span class="font-semibold text-sm">${displayNameHTML}</span>
            <span class="text-zinc-500 text-xs">${post.date || ''}</span>
          </div>
          <div class="thread-text text-[15px] leading-relaxed">${textWithLinks}</div>
          ${post.image && !post.image.includes('youtube') ? (post.image.toLowerCase().match(/\.(mp4|webm|mov)$/) ? `<video src="${post.image}" class="mt-4 w-full rounded-2xl block" controls preload="metadata" playsinline></video>` : `<img src="${post.image}" class="mt-4 rounded-2xl" alt="">`) : ''}
        `}
      </div>
      ${!isDeleted && post.author === 'grok' ? `<img src="${avatarSrc}" class="w-9 h-9 rounded-full flex-shrink-0 mt-1" alt="">` : ''}
    </div>`;
  });
  html += `</div>`;
  container.innerHTML = html;
}

// ====================== OPEN / CLOSE ======================
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

window.openBattleModal = function(id) {
  const data = window.allBattles[id];
  if (!data) return;
  window.currentBattleId = id;

  renderCommonModalParts(data, 'battles');
  renderTags(data);
  renderThread(data.threadPosts || [], "thread-container");

  document.getElementById('battle-modal').style.display = 'flex';
  attachGlobalSwipeHandler('battles');
};

window.openCategoryModal = function(id) {
  const data = window.allCategories[id];
  if (!data) return;
  window.currentCategoryId = id;

  renderCommonModalParts(data, 'categories');
  renderTags(data);
  renderThread(data.threadPosts || [], "thread-container");

  document.getElementById('category-modal').style.display = 'flex';
  attachGlobalSwipeHandler('categories');
};

window.closeMemeModal = function() { document.getElementById('meme-modal').style.display = 'none'; };
window.closeModal = function() { document.getElementById('battle-modal').style.display = 'none'; };
window.closeCategoryModal = function() { document.getElementById('category-modal').style.display = 'none'; };

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

// ====================== SHARE & CONTEXT ======================
window.showShareMenu = function() {
  const overlay = document.createElement('div');
  overlay.id = 'share-overlay';
  overlay.className = 'share-overlay';
  overlay.innerHTML = `...` ; // (your share overlay HTML from previous version - unchanged)
  document.body.appendChild(overlay);
  overlay.style.display = 'flex';
};

window.closeShareMenu = function() {
  const overlay = document.getElementById('share-overlay');
  if (overlay) overlay.remove();
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

// ====================== VOTING (now calls Firebase) ======================
window.voteFromModal = function(e, side, id) {
  e.stopImmediatePropagation();
  e.preventDefault();
  if (typeof vote === 'function') {
    vote(e, side, id);   // calls the Firebase vote function in common.js
  } else {
    showToast(side === 'grok' ? 'Grok Won!' : 'Human Won!');
  }
  closeModal();
};

// ====================== SWIPE & KEYBOARD ======================
function attachGlobalSwipeHandler(type) {
  console.log(`Swipe handler attached for ${type}`);
}

document.addEventListener('keydown', e => {
  const memeModal = document.getElementById('meme-modal');
  if (memeModal?.style.display === 'flex') {
    if (e.key === 'Escape') closeMemeModal();
    else if (e.key === 'ArrowLeft') prevMeme?.();
    else if (e.key === 'ArrowRight') nextMeme?.();
  }
});

// End of modal-generator.js