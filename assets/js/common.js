// assets/js/common.js
// Shared across ALL pages — modernization branch

document.addEventListener('DOMContentLoaded', () => {

    // 1. RANDOM BACKGROUND ROTATOR
    const bgs = [
        'assets/images/backgrounds/bg1.webp','assets/images/backgrounds/bg2.webp',
        'assets/images/backgrounds/bg3.webp','assets/images/backgrounds/bg4.webp',
        'assets/images/backgrounds/bg5.webp','assets/images/backgrounds/bg6.webp',
        'assets/images/backgrounds/bg7.webp','assets/images/backgrounds/bg8.webp',
        'assets/images/backgrounds/bg9.webp','assets/images/backgrounds/bg10.webp',
        'assets/images/backgrounds/bg11.webp','assets/images/backgrounds/bg12.webp',
        'assets/images/backgrounds/bg13.webp','assets/images/backgrounds/bg14.webp',
        'assets/images/backgrounds/bg15.webp','assets/images/backgrounds/bg16.webp',
        'assets/images/backgrounds/bg17.webp','assets/images/backgrounds/bg18.webp',
        'assets/images/backgrounds/bg19.webp','assets/images/backgrounds/bg20.webp'
    ];
    const randomBg = bgs[Math.floor(Math.random() * bgs.length)];
    document.body.style.backgroundImage = `url('/${randomBg}')`;
    document.body.style.backgroundPosition = '50% 35%';
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundRepeat = 'no-repeat';
    document.body.style.backgroundAttachment = 'fixed';

    // 2. ROBUST NAV ACTIVE HIGHLIGHT (fixed for Vercel + local)
    let path = window.location.pathname.toLowerCase();
    if (path === '/' || path === '') path = '/index.html';
    
    let currentPage = path.split('/').pop();
    if (!currentPage) currentPage = 'index.html';
    if (!currentPage.endsWith('.html')) currentPage += '.html';

    const currentClean = currentPage.replace('.html', '');

    document.querySelectorAll('.nav-link').forEach(link => {
        let href = link.getAttribute('href').toLowerCase();
        const hrefClean = href.replace('.html', '');
        
        if (href === currentPage || hrefClean === currentClean) {
            link.classList.add('active');
        }
    });
});