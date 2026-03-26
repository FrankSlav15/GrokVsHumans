// assets/js/modal-generator.js
// Unified modal population + embedded thread emulator (modernization branch)

function getLocalAvatar(username) {
  if (!username) return '/assets/images/users/@unknown.webp';
  const clean = username.replace('@', '').toLowerCase().trim();
  return `/assets/images/users/@${clean}.webp`;
}

function renderCommonModalParts(data, pageType) {
  // Media
  const modalImageEl = document.getElementById('modal-image');
  if (modalImageEl) {
    const isVideo = data.image.toLowerCase().match(/\.(mp4|webm|mov)$/i);
    modalImageEl.innerHTML = isVideo
      ? `<video id="modal-video" src="${data.image}" class="w-full max-h-[70vh] object-contain mx-auto" autoplay loop muted playsinline></video>`
      : `<img src="${data.image}" class="w-full max-h-[70vh] object-contain mx-auto" alt="${data.title}">`;
  }

  // Title
  const titleEl = document.getElementById('modal-title');
  if (titleEl) titleEl.textContent = data.title || '';

  // X link
  const xLinkEl = document.getElementById('base-x-link') || document.getElementById('modal-x-link');
  if (xLinkEl) xLinkEl.href = data.xLink || '#';

  // Description
  const descEl = document.getElementById('modal-desc') || document.getElementById('modal-description');
  if (descEl) descEl.textContent = data.description || data.context || '';
}

function renderThread(threadPosts, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  let html = `<div class="thread-emulator mx-auto max-w-[620px] space-y-8">`;

  threadPosts.forEach((post, i) => {
    const isDeleted = post.deleted === true || !post.author;
    const username = post.username || '@unknown';
    const avatarSrc = getLocalAvatar(username);

    html += `
      <div class="thread-post flex gap-3 ${post.author === 'grok' ? 'justify-end' : 'justify-start'}">
        ${!isDeleted && post.author !== 'grok' ? `<img src="${avatarSrc}" class="w-9 h-9 rounded-full flex-shrink-0 mt-1" alt="">` : ''}
        
        <div class="${post.author === 'grok' ? 'grok-bubble' : 'human-bubble'} max-w-[85%] p-5 rounded-3xl">
          ${isDeleted ? `
            <div class="deleted-post bg-[#27272a] text-[#71717a] p-4 rounded-2xl text-sm">
              This Post is from an account that no longer exists. 
              <a href="https://help.twitter.com/rules-and-policies/notices-on-twitter" class="text-[#a855f7] underline">Learn more</a>
            </div>
          ` : `
            <div class="flex items-center gap-2 mb-2">
              <span class="font-semibold text-sm">${post.username}</span>
              <span class="text-zinc-500 text-xs">${post.date || post.timestamp ? new Date(post.timestamp || post.date).toLocaleDateString() : ''}</span>
            </div>
            <div class="thread-text text-[15px] leading-relaxed">${post.text || ''}</div>
            ${post.image ? `<img src="${post.image}" class="mt-4 rounded-2xl" alt="">` : ''}
          `}
        </div>
        
        ${!isDeleted && post.author === 'grok' ? `<img src="${avatarSrc}" class="w-9 h-9 rounded-full flex-shrink-0 mt-1" alt="">` : ''}
      </div>`;
  });

  html += `</div>`;
  container.innerHTML = html;
}

window.populateModal = function(pageType, id, data) {
  renderCommonModalParts(data, pageType);

  if (pageType === 'battles' || pageType === 'categories') {
    if (typeof renderThread === 'function') {
      renderThread(data.threadPosts || [], "thread-container");
    }
  } else if (pageType === 'memes') {
    const genreSection = document.getElementById('genre-section');
    if (genreSection) {
      if (!data.genre || data.genre.trim() === '') {
        genreSection.style.display = 'none';
        const header = genreSection.querySelector('.genre-header');
        const name = document.getElementById('genre-name');
        const count = document.getElementById('genre-count');
        if (header) header.textContent = '';
        if (name) name.textContent = '';
        if (count) count.textContent = '';
      } else {
        genreSection.style.display = '';
        if (typeof renderGenreNav === 'function') renderGenreNav(id);
      }
    }
  }
};