(() => {
  const toast = (message) => {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(window.__dialogueToast);
    window.__dialogueToast = setTimeout(() => el.classList.remove('show'), 1800);
  };

  const openHashModal = (layer) => {
    if (!layer) return;
    layer.classList.remove('is-closing');
    layer.classList.add('is-open');
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${layer.id}`);
  };

  const closeHashModal = (layer) => {
    if (!layer || layer.classList.contains('is-closing') || !layer.classList.contains('is-open')) return;
    layer.classList.remove('is-open');
    layer.classList.add('is-closing');
    const finish = () => {
      layer.classList.remove('is-closing');
      history.replaceState(null, '', window.location.pathname + window.location.search);
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else window.setTimeout(finish, 100);
  };

  ['new-project', 'profile'].forEach((id) => {
    const layer = document.getElementById(id);
    if (!layer) return;

    document.querySelectorAll(`a[href="#${id}"]`).forEach((trigger) => {
      trigger.addEventListener('click', (event) => {
        event.preventDefault();
        openHashModal(layer);
      });
    });

    const closeButton = layer.querySelector('.modal-close');
    closeButton?.addEventListener('click', (event) => {
      event.preventDefault();
      closeHashModal(layer);
    });

    layer.addEventListener('click', (event) => {
      if (event.target === layer) closeHashModal(layer);
    });
  });

  const initialModalId = window.location.hash.slice(1);
  if (initialModalId === 'new-project' || initialModalId === 'profile') {
    openHashModal(document.getElementById(initialModalId));
  }

  const shareOpen = document.querySelector('[data-share-open]');
  const shareLayer = document.querySelector('[data-share-layer]');
  const shareClose = document.querySelector('[data-share-close]');
  const shareCopy = document.querySelector('[data-share-copy]');
  const shareUrlLabel = document.querySelector('[data-share-url]');
  const shareInviteForm = document.querySelector('[data-share-invite-form]');
  const shareEmails = document.querySelector('[data-share-emails]');
  const sharePeople = document.querySelector('[data-share-people]');
  const ownerSelect = document.querySelector('[data-owner-select]');
  const transferOwner = document.querySelector('[data-transfer-owner]');
  let shareLastFocus = null;
  let currentOwner = 'saori@idealogue.io';

  const shareUrl = () => new URL('share-landline-v19.html', window.location.href).href;
  const closeShareModal = () => {
    if (!shareLayer || shareLayer.hidden) return;
    shareLayer.classList.remove('is-open');
    document.body.classList.remove('share-modal-open');
    window.setTimeout(() => { shareLayer.hidden = true; }, 160);
    shareLastFocus?.focus();
  };
  const openShareModal = () => {
    if (!shareLayer) return;
    shareLastFocus = document.activeElement;
    shareLayer.hidden = false;
    requestAnimationFrame(() => shareLayer.classList.add('is-open'));
    document.body.classList.add('share-modal-open');
    if (shareUrlLabel) shareUrlLabel.textContent = shareUrl();
    shareClose?.focus();
  };

  shareOpen?.addEventListener('click', openShareModal);
  shareClose?.addEventListener('click', closeShareModal);
  shareLayer?.addEventListener('click', (e) => {
    if (e.target === shareLayer) closeShareModal();
  });

  let shareCopyResetTimer = null;
  const showCopiedState = () => {
    if (!shareCopy) return;
    shareCopy.textContent = 'Copied!';
    clearTimeout(shareCopyResetTimer);
    shareCopyResetTimer = window.setTimeout(() => {
      shareCopy.textContent = 'Copy';
    }, 3000);
  };

  shareCopy?.addEventListener('click', async () => {
    const url = shareUrl();
    try {
      await navigator.clipboard.writeText(url);
      showCopiedState();
    } catch {
      const field = document.createElement('textarea');
      field.value = url;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      const copied = document.execCommand('copy');
      field.remove();
      if (copied) showCopiedState();
      else toast('Copy this link from the dialog');
    }
  });

  const initialsForEmail = (email) => email.split('@')[0].split(/[._-]+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || 'GU';
  const displayNameForEmail = (email) => email.split('@')[0].split(/[._-]+/).filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join(' ');

  shareInviteForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const emails = (shareEmails?.value || '').split(/[;,\s]+/).map(v => v.trim().toLowerCase()).filter(Boolean);
    const valid = [...new Set(emails.filter(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
    if (!valid.length) {
      toast('Enter at least one valid email address');
      shareEmails?.focus();
      return;
    }
    valid.forEach((email) => {
      if (!sharePeople?.querySelector(`[data-person-email="${email}"]`)) {
        const row = document.createElement('div');
        row.className = 'share-person';
        row.dataset.personEmail = email;
        row.innerHTML = `<span class="share-person-avatar">${initialsForEmail(email)}</span><span class="share-person-copy"><strong></strong><span></span></span><span class="share-role">Can view</span>`;
        row.querySelector('strong').textContent = displayNameForEmail(email);
        row.querySelector('.share-person-copy span').textContent = email;
        sharePeople?.appendChild(row);
        if (ownerSelect && ![...ownerSelect.options].some(option => option.value === email)) {
          const option = document.createElement('option');
          option.value = email;
          option.textContent = `${displayNameForEmail(email)} — ${email}`;
          ownerSelect.appendChild(option);
        }
      }
    });
    if (shareEmails) shareEmails.value = '';
    toast(`Link sent to ${valid.length} ${valid.length === 1 ? 'person' : 'people'}`);
  });

  transferOwner?.addEventListener('click', () => {
    const nextOwner = ownerSelect?.value;
    if (!nextOwner || nextOwner === currentOwner) {
      toast('Select a different person to change owner');
      return;
    }
    sharePeople?.querySelectorAll('.share-person').forEach((row) => {
      const role = row.querySelector('.share-role');
      if (!role) return;
      if (row.dataset.personEmail === nextOwner) role.textContent = 'Owner';
      else if (row.dataset.personEmail === currentOwner) role.textContent = 'Can edit';
    });
    currentOwner = nextOwner;
    toast(`Owner changed to ${displayNameForEmail(nextOwner)}`);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && shareLayer && !shareLayer.hidden) closeShareModal();
  });

  const restart = () => {
    const device = document.querySelector('.landline-device');
    if (!device) return;
    device.animate([{opacity:.25, transform:'scale(.86)'},{opacity:1, transform:'scale(.88)'}], {duration:180, easing:'ease-out'});
    toast('Prototype restarted');
  };
  document.querySelectorAll('[data-restart]').forEach((b) => b.addEventListener('click', restart));
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'r' && !/input|textarea/i.test(document.activeElement?.tagName || '')) {
      e.preventDefault();
      restart();
    }
  });

  document.querySelectorAll('[data-llm-create]').forEach((button) => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      toast('Prototype creation will happen in the connected LLM');
    });
  });

  const mockSignIn = document.querySelector('[data-mock-signin]');
  if (mockSignIn) {
    mockSignIn.querySelectorAll('[data-mock-value]').forEach((field) => {
      const fill = () => {
        if (!field.value) {
          field.value = field.dataset.mockValue || '';
          field.classList.add('mock-filled');
        }
      };
      field.addEventListener('focus', fill);
      field.addEventListener('click', fill);
    });
    mockSignIn.addEventListener('submit', (e) => {
      e.preventDefault();
      window.location.href = 'projects.html';
    });
  }

  const readImageFile = (file, onLoad) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      toast('Please choose a JPG or PNG image');
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => onLoad(reader.result));
    reader.addEventListener('error', () => toast('Could not load that image'));
    reader.readAsDataURL(file);
  };

  const profileAvatarInput = document.querySelector('[data-profile-avatar-input]');
  const profileAvatarTrigger = document.querySelector('[data-profile-avatar-trigger]');
  const profileAvatarPreview = document.querySelector('[data-profile-avatar-preview]');
  const profileSave = document.querySelector('[data-profile-save]');
  const profileName = document.querySelector('[data-profile-name]');
  let profileAvatarDataUrl = '';

  if (profileAvatarInput && profileAvatarTrigger && profileAvatarPreview) {
    profileAvatarTrigger.addEventListener('click', () => profileAvatarInput.click());
    profileAvatarInput.addEventListener('change', () => {
      readImageFile(profileAvatarInput.files?.[0], (dataUrl) => {
        profileAvatarDataUrl = dataUrl;
        profileAvatarPreview.style.backgroundImage = `url("${dataUrl}")`;
        profileAvatarPreview.textContent = '';
        toast('Profile image uploaded');
      });
    });
  }

  if (profileSave) {
    profileSave.addEventListener('click', () => {
      const sidebarAvatar = document.querySelector('.profile-link .avatar');
      const sidebarName = document.querySelector('.profile-link .profile-copy strong');
      const name = profileName?.value.trim() || 'Saori';
      if (sidebarName) sidebarName.textContent = name;
      if (sidebarAvatar) {
        if (profileAvatarDataUrl) {
          sidebarAvatar.style.backgroundImage = `url("${profileAvatarDataUrl}")`;
          sidebarAvatar.style.backgroundSize = 'cover';
          sidebarAvatar.style.backgroundPosition = 'center';
          sidebarAvatar.textContent = '';
        } else {
          sidebarAvatar.textContent = name.split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || 'SA';
        }
      }
      closeHashModal(document.getElementById('profile'));
      toast('Profile saved');
    });
  }
})();
