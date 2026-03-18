// assets/js/common.js
// Modernization branch - dynamic header support + reliable nav highlight

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

    // 2. WAIT FOR DYNAMIC HEADER + HIGHLIGHT CURRENT PAGE
    const observer = new MutationObserver(() => {
        const navLinks = document.querySelectorAll('.nav-link');
        if (navLinks.length > 0) {
            const currentPage = document.body.getAttribute('data-page') || '';
            if (currentPage) {
                navLinks.forEach(link => {
                    link.classList.remove('active');
                    const href = link.getAttribute('href').replace('.html', '').toLowerCase();
                    if (href === currentPage.toLowerCase()) {
                        link.classList.add('active');
                    }
                });
            }
            observer.disconnect();   // stop watching once done
        }
    });

    // Start watching the whole body for the header to be inserted
    observer.observe(document.body, { childList: true, subtree: true });
});