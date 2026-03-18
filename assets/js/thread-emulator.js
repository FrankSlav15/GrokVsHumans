// assets/js/thread-emulator.js
// Modernization branch - 403 Forbidden fix + debug logs for video.twimg.com

function renderThread(threadPosts, containerId) {
    const container = document.getElementById(containerId);
    console.log('DEBUG: renderThread called for', containerId);

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
        const isTwitterVideo = hasMedia && lower.includes('video.twimg.com');

        console.log(`Post ${i+1} → isVideo: ${isVideo}, isTwitterVideo: ${isTwitterVideo}`);

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
                    <div class="mt-4 rounded-2xl overflow-hidden border border-zinc-700">
                        ${isVideo && !isTwitterVideo ? 
                          `<video src="${imageUrl}" class="w-full rounded-2xl block" controls preload="metadata" playsinline></video>` : 
                          isTwitterVideo ? 
                          `<div class="bg-zinc-900 rounded-2xl p-6 text-center">
                              <div class="text-purple-400 mb-3">📹 Video hosted on X</div>
                              <button onclick="document.getElementById('modal-x-link').click()" 
                                      class="bg-purple-600 hover:bg-purple-700 text-white font-medium py-3 px-6 rounded-2xl text-sm">
                                  Play on X
                              </button>
                           </div>` :
                          `<img src="${imageUrl}" class="w-full rounded-2xl block" alt="Media" onerror="this.style.display='none'">`}
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