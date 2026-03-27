// assets/js/modal-generator.js
// MODERNIZATION BRANCH – FULL FILE, swipe fixed for mobile, video containment for memes page

let allUsers = null;

async function loadUsers() {
  if (allUsers) return allUsers;
  try {
    const res = await fetch('/assets/data/users.json');
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

function renderTags(data, pageType) {
  const tagMap = pageType === 'battles'
    ? { nonsense: "Nonsense", political: "Political", serious: "Now, In All Seriousness", citation: "(UN)Popular Citations", joke: "Joke Battles", censorship: "Conspiracy 1984" }
    : pageType === 'categories'
    ? { lazy: "Grok, Think For Me", politics: "Politics", photo: "Photo Requests", opinion: "Grok's Opinion", avoids: "Grok Avoids Request", other: "Miscellaneous" }
    : { 'grok-memes': "Grok Memes", 'political-memes': "Political Memes", 'misc-memes': "Miscellaneous Memes", gifs: "GIFs", 'ai-tech': "AI Meme Tech", videos: "Videos", other: "Other" };

  const tagsHTML = (data.tags || '').split(',').map(t => {
    const trimmed = t.trim();
    const label = tagMap[trimmed] || trimmed;
    return `<span class="px-4 py-1 bg-purple-900/70 text-purple-200 text-xs rounded-full">${label}</span>`;
  }).join('');

  const tagsEl = document.getElementById('modal-tags');
  if (tagsEl) tagsEl.innerHTML = tagsHTML;
}

function renderCommonModalParts(data, pageType) {
  const modalImageEl = document.getElementById('modal-image');
  if (modalImageEl) {
    const isVideo = data.image.toLowerCase().match(/\.(mp4|webm|mov)$/i);
    modalImageEl.innerHTML = isVideo
      ? `<video id="modal-video" src="${data.image}" class="w-full object-contain mx-auto" style="max-height:100% !important;height:auto !important;width:100% !important;object-fit:contain !important;" autoplay loop muted playsinline preload="metadata" controls></video>`
      : `<img src="${data.image}" class="w-full object-contain mx-auto" style="max-height:100% !important;height:auto !important;width:100% !important;object-fit:contain !important;" alt="${data.title}">`;
  }

  renderTags(data, pageType);

  const titleEl = document.getElementById('modal-title');
  if (titleEl) titleEl.textContent = data.title || '';

  const xLinkEl = document.getElementById('base-x-link') || document.getElementById('modal-x-link');
  if (xLinkEl) xLinkEl.href = data.xLink || '#';

  const descSelectors = ['modal-desc', 'modal-description', 'modal-description-text', '.modal-description'];
  let descEl = null;
  for (let sel of descSelectors) {
    descEl = document.getElementById(sel) || document.querySelector(sel);
    if (descEl) break;
  }
  if (descEl) descEl.textContent = data.description || data.context || data.grok || data.human || '';
}

function renderThread(threadPosts, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  let html = `<div class="thread-emulator mx-auto max-w-[620px] space-y-8">`;
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
    html += `<div class="thread-post flex gap-3 ${post.author === 'grok' ? 'justify-end' : 'justify-start'}">${!isDeleted && post.author !== 'grok' ? `<img src="${avatarSrc}" class="w-9 h-9 rounded-full flex-shrink-0 mt-1" alt="">` : ''}<div class="${post.author === 'grok' ? 'grok-bubble' : 'human-bubble'} max-w-[85%] p-5 rounded-3xl">${isDeleted ? `<div class="deleted-post bg-[#27272a] text-[#71717a] p-4 rounded-2xl text-sm">This Post is from an account that no longer exists. <a href="https://help.twitter.com/rules-and-policies/notices-on-twitter" class="text-[#a855f7] underline">Learn more</a></div>` : `<div class="flex items-center gap-2 mb-2"><span class="font-semibold text-sm">${displayNameHTML}</span><span class="text-zinc-500 text-xs">${post.date || ''}</span></div><div class="thread-text text-[15px] leading-relaxed">${textWithLinks}</div>${getYouTubeEmbed(post.image) ? `<div class="mt-4 aspect-video rounded-2xl overflow-hidden border border-zinc-700"><iframe width="100%" height="100%" src="${getYouTubeEmbed(post.image)}" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>` : ''}${post.image && !getYouTubeEmbed(post.image) ? (post.image.toLowerCase().match(/\.(mp4|webm|mov)$/) ? `<video src="${post.image}" class="mt-4 w-full rounded-2xl block" controls preload="metadata" playsinline></video>` : `<img src="${post.image}" class="mt-4 rounded-2xl" alt="">`) : ''}`}</div>${!isDeleted && post.author === 'grok' ? `<img src="${avatarSrc}" class="w-9 h-9 rounded-full flex-shrink-0 mt-1" alt="">` : ''}</div>`;
  });
  html += `</div>`;
  container.innerHTML = html;
}

