'use strict';

const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const toggleLink = document.getElementById('toggle-link');
const toggleText = document.getElementById('toggle-text');
const subtitle = document.getElementById('subtitle');
const errorBox = document.getElementById('error');

let mode = 'login';

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.hidden = true;
}

toggleLink.addEventListener('click', (e) => {
  e.preventDefault();
  clearError();
  if (mode === 'login') {
    mode = 'register';
    loginForm.hidden = true;
    registerForm.hidden = false;
    subtitle.textContent = 'Create a new account';
    toggleText.textContent = 'Already have an account?';
    toggleLink.textContent = 'Sign in';
  } else {
    mode = 'login';
    loginForm.hidden = false;
    registerForm.hidden = true;
    subtitle.textContent = 'Sign in to your account';
    toggleText.textContent = "Don't have an account?";
    toggleLink.textContent = 'Sign up';
  }
});

async function submit(url, payload) {
  clearError();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showError(data.error || 'Something went wrong');
    return;
  }
  window.location.href = '/';
}

loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(loginForm);
  submit('/api/auth/login', {
    email: fd.get('email'),
    password: fd.get('password'),
  });
});

registerForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(registerForm);
  submit('/api/auth/register', {
    name: fd.get('name'),
    email: fd.get('email'),
    password: fd.get('password'),
  });
});
