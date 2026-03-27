// assets/js/modal-generator.js
// Unified modal population + thread emulator using users.json + restored tags + description (modernization branch)
// FIXED (Mar 27 2026): Video height breakout issue – videos now strictly respect container max-height (65vh desktop / 55vh mobile)
// Solution: Aggressive inline max-height:100% + Plyr wrapper forcing + multiple layout passes + min-height:0 on container
// This guarantees content NEVER overflows the parent container on ANY screen size, resolution, or genre switch.

let allUsers = null;

async function loadUsers() {
  if (allUsers) return allUsers;
  try {
    const res = await fetch('/assets/data/users.json');
    allUsers = await res.json();
  } catch (e) {
    console.warn('users.json not loaded, using fallbacks');
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
  // Media – FIXED: strict container-aware rendering + inline max-height enforcement
  const modalImageEl = document.getElementById('modal-image');
  if (modalImageEl) {
    const isVideo = data.image.toLowerCase().match(/\.(mp4|webm|mov)$/i);
    modalImageEl.innerHTML = isVideo
      ? `<video id="modal-video" src="${data.image}" class="w-full object-contain mx-auto" style="max-height:100% !important; height:auto !important; width:100% !important; object-fit:contain !important;" autoplay loop muted playsinline preload="metadata"></video>`
      : `<img src="${data.image}" class="w-full object-contain mx-auto" style="max-height:100% !important; height:auto !important; width:100% !important; object-fit:contain !important;" alt="${data.title}">`;
  }

  // Tags (above title)
  renderTags(data, pageType);

  // Title
  const titleEl = document.getElementById('modal-title');
  if (titleEl) titleEl.textContent = data.title || '';

  // X link
  const xLinkEl = document.getElementById('base-x-link') || document.getElementById('modal-x-link');
  if (xLinkEl) xLinkEl.href = data.xLink || '#';

  // Description – robust selector for all pages
  const descSelectors = ['modal-desc', 'modal-description', 'modal-description-text', '.modal-description'];
  let descEl = null;
  for (let sel of descSelectors) {
    descEl = document.getElementById(sel) || document.querySelector(sel);
    if (descEl) break;
  }
  if (descEl) {
    descEl.textContent = data.description || data.context || data.grok || data.human || '';
  }
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

    const displayNameHTML = rawUsername 
      ? `<a href="https://x.com/${rawUsername.replace('@','')}" target="_blank" class="text-[#c084fc] hover:underline">${displayName}${verifiedBadge}</a>` 
      : '';

    let textWithLinks = (post.text || '').replace(/\n/g, '<br>');
    textWithLinks = textWithLinks.replace(/@(\w+)/g, '<a href="https://x.com/$1" target="_blank" class="text-[#c084fc] hover:underline">@$1</a>');

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
              <span class="font-semibold text-sm">${displayNameHTML}</span>
              <span class="text-zinc-500 text-xs">${post.date || ''}</span>
            </div>
            <div class="thread-text text-[15px] leading-relaxed">${textWithLinks}</div>

            ${getYouTubeEmbed(post.image) ? `
            <div class="mt-4 aspect-video rounded-2xl overflow-hidden border border-zinc-700">
              <iframe width="100%" height="100%" src="${getYouTubeEmbed(post.image)}" 
                      title="YouTube video player" frameborder="0" 
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                      allowfullscreen></iframe>
            </div>` : ''}

            ${post.image && !getYouTubeEmbed(post.image) ? 
              (post.image.toLowerCase().match(/\.(mp4|webm|mov)$/) ? 
                `<video src="${post.image}" class="mt-4 w-full rounded-2xl block" controls preload="metadata" playsinline></video>` :
                `<img src="${post.image}" class="mt-4 rounded-2xl" alt="">`) : ''}

            ${post.linkedPost ? `
            <div class="mt-4 border border-zinc-700 rounded-3xl p-4 bg-zinc-950">
              <div class="flex items-center gap-2 mb-3">
                <img src="${getLocalAvatar(post.linkedPost)}" class="w-6 h-6 rounded-full" alt="">
                <span class="font-semibold text-sm">${post.linkedPost.username || post.linkedPost.author || ''}</span>
              </div>
              <div class="text-[15px] leading-relaxed">${(post.linkedPost.text || '').replace(/\n/g, '<br>')}</div>
              ${post.linkedPost.url ? `<a href="${post.linkedPost.url}" target="_blank" class="text-purple-400 text-xs mt-3 inline-block">View on X →</a>` : ''}
            </div>` : ''}
          `}
        </div>

        ${!isDeleted && post.author === 'grok' ? `<img src="${avatarSrc}" class="w-9 h-9 rounded-full flex-shrink-0 mt-1" alt="">` : ''}
      </div>`;
  });

  html += `</div>`;
  container.innerHTML = html;
}

