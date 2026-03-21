// assets/js/common.js
// MODERNIZATION: Unified header/footer loader + background + nav highlight

document.addEventListener('DOMContentLoaded', () => {

    // 1. RANDOM BACKGROUND ROTATOR (unchanged)
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

    // 2. LOAD HEADER + FOOTER (NEW — unified for every page)
    loadLayout();

    // 3. NAV HIGHLIGHT (unchanged)
    const observer = new MutationObserver(() => {
        const navLinks = document.querySelectorAll('.nav-link');
        if (navLinks.length > 0) {
            const currentPage = document.body.getAttribute('data-page') || '';
            if (currentPage) {
                navLinks.forEach(link => {
                    link.classList.remove('active');
                    const href = link.getAttribute('href').replace('.html', '').toLowerCase();
                    if (href === currentPage.toLowerCase()) link.classList.add('active');
                });
            }
            observer.disconnect();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
});

async function loadLayout() {
    try {
        // Header
        const headerRes = await fetch('assets/partials/header.html');
        if (!headerRes.ok) throw new Error('Header 404');
        const headerHTML = await headerRes.text();
        document.body.insertAdjacentHTML('afterbegin', headerHTML);

        // Footer
        const footerRes = await fetch('assets/partials/footer.html');
        if (!footerRes.ok) throw new Error('Footer 404');
        const footerHTML = await footerRes.text();
        document.body.insertAdjacentHTML('beforeend', footerHTML);

        console.log('✅ Header + Footer loaded from common.js');
    } catch (e) {
        console.error('❌ Layout load failed:', e);
        // Fallback so site never dies
        document.body.insertAdjacentHTML('afterbegin', 
            `<nav class="fixed top-0 w-full bg-black/90 p-4 text-center z-50 border-b border-red-500">GrokVsHumans <span class="text-red-400">(header failed — refresh?)</span></nav>`
        );
    }
}