// assets/js/modal-generator.js
// Unified modal population + embedded thread emulator with \n support + robust avatar fetching (modernization branch)

function getLocalAvatar(post) {
  const username = post.username || post.user || post.avatar || post.author || '';
  if (!username) return '/assets/images/users/@unknown.webp';
  const clean = username.replace('@', '').toLowerCase().trim();
  return `/assets/images/users/@${clean}.webp`;
}

function renderCommonModalParts(data, pageType) {
  const modalImageEl = document.getElementById('modal-image');
  if (modalImageEl) {
    const isVideo = data.image.toLowerCase().match(/\.(mp4|webm|mov)$/i);
    modalImageEl.innerHTML = isVideo
      ? `<video id="modal-video" src="${data.image}" class="w-full max-h-[70vh] object-contain mx-auto" autoplay loop muted playsinline></video>`
      : `<img src="${data.image}" class="w-full max-h-[70vh] object-contain mx-auto" alt="${data.title}">`;
  }

  const titleEl = document.getElementById('modal-title');
  if (titleEl) titleEl.textContent = data.title || '';

  const xLinkEl = document.getElementById('base-x-link') || document.getElementById('modal-x-link');
  if (xLinkEl) xLinkEl.href = data.xLink || '#';

  const descEl = document.getElementById('modal-desc') || document.getElementById('modal-description');
  if (descEl) descEl.textContent = data.description || data.context || '';
}

function renderThread(threadPosts, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  let html = `<div class="thread-emulator mx-auto max-w-[620px] space-y-8">`;

  threadPosts.forEach((post) => {
    const isDeleted = post.deleted === true || !post.author;
    const avatarSrc = getLocalAvatar(post);

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
              <span class="font-semibold text-sm">${post.username || post.user || post.author || ''}</span>
              <span class="text-zinc-500 text-xs">${post.date || ''}</span>
            </div>
            <div class="thread-text text-[15px] leading-relaxed">${(post.text || '').replace(/\n/g, '<br>')}</div>

            ${post.linkedPost ? `
            <div class="mt-4 border border-zinc-700 rounded-3xl p-4 bg-zinc-950">
              <div class="flex items-center gap-2 mb-3">
                <img src="${getLocalAvatar(post.linkedPost)}" class="w-6 h-6 rounded-full" alt="">
                <span class="font-semibold text-sm">${post.linkedPost.username || post.linkedPost.author || ''}</span>
              </div>
              <div class="text-[15px] leading-relaxed">${(post.linkedPost.text || '').replace(/\n/g, '<br>')}</div>
              ${post.linkedPost.url ? `<a href="${post.linkedPost.url}" target="_blank" class="text-purple-400 text-xs mt-3 inline-block">View on X →</a>` : ''}
            </div>` : ''}

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