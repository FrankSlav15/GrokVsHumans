// assets/js/card-generator.js
// CLEAN REWRITE – BEM only, no Tailwind, nice display names for pills

function generateMediaHTML(imageUrl, pageType) {
  if (!imageUrl) return '<div class="card__media"><div class="flex items-center justify-center h-full bg-[#27272a] text-zinc-500 text-sm">No media</div></div>';
  
  const lower = imageUrl.toLowerCase();
  const isVideo = lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mov');
  
  if (isVideo) {
    return `<div class="card__media"><video src="${imageUrl}" class="w-full h-full object-cover" loop muted playsinline preload="metadata"></video></div>`;
  }
  
  return `<div class="card__media"><img src="${imageUrl}" loading="lazy" class="w-full h-full object-cover" alt="Preview"></div>`;
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
    return `<div class="flex border-t border-[#27272a] rounded-b-3xl overflow-hidden">
      <button id="grok-btn-${id}" onclick="voteFromModal(event, 'grok', ${id});" class="flex-1 py-5 bg-[#6b21a8] text-white font-semibold text-base">Grok Won</button>
      <button id="human-btn-${id}" onclick="voteFromModal(event, 'human', ${id});" class="flex-1 py-5 bg-[#9f1239] text-white font-semibold text-base">Human Won</button>
    </div>`;
  }
  return '';
}

function renderCardTags(data, pageType) {
  const tagMap = {
    // categories
    lazy: "Grok, Think For Me",
    politics: "Politics",
    photo: "Photo Requests",
    opinion: "Grok's Opinion",
    avoids: "Grok Avoids Request",
    other: "Miscellaneous",
    // battles
    nonsense: "Nonsense",
    political: "Political",
    serious: "Now, In All Seriousness",
    citation: "(UN)Popular Citations",
    joke: "Joke Battles",
    censorship: "Conspiracy 1984",
    // memes
    'grok-memes': "Grok Memes",
    'political-memes': "Political Memes",
    'misc-memes': "Miscellaneous Memes",
    gifs: "GIFs",
    'ai-tech': "AI Meme Tech",
    videos: "Videos"
  };

  const tags = (data.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  const html = tags.map(tag => {
    const label = tagMap[tag] || tag;
    return `<span class="px-3 py-0.5 bg-purple-900/80 text-purple-200 text-xs rounded-full">${label}</span>`;
  }).join('');
  
  return html ? `<div class="tags-area">${html}</div>` : '';
}

window.createContentCard = function(pageType, id, data) {
  const mediaHTML = generateMediaHTML(data.image, pageType);
  const shortDesc = getShortDescription(data, pageType);
  const footerHTML = getCardFooter(pageType, id);
  const tagsHTML = renderCardTags(data, pageType);
  const modalOpener = pageType === 'battles' ? `openBattleModal('${id}')` : 
                      pageType === 'categories' ? `openCategoryModal('${id}')` : 
                      `openMemeModal('${id}')`;
  const cardClass = pageType === 'battles' ? 'card card--battle' : 
                    pageType === 'categories' ? 'card card--category' : 
                    'card card--meme';

  return `
    <div onclick="${modalOpener}" class="${cardClass}" data-id="${id}" data-categories="${(data.tags || '').split(',').map(t => t.trim()).join(',')}">
      ${mediaHTML}
      <div class="card__content">
        ${tagsHTML}
        <h4 class="card__title">${data.title || ''}</h4>
        <p class="card__description">${shortDesc}</p>
      </div>
      ${footerHTML}
    </div>
  `;
};

// Render functions (called by common.js)
// ====================== BATTLE GRID RENDERER (exact match to your screenshot) ======================
window.renderBattleGrid = function() {
  const grid = document.getElementById('battle-grid');
  if (!grid) return;
  grid.innerHTML = '';

  Object.keys(window.allBattles)
    .sort((a, b) => (window.allBattles[b].order || 0) - (window.allBattles[a].order || 0))
    .forEach(id => {
      const b = window.allBattles[id];
      const hasVoted = !!localStorage.getItem('voted_' + id);

      const cardHTML = `
        <div onclick="openBattleModal(${id});" class="card card--battle">
          <div class="card__media">
            ${b.image ? `<img src="${b.image}" alt="${b.title}">` : ''}
          </div>
          <div class="card__content">
            <div class="tags-area">
              ${(b.tags || '').split(',').map(t => `<span>${t.trim()}</span>`).join('')}
            </div>
            <h4 class="card__title">${b.title}</h4>
            <p class="card__description">${(b.description || b.human || '').substring(0, 130)}...</p>
          </div>

          <!-- Voting bar – exact purple/red style from your screenshot -->
          <div class="card__buttons flex" id="vote-bar-${id}">
            <button onclick="vote(event, 'grok', ${id}); event.stopImmediatePropagation();" 
                    id="grok-btn-${id}" 
                    class="flex-1 bg-[#6b21a8] text-white font-semibold py-4 flex items-center justify-center gap-2">
              Grok <span id="grok-count-${id}" class="vote-tally">0</span>
            </button>
            <button onclick="vote(event, 'human', ${id}); event.stopImmediatePropagation();" 
                    id="human-btn-${id}" 
                    class="flex-1 bg-[#9f1239] text-white font-semibold py-4 flex items-center justify-center gap-2">
              <span id="human-count-${id}" class="vote-tally">0</span> Human
            </button>
          </div>
        </div>`;
      grid.insertAdjacentHTML('beforeend', cardHTML);

      updateGridVoteUI(id);
    });
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
  Object.keys(window.allMemes || {})
    .sort((a,b) => (window.allMemes[b].order || 0) - (window.allMemes[a].order || 0))
    .forEach(id => grid.insertAdjacentHTML('beforeend', createContentCard('memes', id, window.allMemes[id])));
};

// Shared filter
window.filterCategory = function(cat) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('tab-active'));
  const active = document.getElementById('tab-' + cat);
  if (active) active.classList.add('tab-active');

  const gridId = document.body.getAttribute('data-page') === 'battles' ? 'battle-grid' : 
                 document.body.getAttribute('data-page') === 'categories' ? 'category-grid' : 'meme-grid';
  
  document.querySelectorAll(`#${gridId} > .card`).forEach(card => {
    const cats = (card.getAttribute('data-categories') || '').split(',').map(c => c.trim());
    card.style.display = (cat === 'all' || cats.includes(cat)) ? 'flex' : 'none';
  });
};

