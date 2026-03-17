// assets/js/thread-emulator.js
// Modernization branch - robust media detection + debug logs

function renderThread(threadPosts, containerId) {
    const container = document.getElementById(containerId);
    console.log('DEBUG: renderThread called for container', containerId);

    if (!container || !threadPosts || !Array.isArray(threadPosts)) {
        console.error('Thread data missing');
        container.innerHTML = '<p class="text-zinc-500 text-center py-8">Thread data unavailable</p>';
        return;
    }

    let html = `<div class="thread-emulator mx-auto max-w-[620px] space-y-8">`;

    threadPosts.forEach((post, i) => {
        const imageUrl = post.image || '';
        console.log(`Post ${i+1} | author: ${post.author} | image URL: "${imageUrl}"`);

        const isGrok = post.author === 'grok';
        const bubbleClass = isGrok ? 'grok-bubble' : 'human-bubble';
        const align = isGrok ? 'justify-end' : 'justify-start';

        const hasMedia = imageUrl.trim() !== '';
        const lower = imageUrl.toLowerCase();
        const isVideo = hasMedia && /\.(mp4|webm|mov|ogg|m4v)$/i.test(lower);
        const isImage = hasMedia && /\.(webp|jpg|jpeg|png|gif|avif)$/i.test(lower);

        console.log(`Post ${i+1} → isVideo: ${isVideo}, isImage: ${isImage}`);

        html += `
            <div class="thread-post flex ${align} gap-3">
                ${!isGrok ? `<img src="${post.avatar || '/assets/images/default-avatar.png'}" class="w-9 h-9 rounded-full flex-shrink-0 mt-1" alt="${post.username}">` : ''}
                
                <div class="${bubbleClass} max-w-[85%] p-5 rounded-3xl">
                    <div class="flex items-center gap-2 mb-2">
                        <span class="font-semibold text-sm">${post.username}</span>
                        <span class="text-zinc-500 text-xs">${new Date(post.timestamp).toLocaleDateString()}</span>
                    </div>
                    
                    <div class="thread-text text-[15px] leading-relaxed">${post.text || ''}</div>
                    
                    ${hasMedia ? `
                    <div class="mt-4 rounded-2xl overflow-hidden border border-zinc-700 bg-black">
                        ${isVideo ? 
                          `<video src="${imageUrl}" class="w-full rounded-2xl block" controls preload="metadata" playsinline></video>` : 
                          `<img src="${imageUrl}" class="w-full rounded-2xl block" alt="Media" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'p-4 text-red-400\\'>Failed to load media</div>'">`}
                    </div>` : ''}
                </div>
                
                ${isGrok ? `<img src="${post.avatar || '/assets/images/grok-avatar.png'}" class="w-9 h-9 rounded-full flex-shrink-0 mt-1" alt="${post.username}">` : ''}
            </div>`;
    });

    html += `</div>`;
    container.innerHTML = html;
}

// Auto-attach
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.thread-container').forEach(container => {
        const entryId = container.getAttribute('data-entry-id');
        if (entryId && allBattles && allBattles[entryId]) {
            renderThread(allBattles[entryId].threadPosts, container.id);
        }
    });
});