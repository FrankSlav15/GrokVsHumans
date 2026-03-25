// assets/js/modal-generator.js
// Unified modal population + common helpers
// (modernization branch)

function renderCommonModalParts(data, pageType) {
  // Media
  const modalImageEl = document.getElementById('modal-image');
  if (modalImageEl) {
    const isVideo = data.image.toLowerCase().match(/\.(mp4|webm|mov)$/i);
    modalImageEl.innerHTML = isVideo
      ? `<video id="modal-video" src="${data.image}" class="w-full max-h-[70vh] object-contain mx-auto" autoplay loop muted playsinline></video>`
      : `<img src="${data.image}" class="w-full max-h-[70vh] object-contain mx-auto" alt="${data.title}">`;
  }

  // Tags
  const tagMap = pageType === 'battles'
    ? { nonsense: "Nonsense", political: "Political", serious: "Now, In All Seriousness", citation: "(UN)Popular Citations", joke: "Joke Battles", censorship: "Conspiracy 1984" }
    : pageType === 'categories'
    ? { lazy: "Grok, Think For Me", politics: "Politics", photo: "Photo Requests", opinion: "Grok's Opinion", avoids: "Grok Avoids Request", other: "Miscellaneous" }
    : { 'grok-memes': "Grok Memes", 'political-memes': "Political Memes", 'misc-memes': "Miscellaneous Memes", gifs: "GIFs", 'ai-tech': "AI Meme Tech", videos: "Videos", other: "Other" };

  const tagsHTML = (data.tags || '').split(',').map(t => {
    const trimmed = t.trim();
    return `<span class="px-4 py-1 bg-purple-900/70 text-purple-200 text-xs rounded-full">${tagMap[trimmed] || trimmed}</span>`;
  }).join('');

  const tagsEl = document.getElementById('modal-tags');
  if (tagsEl) tagsEl.innerHTML = tagsHTML;

  // Title + X link
  const titleEl = document.getElementById('modal-title');
  if (titleEl) titleEl.textContent = data.title || '';

  const xLinkEl = document.getElementById('modal-x-link') || document.getElementById('base-x-link');
  if (xLinkEl) xLinkEl.href = data.xLink || '#';
}

window.populateModal = function(pageType, id, data) {
  renderCommonModalParts(data, pageType);

  if (pageType === 'battles') {
    if (typeof renderThread === 'function') renderThread(data.threadPosts || [], "thread-container");
  } else if (pageType === 'categories') {
    if (typeof embedXThread === 'function') embedXThread(data.conversationUrl || data.xLink);
    const descEl = document.getElementById('modal-description');
    if (descEl) descEl.textContent = data.description || '';
  } else if (pageType === 'memes') {
    if (typeof renderGenreNav === 'function') renderGenreNav(id);
    const descEl = document.getElementById('modal-desc');
    if (descEl) descEl.textContent = data.description || data.context || '';
  }
};