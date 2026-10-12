// Slides sections in as they scroll into view.
// Anything with data-reveal starts hidden (only when JavaScript runs) and gets "revealed".
(function () {
  var items = document.querySelectorAll('[data-reveal]');
  if (!('IntersectionObserver' in window)) {
    items.forEach(function (el) { el.classList.add('revealed'); });
    return;
  }
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  items.forEach(function (el, i) {
    // small stagger for items next to each other
    el.style.transitionDelay = (el.getAttribute('data-reveal-delay') || 0) + 'ms';
    observer.observe(el);
  });
})();
