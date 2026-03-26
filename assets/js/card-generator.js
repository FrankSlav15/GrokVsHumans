// assets/js/card-generator.js
// Unified card generator with tag pills on cards (modernization branch)

function generateMediaHTML(imageUrl, pageType) {
  if (!imageUrl) {
    return '<div class="w-full h-[15.5rem] bg-zinc-800 flex items-center justify-center text-zinc-500 text-sm">No media</div>';
  }

  const lower = imageUrl.toLowerCase();
  const isVideo = lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mov');

  if (isVideo) {
    const heightClass = pageType === 'categories' ? 'h-[15.5rem]' : 'aspect-video';
    const extraClass = pageType === 'memes' ? 'video-card' : '';
    return `
      <div class="${heightClass} ${extraClass}" style="background:#18181b;">
        <video src="${imageUrl}" class="w-full h-full object-cover" loop muted playsinline preload="metadata"></video>
      </div>`;
  }

  const heightClass = pageType === 'categories' ? 'h-[15.5rem]' : 'h-56';
  return `<img src="${imageUrl}" loading="lazy" class="w-full ${heightClass} object-cover" alt="Preview">`;
}

function getShortDescription(data, pageType) {
  let desc = '';
  if (pageType === 'battles') desc = data.description || data.grok || data.human || '';
  else if (pageType === 'categories') desc = data.description || '';
  else if (pageType === 'memes') desc = data.description || data.context || '';
  return (desc || '').substring(0, 130);
}

function getCardFooter(pageType, id) {
  if (pageType === 'battles') {
    return `
      <div class="buttons flex">
        <button id="grok-btn-${id}" onclick="vote(event, 'grok', ${id}); event.stopImmediatePropagation();" class="flex-1 py-3 sm:py-4 bg-purple-800 hover:bg-purple-950 text-white font-semibold text-sm sm:text-base">Grok Won</button>
        <button id="human-btn-${id}" onclick="vote(event, 'human', ${id}); event.stopImmediatePropagation();" class="flex-1 py-3 sm:py-4 bg-rose-800 hover:bg-rose-950 text-white font-semibold text-sm sm:text-base">Human Won</button>
      </div>`;
  }
  return '';
}

function renderCardTags(data, pageType) {
  const tagMap = pageType === 'battles'
    ? { nonsense: "Nonsense", political: "Political", serious: "Now, In All Seriousness", citation: "(UN)Popular Citations", joke: "Joke Battles", censorship: "Conspiracy 1984" }
    : pageType === 'categories'
    ? { lazy: "Grok, Think For Me", politics: "Politics", photo: "Photo Requests", opinion: "Grok's Opinion", avoids: "Grok Avoids Request", other: "Miscellaneous" }
    : { 'grok-memes': "Grok Memes", 'political-memes': "Political Memes", 'misc-memes': "Miscellaneous Memes", gifs: "GIFs", 'ai-tech': "AI Meme Tech", videos: "Videos", other: "Other" };

  const tagsHTML = (data.tags || '').split(',').map(t => {
    const trimmed = t.trim();
    const label = tagMap[trimmed] || trimmed;
    return `<span class="px-3 py-0.5 bg-purple-900/70 text-purple-200 text-xs rounded-full">${label}</span>`;
  }).join('');
  return tagsHTML ? `<div class="flex flex-wrap gap-2 px-6 pt-6">${tagsHTML}</div>` : '';
}

window.createContentCard = function(pageType, id, data) {
  const mediaHTML = generateMediaHTML(data.image, pageType);
  const shortDesc = getShortDescription(data, pageType);
  const footerHTML = getCardFooter(pageType, id);
  const tagsHTML = renderCardTags(data, pageType);

  const modalOpener = pageType === 'battles' ? 'openBattleModal' :
                      pageType === 'categories' ? 'openCategoryModal' : 'openMemeModal';

  const baseClass = pageType === 'battles' ? 'battle-card' :
                    pageType === 'categories' ? 'category-card' : 'meme-card';

  return `
    <div onclick="${modalOpener}('${id}')"
         class="${baseClass} rounded-3xl overflow-hidden block cursor-pointer flex flex-col h-full"
         data-categories="${(data.tags || '').split(',').map(t => t.trim()).join(',')}"
         data-id="${id}">
      ${tagsHTML}
      ${mediaHTML}
      <div class="content flex-1 flex flex-col">
        <div class="title-area h-[56px] flex items-center px-6">
          <h4 class="font-semibold text-lg leading-tight line-clamp-2">${data.title || ''}</h4>
        </div>
        <div class="desc-area flex-1 px-6">
          <p class="text-gray-400 text-sm line-clamp-4">${shortDesc}...</p>
        </div>
      </div>
      ${footerHTML}
    </div>`;
};