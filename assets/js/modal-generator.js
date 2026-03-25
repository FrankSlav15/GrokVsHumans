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
    const genreSection = document.getElementById('genre-section');
    if (!genreSection) return;

    // SIMPLE & BULLETPROOF: if JSON has NO text in "genre" field → hide the WHOLE div completely
    if (!data.genre || data.genre.trim() === '') {
      genreSection.style.display = 'none';           // strongest hide
      // clear all inner text so nothing ever leaks from previous modal
      const header = genreSection.querySelector('.genre-header');
      const name = document.getElementById('genre-name');
      const count = document.getElementById('genre-count');
      if (header) header.textContent = '';
      if (name) name.textContent = '';
      if (count) count.textContent = '';
      currentGenreList = [];
      return;
    }

    // Otherwise we have a real genre → let renderGenreNav decide if we show it
    genreSection.style.display = '';   // reset to default (flex)
    if (typeof renderGenreNav === 'function') renderGenreNav(id);
  }
};