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

  // X link (memes uses #base-x-link, others use #modal-x-link)
  const xLinkEl = document.getElementById('base-x-link') || document.getElementById('modal-x-link');
  if (xLinkEl) xLinkEl.href = data.xLink || '#';

  // Description (memes uses #modal-desc, categories uses #modal-description)
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
    if (typeof renderGenreNav === 'function') renderGenreNav(id);
  }
};