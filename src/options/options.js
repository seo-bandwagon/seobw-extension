// Load saved settings
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get({
    apiKey: '',
    apiUrl: 'https://seobandwagon.com/api',
    autoSave: false,
    showNotifications: true,
    localBackup: true
  }, (items) => {
    document.getElementById('apiKey').value = items.apiKey;
    document.getElementById('apiUrl').value = items.apiUrl;
    document.getElementById('autoSave').checked = items.autoSave;
    document.getElementById('showNotifications').checked = items.showNotifications;
    document.getElementById('localBackup').checked = items.localBackup;
  });
});

// Save settings
document.getElementById('saveBtn').addEventListener('click', () => {
  const settings = {
    apiKey: document.getElementById('apiKey').value.trim(),
    apiUrl: document.getElementById('apiUrl').value.trim() || 'https://seobandwagon.com/api',
    autoSave: document.getElementById('autoSave').checked,
    showNotifications: document.getElementById('showNotifications').checked,
    localBackup: document.getElementById('localBackup').checked
  };
  
  chrome.storage.sync.set(settings, () => {
    const status = document.getElementById('status');
    status.textContent = '✓ Settings saved successfully';
    status.className = 'status success';
    
    setTimeout(() => {
      status.className = 'status';
    }, 3000);
  });
});