window.createModalMediaHTML = function(data) {
  const isVideo = data.image.toLowerCase().match(/\.(mp4|webm|mov)$/i);
  return isVideo
    ? `<video id="modal-video" src="${data.image}" class="w-full object-contain mx-auto" style="max-height:100% !important;height:auto !important;width:100% !important;object-fit:contain !important;" autoplay loop muted playsinline preload="metadata" controls></video>`
    : `<img src="${data.image}" class="w-full object-contain mx-auto" style="max-height:100% !important;height:auto !important;width:100% !important;object-fit:contain !important;" alt="${data.title}">`;
};

window.initPlyrSafely = function() {
  const videoEl = document.getElementById('modal-video');
  if (!videoEl) return;
  if (window.currentPlyr) { window.currentPlyr.destroy(); window.currentPlyr = null; }

  const force = () => {
    const container = document.getElementById('modal-image');
    if (!container) return;
    container.style.maxHeight = '100%';
    container.style.minHeight = '0';
    container.style.flex = '0 0 auto';
    container.style.overflow = 'hidden';
    const plyr = videoEl.closest('.plyr');
    if (plyr) { plyr.style.maxHeight = '100%'; plyr.style.height = '100%'; plyr.style.width = '100%'; plyr.style.overflow = 'hidden'; }
    videoEl.style.maxHeight = '100%';
    videoEl.style.height = 'auto';
    videoEl.style.objectFit = 'contain';
    videoEl.style.width = '100%';
  };

  videoEl.onloadedmetadata = () => {
    window.currentPlyr = new Plyr('#modal-video', { controls: ['play-large','play','progress','current-time','mute','volume','fullscreen'], autoplay: true, muted: true, loop: true, playsinline: true, clickToPlay: true, hideControls: false });
    setTimeout(force, 0); setTimeout(force, 30); setTimeout(force, 120); setTimeout(force, 300);
  };
  if (videoEl.readyState >= 1) videoEl.onloadedmetadata();
};

window.populateModal = async function(pageType, id, data) {
  await loadUsers();
  renderCommonModalParts(data, pageType);

  if (pageType === 'battles' || pageType === 'categories') {
    if (typeof renderThread === 'function') renderThread(data.threadPosts || [], "thread-container");
  } else if (pageType === 'memes') {
    const genreSection = document.getElementById('genre-section');
    if (genreSection) {
      genreSection.style.display = (!data.genre || data.genre.trim() === '') ? 'none' : '';
      if (typeof renderGenreNav === 'function') renderGenreNav(id);
    }
  }
};

// ====================== SWIPE HANDLERS (mobile-optimized) ======================
function attachGlobalSwipeHandler(pageType) {
  const modalId = pageType === 'memes' ? 'meme-modal' : pageType === 'battles' ? 'battle-modal' : 'category-modal';
  const modal = document.getElementById(modalId);
  if (!modal) return;

  modal.removeEventListener('touchstart', modal._swipeStart);
  modal.removeEventListener('touchend', modal._swipeEnd);

  let touchStartX = 0;
  modal._swipeStart = (e) => { touchStartX = e.changedTouches[0].screenX; };
  modal._swipeEnd = (e) => {
    const diff = touchStartX - e.changedTouches[0].screenX;
    if (Math.abs(diff) < 80) return;
    if (diff > 0) window[`prev${pageType.charAt(0).toUpperCase() + pageType.slice(1)}`]?.();
    else window[`next${pageType.charAt(0).toUpperCase() + pageType.slice(1)}`]?.();
  };

  modal.addEventListener('touchstart', modal._swipeStart, { passive: true });
  modal.addEventListener('touchend', modal._swipeEnd, { passive: true });
}

