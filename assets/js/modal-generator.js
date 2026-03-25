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

window.populateModal = function(pageType, id, data) {
  renderCommonModalParts(data, pageType);

  if (pageType === 'battles') {
    if (typeof renderThread === 'function') renderThread(data.threadPosts || [], "thread-container");
  } else if (pageType === 'categories') {
    if (typeof renderThread === 'function') renderThread(data.threadPosts || [], "thread-container");
  } else if (pageType === 'memes') {
    // STRICT GENRE CHECK — only show section if JSON has a real non-blank genre
    const genreSection = document.getElementById('genre-section');
    if (genreSection) {
      if (!data.genre || data.genre.trim() === '') {
        genreSection.classList.add('hidden');
      } else {
        if (typeof renderGenreNav === 'function') renderGenreNav(id);
      }
    }
  }
};