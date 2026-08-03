(function () {
  var navbar = document.getElementById('navbar');
  if (navbar) {
    var onScroll = function () {
      navbar.classList.toggle('is-scrolled', window.scrollY > 12);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  var hamburger = document.getElementById('hamburger');
  var navMenu = document.getElementById('navMenu');
  if (hamburger && navMenu) {
    hamburger.addEventListener('click', function () {
      var open = navMenu.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    navMenu.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        navMenu.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
      });
    });
  }

  var form = document.getElementById('contactForm');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = (document.getElementById('contact-name') || {}).value || '';
      var email = (document.getElementById('contact-email') || {}).value || '';
      var message = (document.getElementById('contact-message') || {}).value || '';
      var subject = encodeURIComponent('KaiSync enquiry from ' + name);
      var body = encodeURIComponent('Name: ' + name + '\nEmail: ' + email + '\n\n' + message);
      window.location.href = 'mailto:kaisynctech@gmail.com?subject=' + subject + '&body=' + body;
      var note = document.getElementById('contactFormNote');
      if (note) note.hidden = false;
    });
  }

  var fab = document.getElementById('whatsappFab');
  if (fab) {
    fab.addEventListener('click', function () {
      window.open('https://wa.me/27840460762', '_blank', 'noopener,noreferrer');
    });
  }

  // Modules page: show one module panel at a time
  var tabs = document.getElementById('moduleTabs');
  if (tabs) {
    var tabLinks = Array.prototype.slice.call(tabs.querySelectorAll('[data-module]'));
    var panels = Array.prototype.slice.call(document.querySelectorAll('[data-module-panel]'));

    function showModule(id, updateHash) {
      if (!id) id = 'workforce';
      var matched = false;
      panels.forEach(function (panel) {
        var on = panel.getAttribute('data-module-panel') === id;
        panel.classList.toggle('is-active', on);
        if (on) {
          matched = true;
          panel.classList.add('is-visible');
        }
      });
      if (!matched) {
        showModule('workforce', updateHash);
        return;
      }
      tabLinks.forEach(function (link) {
        link.classList.toggle('is-active', link.getAttribute('data-module') === id);
      });
      if (updateHash) {
        if (history.replaceState) history.replaceState(null, '', '#' + id);
        else location.hash = id;
      }
    }

    tabLinks.forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        showModule(link.getAttribute('data-module'), true);
      });
    });

    var initial = (location.hash || '').replace(/^#/, '');
    if (!initial && panels[0]) initial = panels[0].getAttribute('data-module-panel');
    showModule(initial || 'workforce', false);

    window.addEventListener('hashchange', function () {
      var next = (location.hash || '').replace(/^#/, '');
      if (!next && panels[0]) next = panels[0].getAttribute('data-module-panel');
      showModule(next || 'workforce', false);
    });
  }

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });
  } else {
    document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('is-visible'); });
  }
})();