function attachGenreVerticalSwipe() {
  const modalImage = document.getElementById('modal-image');
  if (!modalImage) return;

  modalImage.removeEventListener('touchstart', modalImage._verticalStart);
  modalImage.removeEventListener('touchend', modalImage._verticalEnd);

  let touchStartY = 0;
  modalImage._verticalStart = (e) => { touchStartY = e.changedTouches[0].screenY; };
  modalImage._verticalEnd = (e) => {
    if (!window.currentMemeId) return;
    const diffY = touchStartY - e.changedTouches[0].screenY;
    if (Math.abs(diffY) > 60) {
      if (window.currentGenreList && window.currentGenreList.length) {
        if (diffY > 0) prevGenreMeme();
        else nextGenreMeme();
      }
    }
  };

  modalImage.addEventListener('touchstart', modalImage._verticalStart, { passive: true });
  modalImage.addEventListener('touchend', modalImage._verticalEnd, { passive: true });
}

// ====================== BATTLES ======================
window.openBattleModal = function(id) {
  const data = window.allBattles[id];
  if (!data) return;
  window.currentBattleId = id;
  window.currentBattleIndex = id;
  populateModal('battles', id, data);
  const modal = document.getElementById('battle-modal');
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  updateModalVoteUI();
  const url = (data.image || '').toLowerCase();
  if (url.match(/\.(mp4|webm|mov|ogg|gif)$/)) initPlyrSafely();
  attachGlobalSwipeHandler('battles');
};

window.closeModal = function() {
  if (window.currentPlyr) { window.currentPlyr.pause(); window.currentPlyr.destroy(); window.currentPlyr = null; }
  const modal = document.getElementById('battle-modal');
  modal.classList.add('hidden');
  document.body.style.overflow = 'visible';
  if (window.currentBattleId) updateGridVoteUI(window.currentBattleId);
  window.currentBattleId = null;
};

window.vote = function(event, winner, id) {
  event.stopImmediatePropagation();
  event.preventDefault();
  const votedKey = 'voted_' + id;
  if (localStorage.getItem(votedKey)) { window.showToast("You've already voted on this battle! 🏆"); return; }
  const ref = database.ref('battles/' + id);
  ref.transaction(current => {
    if (current === null) current = { grok: 0, human: 0 };
    if (winner === 'grok') current.grok = (current.grok || 0) + 1;
    else current.human = (current.human || 0) + 1;
    return current;
  });
  localStorage.setItem(votedKey, 'true');
  window.showToast(`You voted for ${winner.toUpperCase()}! 🏆`);
  if (typeof updateGridVoteUI === 'function') updateGridVoteUI(id);
  if (window.currentBattleId === id) updateModalVoteUI();
};

window.updateGridVoteUI = function(id) {
  const grokBtn = document.getElementById('grok-btn-' + id);
  const humanBtn = document.getElementById('human-btn-' + id);
  if (!grokBtn || !humanBtn) return;
  const hasVoted = !!localStorage.getItem('voted_' + id);
  database.ref('battles/' + id).once('value', (snapshot) => {
    const data = snapshot.val() || { grok: 0, human: 0 };
    if (hasVoted) {
      grokBtn.innerHTML = `Grok <span class="mx-4 text-2xl font-bold">${data.grok}</span>`;
      humanBtn.innerHTML = `<span class="mx-4 text-2xl font-bold">${data.human}</span> Human`;
    } else {
      grokBtn.textContent = 'Grok Won';
      humanBtn.textContent = 'Human Won';
    }
  });
};

window.voteFromModal = function(event, winner) {
  event.stopImmediatePropagation();
  if (window.currentBattleId) vote(event, winner, window.currentBattleId);
};