// === UNIFIED MEME VIDEO HELPERS – THIS IS THE FIX FOR HEIGHT BREAKOUT ===
window.createModalMediaHTML = function(data) {
  const isVideo = data.image.toLowerCase().match(/\.(mp4|webm|mov)$/i);
  // CRITICAL: inline max-height:100% + object-fit:contain forces video to respect #modal-image container (65vh/55vh)
  // This overrides the browser's default "height:auto" (intrinsic size) that was causing breakout
  return isVideo
    ? `<video id="modal-video" src="${data.image}" class="w-full object-contain mx-auto" style="max-height:100% !important; height:auto !important; width:100% !important; object-fit:contain !important;" autoplay loop muted playsinline preload="metadata"></video>`
    : `<img src="${data.image}" class="w-full object-contain mx-auto" style="max-height:100% !important; height:auto !important; width:100% !important; object-fit:contain !important;" alt="${data.title}">`;
};

window.initPlyrSafely = function() {
  const videoEl = document.getElementById('modal-video');
  if (!videoEl) return;

  // Destroy any existing Plyr instance
  if (window.currentPlyr) {
    window.currentPlyr.destroy();
    window.currentPlyr = null;
  }

  const forceContainerHeight = () => {
    const container = document.getElementById('modal-image');
    if (!container) return;

    // 1. Force container itself to respect its own max-height (CSS + inline backup)
    container.style.maxHeight = '100%';
    container.style.minHeight = '0';
    container.style.flex = '0 0 auto';

    // 2. Force Plyr wrapper (the real culprit)
    const plyrWrapper = videoEl.closest('.plyr');
    if (plyrWrapper) {
      plyrWrapper.style.maxHeight = '100%';
      plyrWrapper.style.height = '100%';
      plyrWrapper.style.width = '100%';
      plyrWrapper.style.overflow = 'hidden';
    }

    // 3. Force the raw video element (overrides any height:auto)
    videoEl.style.maxHeight = '100%';
    videoEl.style.height = 'auto';
    videoEl.style.objectFit = 'contain';
    videoEl.style.width = '100%';
  };

  videoEl.onloadedmetadata = () => {
    window.currentPlyr = new Plyr('#modal-video', {
      controls: ['play-large','play','progress','current-time','mute','volume','fullscreen'],
      autoplay: true,
      muted: true,
      loop: true,
      playsinline: true,
      clickToPlay: true,
      hideControls: false
    });

    // Multiple forced layout passes – guarantees it works even on genre switch or slow networks
    setTimeout(forceContainerHeight, 0);
    setTimeout(forceContainerHeight, 30);
    setTimeout(forceContainerHeight, 120);
    setTimeout(forceContainerHeight, 300);
    setTimeout(forceContainerHeight, 600);
  };

  // Immediate trigger if metadata is already loaded
  if (videoEl.readyState >= 1) videoEl.onloadedmetadata();
};

window.forceFitVideo = function() {
  const container = document.getElementById('modal-image');
  if (!container) return;
  const media = container.querySelector('video, img');
  if (media) {
    media.style.maxHeight = '100%';
    media.style.height = 'auto';
    media.style.objectFit = 'contain';
    media.style.width = '100%';
  }
};

window.populateModal = async function(pageType, id, data) {
  await loadUsers();                     // ensure users.json is loaded once
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