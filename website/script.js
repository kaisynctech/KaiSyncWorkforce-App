/**
 * KaiSync Tech Solutions – Nav, scroll, form, reveal animations
 */

(function () {
    'use strict';

    const navbar = document.getElementById('navbar');
    const navLinks = document.querySelectorAll('.nav-link');
    const hamburger = document.getElementById('hamburger');
    const navMenu = document.getElementById('navMenu');
    const contactForm = document.getElementById('contactForm');
    const whatsappFab = document.getElementById('whatsappFab');
    const chatbotFab = document.getElementById('chatbotFab');
    const chatbotEl = document.getElementById('chatbotWidget');
    const chatbotClose = document.getElementById('chatbotClose');
    const chatbotForm = document.getElementById('chatbotForm');
    const chatbotInput = document.getElementById('chatbotInput');
    const chatbotMessages = document.getElementById('chatbotMessages');
    const chatbotChips = document.querySelectorAll('.chatbot-chip');

    // Navbar scroll effect
    function onScroll() {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    }
    window.addEventListener('scroll', onScroll, { passive: true });

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
                    navMenu.classList.remove('active');
                    hamburger && hamburger.classList.remove('active');
                }
            }
        });
    });

    // Update active nav on scroll (only for same-page hash links)
    const sections = document.querySelectorAll('section[id]');
    function updateActiveNav() {
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
            if (!href.startsWith('#')) return; // keep multi-page active state from HTML
            link.classList.remove('active');
            if (href === '#' + current) {
                link.classList.add('active');
            }
        });
    }
    window.addEventListener('scroll', updateActiveNav, { passive: true });
    updateActiveNav();

    // Mobile menu
    if (hamburger && navMenu) {
        hamburger.addEventListener('click', function () {
            hamburger.classList.toggle('active');
            navMenu.classList.toggle('active');
        });
        document.addEventListener('click', function (e) {
            if (!hamburger.contains(e.target) && !navMenu.contains(e.target)) {
                hamburger.classList.remove('active');
                navMenu.classList.remove('active');
            }
        });
    }

    // Contact form
    if (contactForm) {
        contactForm.addEventListener('submit', function (e) {
            e.preventDefault();
            const name = document.getElementById('name');
            const email = document.getElementById('email');
            const message = document.getElementById('message');
            if (name && email && message && name.value && email.value && message.value) {
                alert('Thanks for your message! We\'ll get back to you soon.');
                contactForm.reset();
            } else {
                alert('Please fill in all fields.');
            }
        });
    }

    // WhatsApp quick-chat
    if (whatsappFab) {
        const whatsappUrl = 'https://wa.me/?text=' +
            encodeURIComponent('Hi KaiSync Workforce — I would like to talk about rolling out the app / modules for my team.');
        whatsappFab.addEventListener('click', function () {
            window.open(whatsappUrl, '_blank');
        });
    }

    // Simple onsite chatbot
    function toggleChatbot(open) {
        if (!chatbotEl) return;
        if (open === undefined) {
            chatbotEl.classList.toggle('open');
        } else if (open) {
            chatbotEl.classList.add('open');
        } else {
            chatbotEl.classList.remove('open');
        }
    }

    if (chatbotFab) {
        chatbotFab.addEventListener('click', function () {
            toggleChatbot();
        });
    }

    if (chatbotClose) {
        chatbotClose.addEventListener('click', function () {
            toggleChatbot(false);
        });
    }

    function appendMessage(text, type) {
        if (!chatbotMessages) return;
        const msg = document.createElement('div');
        msg.className = 'chat-msg ' + (type === 'user' ? 'chat-msg-user' : 'chat-msg-bot');
        msg.textContent = text;
        chatbotMessages.appendChild(msg);
        chatbotMessages.scrollTop = chatbotMessages.scrollHeight;
    }

    function botReply(input) {
        const lower = input.toLowerCase();
        if (lower.includes('website')) {
            appendMessage('Great – for websites we usually start with your goals, pages you need, and any examples you like. You can also tell us which industry you\'re in.', 'bot');
        } else if (lower.includes('autom') || lower.includes('workflow') || lower.includes('lead')) {
            appendMessage('Automation projects often start with a simple question: what are you doing repeatedly that a system could handle? Lead capture, CRM sync, invoices and reports are common wins.', 'bot');
        } else if (lower.includes('market') || lower.includes('poster') || lower.includes('video')) {
            appendMessage('For marketing visuals we can help with posters, animated videos and animated images that match your brand and campaigns.', 'bot');
        } else if (lower.includes('price') || lower.includes('cost') || lower.includes('quote')) {
            appendMessage('Pricing depends on scope, but we can give you a clear quote once we know what you need. Share some detail here or use the main contact form.', 'bot');
        } else {
            appendMessage('Thanks for the message. Share what you have in mind for websites, automation or marketing and we\'ll follow up with specific ideas.', 'bot');
        }
    }

    if (chatbotForm && chatbotInput && chatbotMessages) {
        // Initial greeting
        appendMessage('Hi, I\'m the KaiSync assistant. Ask about websites, automation, or marketing – or tell me briefly what you need.', 'bot');

        chatbotForm.addEventListener('submit', function (e) {
            e.preventDefault();
            const value = chatbotInput.value.trim();
            if (!value) return;
            appendMessage(value, 'user');
            chatbotInput.value = '';
            setTimeout(function () { botReply(value); }, 250);
        });
    }

    if (chatbotChips && chatbotChips.length && chatbotInput && chatbotForm) {
        chatbotChips.forEach(function (chip) {
            chip.addEventListener('click', function () {
                const text = chip.dataset.prompt || chip.textContent || '';
                if (!text) return;
                chatbotInput.value = text;
                chatbotForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            });
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

    document.querySelectorAll('.service-card, .about-content, .about-card, .section-header, .testimonial-card, .voice-card, .trust-logo-slot, .trust-band-copy').forEach(function (el) {
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