window.updateModalVoteUI = function() {
  if (!window.currentBattleId) return;
  const id = window.currentBattleId;
  const hasVoted = !!localStorage.getItem('voted_' + id);
  const grokBtn = document.getElementById('modal-grok-btn');
  const humanBtn = document.getElementById('modal-human-btn');
  if (hasVoted) {
    database.ref('battles/' + id).once('value', (snapshot) => {
      const data = snapshot.val() || { grok: 0, human: 0 };
      grokBtn.innerHTML = `Grok <span class="mx-4 text-2xl font-bold">${data.grok}</span>`;
      humanBtn.innerHTML = `<span class="mx-4 text-2xl font-bold">${data.human}</span> Human`;
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

// ====================== CATEGORIES ======================
window.openCategoryModal = function(id) {
  window.currentCategoryIndex = id;
  const data = window.allCategories[id];
  if (!data) return;
  window.currentCategoryId = id;
  populateModal('categories', id, data);
  document.getElementById('category-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  attachGlobalSwipeHandler('categories');
};

window.closeCategoryModal = function() {
  document.getElementById('category-modal').classList.add('hidden');
  document.body.style.overflow = 'visible';
};

// ====================== MEMES ======================
window.openMemeModal = function(id) {
  window.currentMemeIndex = id;
  const data = window.allMemes[id];
  if (!data) return;
  window.currentMemeId = id;
  populateModal('memes', id, data);

  const mediaContainer = document.getElementById('modal-image');
  mediaContainer.innerHTML = createModalMediaHTML(data);

  const mediaEl = mediaContainer.querySelector('img, video');
  if (mediaEl) {
    mediaEl.classList.remove('max-h-[70vh]');
    mediaEl.style.maxHeight = '100%';
  }

  if (data.image.toLowerCase().match(/\.(mp4|webm)$/)) initPlyrSafely();

  document.getElementById('modal-desc').textContent = data.description || data.context || '';
  document.getElementById('base-x-link').href = data.xLink || '#';
  document.getElementById('context-panel').style.display = 'none';
  document.getElementById('modal-buttons').style.display = 'flex';
  document.getElementById('meme-modal').style.display = 'flex';
  document.body.style.overflow = 'hidden';

  renderGenreNav(id);
  attachGlobalSwipeHandler('memes');
  setTimeout(attachGenreVerticalSwipe, 100);
};

window.closeMemeModal = function() {
  if (window.currentPlyr) { window.currentPlyr.pause(); window.currentPlyr.destroy(); window.currentPlyr = null; }
  document.getElementById('modal-image').innerHTML = '';
  document.getElementById('meme-modal').style.display = 'none';
  document.body.style.overflow = 'visible';
};

window.renderGenreNav = function(currentId) {
  const section = document.getElementById('genre-section');
  if (!section) return;
  const current = window.allMemes[currentId];
  if (!current || !current.genre || current.genre.trim() === '') {
    section.classList.add('hidden');
    window.currentGenreList = [];
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
    window.currentGenreList = [];
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
  const mediaEl = mediaContainer.querySelector('img, video');
  if (mediaEl) {
    mediaEl.classList.remove('max-h-[70vh]');
    mediaEl.style.maxHeight = '100%';
  }
  if (data.image.toLowerCase().match(/\.(mp4|webm)$/)) initPlyrSafely();
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

window.nextMeme = function() {
  const keys = window.getMemeKeys();
  let pos = keys.indexOf(window.currentMemeIndex);
  if (pos === -1) pos = 0;
  const currentGenre = window.allMemes[window.currentMemeIndex]?.genre || '';
  let attempts = 0;
  while (attempts < keys.length) {
    pos = (pos + 1) % keys.length;
    const nextId = keys[pos];
    const nextGenre = window.allMemes[nextId]?.genre || '';
    if (currentGenre === '' || nextGenre !== currentGenre) {
      window.currentMemeIndex = nextId;
      closeMemeModal();
      setTimeout(() => openMemeModal(window.currentMemeIndex), 280);
      return;
    }
    attempts++;
  }
};

window.prevMeme = function() {
  const keys = window.getMemeKeys();
  let pos = keys.indexOf(window.currentMemeIndex);
  if (pos === -1) pos = 0;
  const currentGenre = window.allMemes[window.currentMemeIndex]?.genre || '';
  let attempts = 0;
  while (attempts < keys.length) {
    pos = (pos - 1 + keys.length) % keys.length;
    const prevId = keys[pos];
    const prevGenre = window.allMemes[prevId]?.genre || '';
    if (currentGenre === '' || prevGenre !== currentGenre) {
      window.currentMemeIndex = prevId;
      closeMemeModal();
      setTimeout(() => openMemeModal(window.currentMemeIndex), 280);
      return;
    }
    attempts++;
  }
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
  const shareUrl = `${baseUrl}#${window.currentMemeId}`;
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

// ====================== SHARED NAV HELPERS ======================
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

// Keyboard support (kept for desktop)
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