// assets/js/card-generator.js
function generateMediaHTML(imageUrl) {
  if (!imageUrl) return '<div class="card__media"><div class="w-full h-56 bg-zinc-800 flex items-center justify-center text-zinc-500 text-sm">No media</div></div>';
  const lower = imageUrl.toLowerCase();
  const isVideo = lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mov');
  if (isVideo) {
    return `<div class="card__media video-card"><video src="${imageUrl}" class="w-full h-full object-cover" loop muted playsinline preload="metadata"></video></div>`;
  }
  return `<div class="card__media"><img src="${imageUrl}" loading="lazy" class="w-full h-full object-cover" alt="Preview"></div>`;
}

function renderCardTags(data) {
  const tagMap = { 'grok-memes': "Grok Memes", 'political-memes': "Political Memes", 'misc-memes': "Miscellaneous Memes", gifs: "GIFs", 'ai-tech': "AI Meme Tech", videos: "Videos", other: "Other" };
  const tagsHTML = (data.tags || '').split(',').map(t => {
    const trimmed = t.trim();
    const label = tagMap[trimmed] || trimmed;
    return `<span class="px-3 py-0.5 bg-purple-900/80 text-purple-200 text-[10px] rounded-full">${label}</span>`;
  }).join('');
  return tagsHTML ? `<div class="tags-area px-6 pt-3 pb-1 min-h-[28px] max-h-[56px] overflow-hidden flex flex-wrap gap-1">${tagsHTML}</div>` : '';
}

window.createContentCard = function(pageType, id, data) {
  const mediaHTML = generateMediaHTML(data.image);
  const shortDesc = (data.description || data.context || '').substring(0, 160);
  const tagsHTML = renderCardTags(data);
  const modalOpener = pageType === 'battles' ? 'openBattleModal' : pageType === 'categories' ? 'openCategoryModal' : 'openMemeModal';
  const cardClass = pageType === 'memes' ? 'card card--meme' : pageType === 'battles' ? 'card card--battle' : 'card card--category';

  return `<div onclick="${modalOpener}('${id}')" class="${cardClass}" data-categories="${(data.tags || '').split(',').map(t => t.trim()).join(',')}" data-id="${id}">
    ${mediaHTML}
    <div class="card__content">
      ${tagsHTML}
      <h3 class="card__title">${data.title || ''}</h3>
      <p class="card__description">${shortDesc}</p>
    </div>
  </div>`;
};

window.renderMemeGrid = function() {
  const grid = document.getElementById('meme-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const visibleIds = new Set();
  const genreMap = new Map();
  Object.keys(window.allMemes || {}).forEach(id => {
    const m = window.allMemes[id];
    if (!m.genre || m.genre.trim() === '') visibleIds.add(id);
    else if (!genreMap.has(m.genre) || (window.allMemes[genreMap.get(m.genre)].order || 0) < (m.order || 0)) genreMap.set(m.genre, id);
  });
  genreMap.forEach(id => visibleIds.add(id));
  Array.from(visibleIds)
    .sort((a,b) => (window.allMemes[b].order || 0) - (window.allMemes[a].order || 0))
    .forEach(id => grid.insertAdjacentHTML('beforeend', createContentCard('memes', id, window.allMemes[id])));
};

window.renderBattleGrid = function() {
  const grid = document.getElementById('battle-grid');
  if (!grid) return;
  grid.innerHTML = '';
  Object.keys(window.allBattles || {})
    .sort((a,b) => (window.allBattles[b].order || 0) - (window.allBattles[a].order || 0))
    .forEach(id => grid.insertAdjacentHTML('beforeend', createContentCard('battles', id, window.allBattles[id])));
  Object.keys(window.allBattles || {}).forEach(id => { if (typeof updateGridVoteUI === 'function') updateGridVoteUI(id); });
};

window.renderCategoryGrid = function() {
  const grid = document.getElementById('category-grid');
  if (!grid) return;
  grid.innerHTML = '';
  Object.keys(window.allCategories || {})
    .sort((a,b) => (window.allCategories[b].order || 0) - (window.allCategories[a].order || 0))
    .forEach(id => grid.insertAdjacentHTML('beforeend', createContentCard('categories', id, window.allCategories[id])));
  };

window.filterCategory = function(cat) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('tab-active'));
  const activeTab = document.getElementById('tab-' + cat);
  if (activeTab) activeTab.classList.add('tab-active');

  const gridId = document.body.getAttribute('data-page') === 'battles' ? 'battle-grid' : document.body.getAttribute('data-page') === 'categories' ? 'category-grid' : 'meme-grid';
  document.querySelectorAll(`#${gridId} > div`).forEach(card => {
    const cats = (card.getAttribute('data-categories') || '').split(',').map(c => c.trim());
    card.style.display = (cat === 'all' || cats.includes(cat)) ? 'block' : 'none';
  });
};