// Restore live vote tallies from Firebase
window.updateGridVoteUI = function(id) {
  const grokBtn = document.getElementById(`grok-btn-${id}`);
  const humanBtn = document.getElementById(`human-btn-${id}`);
  if (!grokBtn || !humanBtn) return;
  
  const total = (window.allBattles[id].grokVotes || 0) + (window.allBattles[id].humanVotes || 0);
  if (total === 0) return;
  
  const grokPct = Math.round(((window.allBattles[id].grokVotes || 0) / total) * 100);
  const humanPct = 100 - grokPct;
  
  grokBtn.innerHTML = `Grok Won <span class="vote-tally">${grokPct}%</span>`;
  humanBtn.innerHTML = `Human Won <span class="vote-tally">${humanPct}%</span>`;
};

// Call this after rendering battles grid
window.renderBattleGrid = function() {
  const grid = document.getElementById('battle-grid');
  if (!grid) return;
  grid.innerHTML = '';
  Object.keys(window.allBattles || {})
    .sort((a,b) => (window.allBattles[b].order || 0) - (window.allBattles[a].order || 0))
    .forEach(id => grid.insertAdjacentHTML('beforeend', createContentCard('battles', id, window.allBattles[id])));
  
  // Update vote tallies
  Object.keys(window.allBattles || {}).forEach(id => updateGridVoteUI(id));
};