// assets/js/thread-emulator.js
function renderThread(threadPosts, containerId) {
    const container = document.getElementById(containerId);
    if (!container || !threadPosts || threadPosts.length === 0) return;

    let html = `<div class="thread-emulator">`;
    
    threadPosts.forEach((post, i) => {
        const isGrok = post.author === 'grok';
        const bubbleClass = isGrok ? 'grok-bubble' : 'human-bubble';
        const avatar = post.avatar || (isGrok 
            ? 'https://pbs.twimg.com/profile_images/grok-avatar.png' 
            : 'https://pbs.twimg.com/profile_images/default-human.png');
        
        html += `
            <div class="thread-post ${bubbleClass}">
                <img src="${avatar}" class="thread-avatar" alt="${post.username}">
                <div class="thread-content">
                    <div class="thread-header">
                        <strong>${post.username}</strong>
                        <span class="thread-time">${new Date(post.timestamp).toLocaleString()}</span>
                    </div>
                    <p class="thread-text">${post.text}</p>
                    ${post.image ? `<img src="${post.image}" class="thread-image">` : ''}
                    ${post.xLink ? `<a href="${post.xLink}" target="_blank" class="view-original">View original on X →</a>` : ''}
                </div>
            </div>
            ${i < threadPosts.length - 1 ? '<div class="thread-connector"></div>' : ''}
        `;
    });

    html += `</div>`;
    container.innerHTML = html;
}

// Auto-attach to any .thread-container that has data-entry-id
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.thread-container').forEach(cont => {
        const entryId = cont.dataset.entryId;
        const dataSource = window.allBattles || window.allCategories || window.allMemes || {};
        const entry = dataSource[entryId];
        if (entry && entry.threadPosts) {
            renderThread(entry.threadPosts, cont.id);
        }
    });
});