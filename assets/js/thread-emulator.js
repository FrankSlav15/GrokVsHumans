// assets/js/thread-emulator.js
// Modernization branch - full media support for images/videos

function renderThread(threadPosts, containerId) {
    const container = document.getElementById(containerId);
    if (!container || !threadPosts || !Array.isArray(threadPosts)) {
        container.innerHTML = '<p class="text-zinc-500 text-center py-8">Thread data unavailable</p>';
        return;
    }

    let html = `<div class="thread-emulator mx-auto max-w-[620px] space-y-8">`;

    threadPosts.forEach(post => {
        const isGrok = post.author === 'grok';
        const bubbleClass = isGrok ? 'grok-bubble' : 'human-bubble';
        const align = isGrok ? 'justify-end' : 'justify-start';

        html += `
            <div class="thread-post flex ${align} gap-3">
                ${!isGrok ? `<img src="${post.avatar || '/assets/images/default-avatar.png'}" class="w-9 h-9 rounded-full flex-shrink-0 mt-1" alt="${post.username}">` : ''}
                
                <div class="${bubbleClass} max-w-[85%] p-5 rounded-3xl">
                    <div class="flex items-center gap-2 mb-2">
                        <span class="font-semibold text-sm">${post.username}</span>
                        <span class="text-zinc-500 text-xs">${new Date(post.timestamp).toLocaleDateString()}</span>
                    </div>
                    
                    <div class="thread-text text-[15px] leading-relaxed">${post.text || ''}</div>
                    
                    ${post.image ? `
                    <div class="mt-4 rounded-2xl overflow-hidden border border-zinc-700">
                        ${post.image.toLowerCase().endsWith('.mp4') || 
                          post.image.toLowerCase().endsWith('.webm') || 
                          post.image.toLowerCase().endsWith('.mov') ? 
                          `<video src="${post.image}" class="w-full rounded-2xl" controls autoplay loop muted playsinline></video>` : 
                          `<img src="${post.image}" class="w-full rounded-2xl block" alt="Embedded media">`}
                    </div>` : ''}
                </div>
                
                ${isGrok ? `<img src="${post.avatar || '/assets/images/grok-avatar.png'}" class="w-9 h-9 rounded-full flex-shrink-0 mt-1" alt="${post.username}">` : ''}
            </div>`;
    });

    html += `</div>`;
    container.innerHTML = html;
}

// Auto-attach to any thread-container on page load
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.thread-container').forEach(container => {
        const entryId = container.getAttribute('data-entry-id');
        if (entryId && window.allBattles && window.allBattles[entryId]) {
            renderThread(window.allBattles[entryId].threadPosts, container.id);
        }
    });
});