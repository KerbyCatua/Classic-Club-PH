async function loadPartials() {
  const headerEl = document.getElementById('header-partial');
  const footerEl = document.getElementById('footer-partial');
  const projectBaseUrl = new URL('./', document.baseURI);
  const componentBaseUrl = new URL('components/', projectBaseUrl);

  if (headerEl) {
    await loadPartial(new URL('header.html', componentBaseUrl), headerEl);
    highlightActiveNav();
  }

  if (footerEl) {
    await loadPartial(new URL('footer.html', componentBaseUrl), footerEl);
  }

  document.dispatchEvent(new CustomEvent('cc:partialsLoaded'));
}

async function loadPartial(url, element) {
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`Could not load ${url}: ${response.status}`);
  }

  const markup = await response.text();

  if (markup.includes('<title>Not Found</title>') || markup.includes('The requested URL was not found')) {
    throw new Error(`The server returned an error page for ${url}`);
  }

  element.innerHTML = markup;
}

function highlightActiveNav() {
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';

  document.querySelectorAll('.navbar-nav .nav-link').forEach(link => {
    const linkPage = link.getAttribute('href');

    if (linkPage === currentPage || (currentPage === 'index.html' && linkPage === 'index.html')) {
      link.style.color = '#028090';
      link.classList.add('fw-semibold');
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadPartials().catch(error => {
    console.error('Classic Club PH partial loading failed:', error);
  });
});