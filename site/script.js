document.addEventListener('DOMContentLoaded', () => {
  const button = document.querySelector('[data-action="cta"]');
  if (!button) return;
  button.addEventListener('click', () => {
    button.textContent = 'Thanks!';
    button.disabled = true;
  });
});
