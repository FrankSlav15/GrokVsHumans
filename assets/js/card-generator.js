// assets/js/card-generator.js
// MODERNIZATION: Single unified card generator + renderGrid for ALL pages + battles voting

function generateMediaHTML(imageUrl, pageType) {
  if (!imageUrl) return '<div class="w-full h-[17rem] bg-zinc-800 flex items-center justify-center text-zinc-500 text-sm">No media</div>';
  const lower = imageUrl.toLowerCase();
  const isVideo = lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mov');
  if (isVideo) {
    const heightClass = pageType === 'categories' ? 'h-[17rem]' : 'aspect-video';
    const extraClass = pageType === 'memes' ? 'video-card' : '';
    return `<div class="${heightClass} ${extraClass}" style="background:#18181b;"><video src="${imageUrl}" class="w-full h-full object-cover" loop muted playsinline preload="metadata"></video></div>`;
  }
  const heightClass = pageType === 'categories' ? 'h-[17rem]' : 'h-56';
  return `<img src="${imageUrl}" loading="lazy" class="w-full ${heightClass} object-cover" alt="Preview">`;
}

function getShortDescription(data, pageType) {
  let desc = '';
  if (pageType === 'battles') desc = data.description || data.grok || data.human || '';
  else if (pageType === 'categories') desc = data.description || '';
  else if (pageType === 'memes') desc = data.description || data.context || '';
  return (desc || '').substring(0, 160);
}

function getCardFooter(pageType, id) {
  if (pageType === 'battles') {
    return `<div class="buttons flex"><button id="grok-btn-${id}" onclick="vote(event, 'grok', ${id}); event.stopImmediatePropagation();" class="flex-1 py-3 sm:py-4 bg-purple-800 hover:bg-purple-950 text-white font-semibold text-sm sm:text-base">Grok Won</button><button id="human-btn-${id}" onclick="vote(event, 'human', ${id}); event.stopImmediatePropagation();" class="flex-1 py-3 sm:py-4 bg-rose-800 hover:bg-rose-950 text-white font-semibold text-sm sm:text-base">Human Won</button></div>`;
  }
  return '';
}

function renderCardTags(data, pageType) {
  const tagMap = pageType === 'battles' ? { nonsense: "Nonsense", political: "Political", serious: "Now, In All Seriousness", citation: "(UN)Popular Citations", joke: "Joke Battles", censorship: "Conspiracy 1984" } : pageType === 'categories' ? { lazy: "Grok, Think For Me", politics: "Politics", photo: "Photo Requests", opinion: "Grok's Opinion", avoids: "Grok Avoids Request", other: "Miscellaneous" } : { 'grok-memes': "Grok Memes", 'political-memes': "Political Memes", 'misc-memes': "Miscellaneous Memes", gifs: "GIFs", 'ai-tech': "AI Meme Tech", videos: "Videos", other: "Other" };
  const tagsHTML = (data.tags || '').split(',').map(t => {
    const trimmed = t.trim();
    const label = tagMap[trimmed] || trimmed;
    return `<span class="px-3 py-0.5 bg-purple-900/80 text-purple-200 text-[10px] rounded-full">${label}</span>`;
  }).join('');
  return tagsHTML ? `<div class="tags-area px-6 pt-3 pb-1 min-h-[28px] max-h-[56px] overflow-hidden flex flex-wrap gap-1">${tagsHTML}</div>` : '<div class="tags-area px-6 pt-3 pb-1 min-h-[28px]"></div>';
};

window.createContentCard = function(pageType, id, data) {
  const mediaHTML = generateMediaHTML(data.image, pageType);
  const shortDesc = getShortDescription(data, pageType);
  const footerHTML = getCardFooter(pageType, id);
  const tagsHTML = renderCardTags(data, pageType);
  const modalOpener = pageType === 'battles' ? 'openBattleModal' : pageType === 'categories' ? 'openCategoryModal' : 'openMemeModal';
  const baseClass = pageType === 'battles' ? 'battle-card' : pageType === 'categories' ? 'category-card' : 'meme-card';

  return `<div onclick="${modalOpener}('${id}')" class="${baseClass} rounded-3xl overflow-hidden block cursor-pointer flex flex-col h-full" data-categories="${(data.tags || '').split(',').map(t => t.trim()).join(',')}" data-id="${id}">${mediaHTML}<div class="content flex-1 flex flex-col">${tagsHTML}<div class="title-area h-[52px] flex items-center px-6"><h4 class="font-semibold text-lg leading-tight line-clamp-2">${data.title || ''}</h4></div><div class="desc-area flex-1 px-6 pb-4"><p class="text-gray-400 text-sm line-clamp-4">${shortDesc}</p></div></div>${footerHTML}</div>`;
};

// ====================== RENDER GRIDS (called by common.js initPage) ======================
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

// Shared filter (works on all pages)
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