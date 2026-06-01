/**
 * KaiSync Workforce — nav, scroll, contact (mailto), reveal animations
 */

(function () {
    'use strict';

    const navbar = document.getElementById('navbar');
    const navLinks = document.querySelectorAll('.nav-link');
    const hamburger = document.getElementById('hamburger');
    const navMenu = document.getElementById('navMenu');
    const contactForm = document.getElementById('contactForm');
    const whatsappFab = document.getElementById('whatsappFab');
    const isHomePage = document.body.classList.contains('page-home');

    // Navbar scroll effect
    function onScroll() {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    }
    window.addEventListener('scroll', onScroll, { passive: true });

    function setNavMenuOpen(open) {
        if (!hamburger || !navMenu) return;
        hamburger.classList.toggle('active', open);
        navMenu.classList.toggle('active', open);
        hamburger.setAttribute('aria-expanded', open ? 'true' : 'false');
        hamburger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }

    // Smooth scroll + active link
    navLinks.forEach(function (link) {
        link.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (href && href.startsWith('#')) {
                e.preventDefault();
                const id = href.slice(1);
                const section = document.getElementById(id);
                if (section) {
                    const top = section.getBoundingClientRect().top + window.pageYOffset - 70;
                    window.scrollTo({ top: top, behavior: 'smooth' });
                }
                navLinks.forEach(function (l) { l.classList.remove('active'); });
                this.classList.add('active');
                if (navMenu && navMenu.classList.contains('active')) {
                    setNavMenuOpen(false);
                }
            }
        });
    });

    // Update active nav on scroll (home page only — avoids mismatched highlights vs multi-page nav)
    const sections = isHomePage ? document.querySelectorAll('section[id]') : [];
    function updateActiveNav() {
        if (!isHomePage) return;
        const scrollY = window.scrollY + 120;
        let current = '';
        sections.forEach(function (section) {
            const top = section.offsetTop;
            const height = section.offsetHeight;
            if (scrollY >= top && scrollY < top + height) {
                current = section.getAttribute('id');
            }
        });
        navLinks.forEach(function (link) {
            const href = link.getAttribute('href') || '';
            if (!href.startsWith('#')) return;
            link.classList.remove('active');
            if (href === '#' + current) {
                link.classList.add('active');
            }
        });
    }
    if (isHomePage) {
        window.addEventListener('scroll', updateActiveNav, { passive: true });
        updateActiveNav();
    }

    if (hamburger && navMenu) {
        hamburger.addEventListener('click', function () {
            setNavMenuOpen(!navMenu.classList.contains('active'));
        });
        document.addEventListener('click', function (e) {
            if (!hamburger.contains(e.target) && !navMenu.contains(e.target)) {
                setNavMenuOpen(false);
            }
        });
    }

    // Contact form — opens visitor's email client (no backend required)
    if (contactForm) {
        var contactNote = document.getElementById('contactFormNote');
        contactForm.addEventListener('submit', function (e) {
            e.preventDefault();
            var nameEl = document.getElementById('contact-name');
            var emailEl = document.getElementById('contact-email');
            var messageEl = document.getElementById('contact-message');
            if (!nameEl || !emailEl || !messageEl) return;
            var name = nameEl.value.trim();
            var email = emailEl.value.trim();
            var message = messageEl.value.trim();
            if (!name || !email || !message) {
                window.alert('Please fill in all fields.');
                return;
            }
            var body = 'Name: ' + name + '\nEmail: ' + email + '\n\n' + message;
            var mailto = 'mailto:kaisynctech@gmail.com?subject=' +
                encodeURIComponent('KaiSync Workforce — contact request') +
                '&body=' + encodeURIComponent(body);
            window.location.href = mailto;
            if (contactNote) contactNote.hidden = false;
        });
    }

    var WHATSAPP_E164 = '27840460762';

    // WhatsApp quick-chat
    if (whatsappFab) {
        const whatsappUrl = 'https://wa.me/' + WHATSAPP_E164 + '?text=' +
            encodeURIComponent('Hi KaiSync Workforce — I would like to talk about rolling out the app for my team.');
        whatsappFab.addEventListener('click', function () {
            window.open(whatsappUrl, '_blank');
        });
    }

    // Reveal on scroll (Intersection Observer)
    const revealOptions = { threshold: 0.15, rootMargin: '0px 0px -40px 0px' };
    const revealObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
            }
        });
    }, revealOptions);

    document.querySelectorAll('.service-card, .about-content, .about-card, .section-header, .testimonial-card, .voice-card, .trust-band-copy, .feature-module, .pricing-plan-card, .pricing-example-card, .release-card, .download-version-banner').forEach(function (el) {
        revealObserver.observe(el);
    });

    // Portfolio gallery filters (MCMBhele-style)
    const portfolioFilterBtns = document.querySelectorAll('.portfolio-filter-btn');
    const portfolioItems = document.querySelectorAll('.portfolio-gallery-item');

    if (portfolioFilterBtns.length && portfolioItems.length) {
        portfolioFilterBtns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                portfolioFilterBtns.forEach(function (b) { b.classList.remove('active'); });
                btn.classList.add('active');
                const filter = btn.dataset.filter || 'all';
                portfolioItems.forEach(function (item) {
                    const category = item.dataset.category || '';
                    if (filter === 'all' || category === filter) {
                        item.style.display = '';
                    } else {
                        item.style.display = 'none';
                    }
                });
            });
        });
    }

    // Parallax hero (subtle)
    window.addEventListener('scroll', function () {
        const hero = document.querySelector('.hero');
        if (hero && window.innerWidth > 768) {
            const y = window.pageYOffset * 0.2;
            hero.style.setProperty('--hero-parallax', y + 'px');
        }
    });

    // Button ripple (optional)
    document.querySelectorAll('.btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            var ripple = document.createElement('span');
            var rect = this.getBoundingClientRect();
            var size = Math.max(rect.width, rect.height);
            var x = e.clientX - rect.left - size / 2;
            var y = e.clientY - rect.top - size / 2;
            ripple.style.cssText = 'position:absolute;width:' + size + 'px;height:' + size + 'px;left:' + x + 'px;top:' + y + 'px;background:rgba(255,255,255,0.3);border-radius:50%;transform:scale(0);pointer-events:none;';
            ripple.classList.add('ripple');
            this.style.position = 'relative';
            this.style.overflow = 'hidden';
            this.appendChild(ripple);
            requestAnimationFrame(function () {
                ripple.style.transition = 'transform 0.5s ease-out';
                ripple.style.transform = 'scale(4)';
                ripple.style.opacity = '0';
            });
            setTimeout(function () { ripple.remove(); }, 500);
        });
    });

    // Page load fade
    window.addEventListener('load', function () {
        document.body.style.opacity = '0';
        document.body.style.transition = 'opacity 0.4s ease';
        requestAnimationFrame(function () {
            document.body.style.opacity = '1';
        });
    });
})();
