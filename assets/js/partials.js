async function loadPartials() {
  const headerEl = document.getElementById('header-partial');
  const footerEl = document.getElementById('footer-partial');

  if (headerEl) {
    const res = await fetch('/components/header.html');
    headerEl.innerHTML = await res.text();
    highlightActiveNav();
  }

  if (footerEl) {
    const res = await fetch('/components/footer.html');
    footerEl.innerHTML = await res.text();
  }
}

function highlightActiveNav() {
  const currentPath = window.location.pathname;
  document.querySelectorAll('.navbar-nav .nav-link').forEach(link => {
    if (link.getAttribute('href') === currentPath || (currentPath === '/' && link.getAttribute('href') === '/index.html')) {
      link.style.color = '#028090';
      link.classList.add('fw-semibold');
    }
  });
}

document.addEventListener('DOMContentLoaded', loadPartials);